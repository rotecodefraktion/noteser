// GitHubProvider: the GitHub implementation of the GitHostProvider seam.
//
// This is a mechanical WRAP of the existing functions in `../github.ts` —
// it delegates every call rather than reimplementing any HTTP. The repo
// read/write functions in github.ts take `(token, owner, repo, ...)`; this
// class binds the token at construction and maps a `SyncRepo {owner,name,
// branch}` onto those positional args.
//
// `commitChanges` reproduces the existing push flow that `githubSync/
// syncPush.ts` performs inline (createBlob → createTree → createCommit →
// updateBranchRef), mirroring its semantics: deletes are `sha:null` tree
// entries, the base tree is resolved from the parent commit, and the branch
// ref is fast-forwarded. See docs/multi-host-sync-plan.md.

import type { SyncRepo, GitHubRepo } from '@/types'
import {
  getBranchRefSha,
  getCommitTreeSha,
  getTreeMap,
  getBlobContent,
  getBlobBytes,
  listUserRepos,
  listRepoBranches,
  getRepo as githubGetRepo,
  createRepo as githubCreateRepo,
  createBlob,
  createBlobBinary,
  createTree,
  createCommit,
  updateBranchRef,
  type GitTreeEntry,
} from '../github'
import type {
  GitHostProvider,
  HostKind,
  HostRepo,
  CommitRequest,
  CommitResult,
} from './types'

const GITHUB_API_BASE = 'https://api.github.com'

function toHostRepo(repo: GitHubRepo): HostRepo {
  return {
    owner: repo.owner.login,
    name: repo.name,
    defaultBranch: repo.default_branch,
    isPrivate: repo.private,
  }
}

export class GitHubProvider implements GitHostProvider {
  readonly kind: HostKind = 'github'
  readonly baseUrl: string

  constructor(
    private readonly token: string,
    baseUrl: string = GITHUB_API_BASE,
  ) {
    this.baseUrl = baseUrl
  }

  // --- repo ops ---
  async listRepos(): Promise<HostRepo[]> {
    const repos = await listUserRepos(this.token)
    return repos.map(toHostRepo)
  }

  async getRepo(owner: string, name: string): Promise<HostRepo> {
    const repo = await githubGetRepo(this.token, owner, name)
    return toHostRepo(repo)
  }

  async listBranches(owner: string, name: string): Promise<string[]> {
    const branches = await listRepoBranches(this.token, owner, name)
    return branches.map((b) => b.name)
  }

  async createRepo(name: string, isPrivate: boolean): Promise<HostRepo> {
    const repo = await githubCreateRepo(this.token, name, isPrivate)
    return toHostRepo(repo)
  }

  // --- git-data READ ---
  getBranchHeadSha(repo: SyncRepo): Promise<string> {
    return getBranchRefSha(this.token, repo.owner, repo.name, repo.branch)
  }

  getCommitTreeSha(repo: SyncRepo, commitSha: string): Promise<string> {
    return getCommitTreeSha(this.token, repo.owner, repo.name, commitSha)
  }

  getTreeMap(repo: SyncRepo, treeSha: string): Promise<Map<string, string>> {
    return getTreeMap(this.token, repo.owner, repo.name, treeSha)
  }

  getBlobContent(repo: SyncRepo, sha: string): Promise<string> {
    return getBlobContent(this.token, repo.owner, repo.name, sha)
  }

  getBlobBytes(repo: SyncRepo, sha: string): Promise<Uint8Array> {
    return getBlobBytes(this.token, repo.owner, repo.name, sha)
  }

  // --- git-data WRITE ---
  // Reproduces the existing GitHub push: build a blob per create/update file
  // (binary via createBlobBinary when contentBytes is set), add a sha:null
  // tree entry per delete, then createTree(baseTree) → createCommit(parent) →
  // updateBranchRef. The base tree is the parent commit's tree.
  async commitChanges(repo: SyncRepo, req: CommitRequest): Promise<CommitResult> {
    const { owner, name } = repo
    const baseTreeSha = await this.getCommitTreeSha(repo, req.parentSha)

    const entries: GitTreeEntry[] = []
    for (const change of req.changes) {
      if (change.op === 'delete') {
        entries.push({ path: change.path, mode: '100644', type: 'blob', sha: null })
        continue
      }
      const blobSha = change.contentBytes
        ? await createBlobBinary(this.token, owner, name, new Blob([change.contentBytes.slice()]))
        : await createBlob(this.token, owner, name, change.content ?? '')
      entries.push({ path: change.path, mode: '100644', type: 'blob', sha: blobSha })
    }

    const newTreeSha = await createTree(this.token, owner, name, baseTreeSha, entries)
    const { sha: commitSha, html_url } = await createCommit(
      this.token,
      owner,
      name,
      req.message,
      newTreeSha,
      req.parentSha,
    )
    await updateBranchRef(this.token, owner, name, req.branch, commitSha)

    return { commitSha, commitUrl: html_url }
  }
}
