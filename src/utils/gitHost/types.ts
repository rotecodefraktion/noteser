// The host-abstraction seam for vault sync. See
// docs/multi-host-sync-plan.md → "The seam: GitHostProvider".
//
// The whole point: the GitHub push flow (createBlob → createTree →
// createCommit → updateBranchRef) cannot be ported to Forgejo/Gitea because
// those create endpoints don't exist there. So the seam does NOT expose
// git-data write primitives — it exposes a higher-level "commit a batch of
// file changes" operation each host implements its own way.

import type { SyncRepo } from '@/types'

export type HostKind = 'github' | 'forgejo'

export interface HostUser {
  id: string | number
  login: string
  name: string | null
  avatarUrl?: string
}

export interface HostRepo {
  owner: string
  name: string
  defaultBranch: string
  isPrivate: boolean
}

/** One file change in a commit. content is the raw UTF-8 string (provider
 *  handles base64). For deletes, content is omitted. sha is the *current*
 *  blob sha of the file being replaced/deleted (Forgejo requires it;
 *  GitHub ignores it). */
export interface FileChange {
  op: 'create' | 'update' | 'delete'
  path: string
  content?: string
  contentBytes?: Uint8Array // for binary attachments
  sha?: string
}

export interface CommitRequest {
  branch: string
  parentSha: string // expected current head (optimistic FF)
  message: string
  changes: FileChange[]
}

export interface CommitResult {
  commitSha: string
  commitUrl: string | null
}

export interface GitHostProvider {
  readonly kind: HostKind
  readonly baseUrl: string // e.g. https://api.github.com | https://codeberg.org

  // --- repo ops ---
  listRepos(): Promise<HostRepo[]>
  getRepo(owner: string, name: string): Promise<HostRepo>
  listBranches(owner: string, name: string): Promise<string[]>
  createRepo(name: string, isPrivate: boolean): Promise<HostRepo>

  // --- git-data READ (near-identical across hosts) ---
  getBranchHeadSha(repo: SyncRepo): Promise<string>
  getCommitTreeSha(repo: SyncRepo, commitSha: string): Promise<string>
  getTreeMap(repo: SyncRepo, treeSha: string): Promise<Map<string, string>> // path -> blobSha
  getBlobContent(repo: SyncRepo, sha: string): Promise<string>
  getBlobBytes(repo: SyncRepo, sha: string): Promise<Uint8Array>

  // --- git-data WRITE (the one real divergence) ---
  commitChanges(repo: SyncRepo, req: CommitRequest): Promise<CommitResult>
}
