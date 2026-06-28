# Host-Picker-UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let end users connect a vault on GitHub, Codeberg, or self-hosted Forgejo/Gitea through the connect UI, wiring the existing host-agnostic sync backend to the modals.

**Architecture:** The sync backend (GitHostProvider seam, `makeGitHostProvider`, store `setHost`/`baseUrl`) is already complete and verified. This plan adds (1) a `getAuthenticatedUser()` method to the provider seam, (2) a host-selection first step in the connect modal that routes GitHub through the existing device flow and Codeberg/Forgejo through a PAT + base-URL form, (3) makes the repo picker host-blind via the provider, and (4) hides GitHub-only features (Gist, file-history, revert) when the active host is not GitHub.

**Tech Stack:** Next.js 15 / React 19, Zustand, Jest + React Testing Library, TypeScript. Node 22.

## Global Constraints

- Node 22 (`nvm use` before any npm command).
- Respond/comment in the existing codebase's English; UI copy in English to match surrounding strings.
- The persisted `noteser-github` store needs NO version bump — `host`/`baseUrl` are additive and already present (initial state merges over the persisted blob).
- `host` is `'github' | 'forgejo'`; Codeberg is `host='forgejo'` with `baseUrl='https://codeberg.org'`. There is no separate `'codeberg'` HostKind.
- Auth header for Forgejo is `Authorization: token <PAT>` (already in ForgejoProvider).
- Provider construction is always `makeGitHostProvider({ host, token, baseUrl })` — never `new XProvider` in UI code.
- TDD: failing test first, minimal implementation, frequent commits.
- Each commit message ends with the two trailers used in this repo:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WnbRGgFJAqdeAgJjhh5Lmb
  ```

## File Structure

- `src/utils/gitHost/types.ts` — add `getAuthenticatedUser()` to `GitHostProvider`; add `hostUserToGitHubUser` mapper (or co-locate in a small `hostUser.ts`).
- `src/utils/gitHost/githubProvider.ts` — implement `getAuthenticatedUser` via `fetchGitHubUser`.
- `src/utils/gitHost/forgejoProvider.ts` — implement `getAuthenticatedUser` via `GET /user`.
- `src/components/modals/GitHubAuthModal.tsx` — add host-selection step + Forgejo/Codeberg PAT+baseUrl branch; route both PAT paths through the provider.
- `src/components/modals/GitHubRepoModal.tsx` — replace direct `listUserRepos`/`createRepo` with provider calls; switch to `HostRepo`.
- `src/components/sidebar/ContextMenu.tsx` — gate "View history" + "Publish as gist" on host.
- `src/components/sidebar/SourceControlPanel.tsx` — gate the `RecentCommits` block (history + revert) on host.
- Tests alongside in `src/__tests__/`.

---

### Task 1: Provider `getAuthenticatedUser()` + HostUser→GitHubUser mapper

**Files:**
- Modify: `src/utils/gitHost/types.ts`
- Modify: `src/utils/gitHost/githubProvider.ts`
- Modify: `src/utils/gitHost/forgejoProvider.ts`
- Test: `src/__tests__/forgejoProvider.test.ts`, `src/__tests__/githubProvider.test.ts`

**Interfaces:**
- Produces:
  - `GitHostProvider.getAuthenticatedUser(): Promise<HostUser>` where `HostUser = { id: string | number; login: string; name: string | null; avatarUrl?: string }`.
  - `hostUserToGitHubUser(u: HostUser): GitHubUser` exported from `src/utils/gitHost/types.ts`, mapping `{ id→Number(id), login, name, avatar_url: avatarUrl ?? '' }`.
- Consumes (existing): `fetchGitHubUser(token): Promise<GitHubUser>` from `../github`; Forgejo `GET {apiBase}/user` returns `{ id: number; login: string; full_name: string; avatar_url: string }`.

- [ ] **Step 1: Add the interface method + mapper to types.ts**

In `src/utils/gitHost/types.ts`, add to the `GitHostProvider` interface (after the repo ops block):

```ts
  // The authenticated user behind the token. Used by the connect flow to
  // populate the session identity host-agnostically.
  getAuthenticatedUser(): Promise<HostUser>
```

And append this mapper at the end of the file (it needs `GitHubUser`):

```ts
import type { GitHubUser } from '@/types' // add to the existing top import if SyncRepo is already imported from '@/types'

// Bridge the host-agnostic HostUser onto the store's existing GitHubUser shape
// (avatarUrl -> avatar_url, id coerced to number). Lets the store keep its
// current type while the connect flow stays host-agnostic.
export function hostUserToGitHubUser(u: HostUser): GitHubUser {
  return {
    id: typeof u.id === 'number' ? u.id : Number(u.id) || 0,
    login: u.login,
    name: u.name,
    avatar_url: u.avatarUrl ?? '',
  }
}
```

(Merge the `GitHubUser` import into the existing `import type { SyncRepo } from '@/types'` line: `import type { SyncRepo, GitHubUser } from '@/types'`.)

- [ ] **Step 2: Write the failing ForgejoProvider test**

Append to `src/__tests__/forgejoProvider.test.ts` (uses the existing `fetchMock` / `jsonResponse` helpers in that file):

```ts
describe('getAuthenticatedUser', () => {
  it('maps the Gitea /user payload to HostUser', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 42, login: 'octo', full_name: 'Octo Cat', avatar_url: 'https://c.org/a.png' }),
    )
    const provider = new ForgejoProvider(TOKEN, CODEBERG)
    const user = await provider.getAuthenticatedUser()
    expect(fetchMock).toHaveBeenCalledWith(
      `${CODEBERG}/api/v1/user`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `token ${TOKEN}` }) }),
    )
    expect(user).toEqual({ id: 42, login: 'octo', name: 'Octo Cat', avatarUrl: 'https://c.org/a.png' })
  })

  it('throws ForgejoAPIError on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'bad token' }, 401))
    const provider = new ForgejoProvider(TOKEN, CODEBERG)
    await expect(provider.getAuthenticatedUser()).rejects.toThrow(/401/)
  })
})
```

- [ ] **Step 3: Run it — verify it fails**

Run: `nvm use && npx jest src/__tests__/forgejoProvider.test.ts -t getAuthenticatedUser`
Expected: FAIL (`getAuthenticatedUser is not a function`).

- [ ] **Step 4: Implement it in forgejoProvider.ts**

Add to the `// --- git-data READ ---` region of `ForgejoProvider`:

```ts
  async getAuthenticatedUser(): Promise<HostUser> {
    const data = (await this.get('/user', 'Read user')) as {
      id: number
      login: string
      full_name?: string
      avatar_url?: string
    }
    return {
      id: data.id,
      login: data.login,
      name: data.full_name ? data.full_name : null,
      avatarUrl: data.avatar_url,
    }
  }
```

Add `HostUser` to the `import type { ... } from './types'` list at the top of the file.

- [ ] **Step 5: Write the failing GitHubProvider test**

Append to `src/__tests__/githubProvider.test.ts`. Mock `fetchGitHubUser` from `../github` the same way the file already mocks the other github helpers (check the existing `jest.mock('../github', ...)` block and add `fetchGitHubUser: jest.fn()` to it if not present, then in the test):

```ts
describe('getAuthenticatedUser', () => {
  it('delegates to fetchGitHubUser and maps to HostUser', async () => {
    ;(fetchGitHubUser as jest.Mock).mockResolvedValueOnce({
      id: 7, login: 'mona', name: 'Mona', avatar_url: 'https://gh/a.png',
    })
    const provider = new GitHubProvider('tok')
    const user = await provider.getAuthenticatedUser()
    expect(fetchGitHubUser).toHaveBeenCalledWith('tok')
    expect(user).toEqual({ id: 7, login: 'mona', name: 'Mona', avatarUrl: 'https://gh/a.png' })
  })
})
```

(Import `fetchGitHubUser` in the test's mocked-module imports.)

- [ ] **Step 6: Implement it in githubProvider.ts**

Add `fetchGitHubUser` to the existing import from `../github`, add `HostUser` to the `./types` import, then add to the READ region of `GitHubProvider`:

```ts
  async getAuthenticatedUser(): Promise<HostUser> {
    const u = await fetchGitHubUser(this.token)
    return { id: u.id, login: u.login, name: u.name, avatarUrl: u.avatar_url }
  }
```

- [ ] **Step 7: Run all provider tests + typecheck**

Run: `npx jest src/__tests__/forgejoProvider.test.ts src/__tests__/githubProvider.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/utils/gitHost/types.ts src/utils/gitHost/githubProvider.ts src/utils/gitHost/forgejoProvider.ts src/__tests__/forgejoProvider.test.ts src/__tests__/githubProvider.test.ts
git commit -m "feat(sync): add getAuthenticatedUser to the GitHostProvider seam"
```

---

### Task 2: Host-selection step + Forgejo/Codeberg PAT branch in the connect modal

**Files:**
- Modify: `src/components/modals/GitHubAuthModal.tsx`
- Test: `src/__tests__/githubAuthModalHostPicker.test.tsx` (create)

**Interfaces:**
- Consumes: `makeGitHostProvider`, `hostUserToGitHubUser` (Task 1), `useGitHubStore`'s `setHost(host, baseUrl)` + `setSession(token, user)`.
- Produces: a connect modal whose first step is a host picker; selecting Codeberg/Forgejo leads to a PAT (+ base-URL for Forgejo) form; on a valid PAT it calls `setHost` then `setSession` then opens `github-repo`.

**Design notes for the implementer:**
- Keep the existing GitHub device-flow + GitHub-PAT code intact; it now lives behind a `step === 'github'` branch. The device flow only runs when the GitHub branch is active (don't start it on modal open anymore — start it when the user picks GitHub).
- Add modal-local state: `step: 'pick' | 'github' | 'forgejo'`, plus `forgejoBaseUrl` (default `''`) and a `forgejoPreset: 'codeberg' | 'custom'` flag so Codeberg fixes the URL to `https://codeberg.org` and hides the URL field.
- The Forgejo PAT submit handler validates the base URL (Codeberg: skip; custom: non-empty + `/^https?:\/\//`), then:
  ```ts
  const baseUrl = preset === 'codeberg' ? 'https://codeberg.org' : forgejoBaseUrl.trim().replace(/\/+$/, '')
  const provider = makeGitHostProvider({ host: 'forgejo', token, baseUrl })
  const hostUser = await provider.getAuthenticatedUser()
  setHost('forgejo', baseUrl)
  setSession(token, hostUserToGitHubUser(hostUser))
  setStatus({ kind: 'success', login: hostUser.login })
  setTimeout(() => { syncRepo ? closeModal() : openModal({ type: 'github-repo' }) }, 1200)
  ```
  On failure: `setStatus`/error like the existing GitHub PAT handler ("That token did not work — check it has the right repo access.").
- When the user picks GitHub, call `setHost('github', null)` before/at the start of the device flow so a prior Forgejo selection can't leak.
- Update the modal title to be neutral: `"Connect a vault"`.

- [ ] **Step 1: Write the failing host-picker test**

Create `src/__tests__/githubAuthModalHostPicker.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { GitHubAuthModal } from '@/components/modals/GitHubAuthModal'
import { useUIStore, useGitHubStore } from '@/stores'

// Provider factory is the seam we assert against.
const getAuthenticatedUser = jest.fn()
jest.mock('@/utils/gitHost', () => ({
  makeGitHostProvider: jest.fn(() => ({ getAuthenticatedUser })),
  hostUserToGitHubUser: (u: { id: number; login: string; name: string | null; avatarUrl?: string }) => ({
    id: u.id, login: u.login, name: u.name, avatar_url: u.avatarUrl ?? '',
  }),
}))

beforeEach(() => {
  getAuthenticatedUser.mockReset()
  useGitHubStore.setState({ token: null, user: null, host: 'github', baseUrl: null, syncRepo: null })
  useUIStore.setState({ modal: { type: 'github-auth' } })
})

it('shows the host picker first', () => {
  render(<GitHubAuthModal />)
  expect(screen.getByText(/choose your git host/i)).toBeInTheDocument()
})

it('connects a Codeberg vault via PAT and stores host+baseUrl', async () => {
  getAuthenticatedUser.mockResolvedValueOnce({ id: 9, login: 'cberg', name: 'C', avatarUrl: '' })
  render(<GitHubAuthModal />)
  fireEvent.click(screen.getByTestId('host-pick-codeberg'))
  fireEvent.change(screen.getByTestId('forgejo-pat-input'), { target: { value: 'pat-x' } })
  fireEvent.click(screen.getByTestId('forgejo-pat-submit'))
  await waitFor(() => expect(useGitHubStore.getState().host).toBe('forgejo'))
  expect(useGitHubStore.getState().baseUrl).toBe('https://codeberg.org')
  expect(useGitHubStore.getState().token).toBe('pat-x')
})

it('requires a base URL for self-hosted Forgejo', async () => {
  render(<GitHubAuthModal />)
  fireEvent.click(screen.getByTestId('host-pick-forgejo'))
  fireEvent.change(screen.getByTestId('forgejo-pat-input'), { target: { value: 'pat-x' } })
  fireEvent.click(screen.getByTestId('forgejo-pat-submit'))
  await waitFor(() => expect(screen.getByText(/enter.*server url/i)).toBeInTheDocument())
  expect(getAuthenticatedUser).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `nvm use && npx jest src/__tests__/githubAuthModalHostPicker.test.tsx`
Expected: FAIL (no host picker / testids).

- [ ] **Step 3: Implement the host-picker step + Forgejo branch**

Refactor `GitHubAuthModal.tsx`:
1. Add state: `const [step, setStep] = useState<'pick' | 'github' | 'forgejo'>('pick')`, `const [forgejoPreset, setForgejoPreset] = useState<'codeberg' | 'custom'>('codeberg')`, `const [forgejoBaseUrl, setForgejoBaseUrl] = useState('')`, `const [forgejoPat, setForgejoPat] = useState('')`, `const [forgejoError, setForgejoError] = useState<string | null>(null)`, `const [forgejoSubmitting, setForgejoSubmitting] = useState(false)`.
2. Add `const setHost = useGitHubStore(s => s.setHost)`.
3. Change the open-effect so it resets to `step='pick'` on open and does NOT auto-start the device flow.
4. Add a `pick` view with three buttons (testids `host-pick-github`, `host-pick-codeberg`, `host-pick-forgejo`). GitHub → `setHost('github', null); setStep('github')` then start the device flow (reuse the existing `handleRetry`/start logic). Codeberg → `setForgejoPreset('codeberg'); setStep('forgejo')`. Forgejo → `setForgejoPreset('custom'); setStep('forgejo')`.
5. Add a `forgejo` view: a base-URL `<Input>` shown only when `forgejoPreset === 'custom'` (testid `forgejo-baseurl-input`), a password `<Input>` (testid `forgejo-pat-input`), a submit `<Button>` (testid `forgejo-pat-submit`), and a Back button to `setStep('pick')`. Show `forgejoError`.
6. Add `handleForgejoSubmit` per the design note above, including base-URL validation:
   ```ts
   if (forgejoPreset === 'custom') {
     const u = forgejoBaseUrl.trim()
     if (!u || !/^https?:\/\//.test(u)) { setForgejoError('Enter your Forgejo/Gitea server URL (https://…).'); return }
   }
   ```
7. Gate the existing GitHub device-flow views behind `step === 'github'` and the success view stays shared (both branches set `status.kind === 'success'`).
8. Title → `"Connect a vault"`.

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx jest src/__tests__/githubAuthModalHostPicker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify the existing GitHub PAT/device tests still pass**

Run: `npx jest src/__tests__/githubAuthModalPat.test.tsx`
Expected: PASS (adjust the test only if it relied on the device flow auto-starting on open — if so, it should first click `host-pick-github`).

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/components/modals/GitHubAuthModal.tsx src/__tests__/githubAuthModalHostPicker.test.tsx src/__tests__/githubAuthModalPat.test.tsx
git commit -m "feat(sync): host-selection step in the connect modal (GitHub/Codeberg/Forgejo)"
```

---

### Task 3: Make the repo picker host-blind

**Files:**
- Modify: `src/components/modals/GitHubRepoModal.tsx`
- Test: `src/__tests__/githubRepoModalHostBlind.test.tsx` (create)

**Interfaces:**
- Consumes: `makeGitHostProvider` (provider `listRepos(): Promise<HostRepo[]>`, `createRepo(name, isPrivate): Promise<HostRepo>`), store `host`/`baseUrl`/`token`.
- Produces: a repo modal that lists/creates repos through the active host's provider and builds `SyncRepo` from `HostRepo`.

**Design notes:**
- Replace `import { listUserRepos, createRepo } from '@/utils/github'` with `import { makeGitHostProvider } from '@/utils/gitHost'` and `import type { HostRepo } from '@/utils/gitHost'`.
- Read `host` + `baseUrl` from the store alongside `token`. Build the provider once per fetch: `const provider = makeGitHostProvider({ host, token, baseUrl })`.
- State `repos: HostRepo[] | null`. `HostRepo` has `{ owner, name, defaultBranch, isPrivate }` — there is no `id`/`full_name`/`owner.login`. Use `${repo.owner}/${repo.name}` as the React key and as the filter/display string (replace `repo.full_name` and `repo.owner.login`/`repo.default_branch`/`repo.private`).
- `handlePick(repo: HostRepo)` builds `SyncRepo` as `{ owner: repo.owner, name: repo.name, branch: repo.defaultBranch, isPrivate: repo.isPrivate }`.
- `handleCreate` uses `provider.createRepo(newName.trim(), newPrivate)` and maps the returned `HostRepo` the same way.
- Title: derive from host — `host === 'github' ? 'GitHub vault' : 'Codeberg/Forgejo vault'` (or use `baseUrl` host name). Disconnect label likewise neutralized to "Disconnect".

- [ ] **Step 1: Write the failing host-blind test**

Create `src/__tests__/githubRepoModalHostBlind.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { GitHubRepoModal } from '@/components/modals/GitHubRepoModal'
import { useUIStore, useGitHubStore } from '@/stores'

const listRepos = jest.fn()
const createRepo = jest.fn()
const makeGitHostProvider = jest.fn(() => ({ listRepos, createRepo }))
jest.mock('@/utils/gitHost', () => ({
  makeGitHostProvider: (...args: unknown[]) => makeGitHostProvider(...args),
}))

beforeEach(() => {
  listRepos.mockReset(); createRepo.mockReset(); makeGitHostProvider.mockClear()
  useGitHubStore.setState({ token: 'pat-x', host: 'forgejo', baseUrl: 'https://codeberg.org', syncRepo: null })
  useUIStore.setState({ modal: { type: 'github-repo' } })
})

it('lists repos through the active host provider', async () => {
  listRepos.mockResolvedValueOnce([
    { owner: 'cberg', name: 'vault', defaultBranch: 'main', isPrivate: true },
  ])
  render(<GitHubRepoModal />)
  await waitFor(() => expect(screen.getByText('cberg/vault')).toBeInTheDocument())
  expect(makeGitHostProvider).toHaveBeenCalledWith(
    expect.objectContaining({ host: 'forgejo', token: 'pat-x', baseUrl: 'https://codeberg.org' }),
  )
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `nvm use && npx jest src/__tests__/githubRepoModalHostBlind.test.tsx`
Expected: FAIL (still calls `listUserRepos` from `@/utils/github`).

- [ ] **Step 3: Implement the host-blind rewrite**

Apply the design notes above to `GitHubRepoModal.tsx`. Key replacements:
- Fetch effect:
  ```ts
  const provider = makeGitHostProvider({ host, token, baseUrl })
  provider.listRepos().then((rs) => { setRepos(rs); setLoading(false) }).catch(/* existing error view */)
  ```
- List rendering: `key={`${repo.owner}/${repo.name}`}`, display `{repo.owner}/{repo.name}`, branch `{repo.defaultBranch}`, lock icon on `repo.isPrivate`, `isCurrent = syncRepo?.owner === repo.owner && syncRepo?.name === repo.name`.
- `handlePick`/`handleCreate` build `SyncRepo` from `HostRepo` fields.

- [ ] **Step 4: Run the test + the existing repo-modal tests**

Run: `npx jest src/__tests__/githubRepoModalHostBlind.test.tsx src/__tests__/commitSwitchFreshClone.test.tsx`
Expected: PASS (fix `commitSwitchFreshClone` only if it mocked `listUserRepos` — switch its mock to `makeGitHostProvider`).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/components/modals/GitHubRepoModal.tsx src/__tests__/githubRepoModalHostBlind.test.tsx src/__tests__/commitSwitchFreshClone.test.tsx
git commit -m "feat(sync): route the repo picker through the host provider"
```

---

### Task 4: Hide GitHub-only features when host is not GitHub

**Files:**
- Modify: `src/components/sidebar/ContextMenu.tsx`
- Modify: `src/components/sidebar/SourceControlPanel.tsx`
- Test: `src/__tests__/contextMenuGistVisibility.test.tsx` (extend), `src/__tests__/sourceControlHostGating.test.tsx` (create)

**Interfaces:**
- Consumes: `useGitHubStore(s => s.host)`.
- Produces: Gist + view-history menu items hidden, and the `RecentCommits` (history + revert) block hidden, when `host !== 'github'`.

**Design notes:**
- ContextMenu: add `const isGitHubHost = useGitHubStore(s => s.host === 'github')`. Gate "View history" with `canViewHistory && isGitHubHost`, and "Publish as gist" with `hasGithubToken && !isTrashedNote && isGitHubHost`.
- SourceControlPanel `RecentCommits`: add `const isGitHubHost = useGitHubStore(s => s.host === 'github')` and change the early return to `if (!token || !repo || !isGitHubHost) return null`. (Recent-commits + revert both live in this component; gating it covers both.)

- [ ] **Step 1: Write failing gating tests**

Create `src/__tests__/sourceControlHostGating.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { SourceControlPanel } from '@/components/sidebar/SourceControlPanel'
import { useGitHubStore } from '@/stores'

jest.mock('@/utils/githubHistory', () => ({
  listRecentCommits: jest.fn().mockResolvedValue([]),
  formatRelativeAuthorDate: () => 'now',
}))

it('hides recent commits on a non-GitHub host', () => {
  useGitHubStore.setState({
    token: 'pat-x', host: 'forgejo', baseUrl: 'https://codeberg.org',
    syncRepo: { owner: 'c', name: 'v', branch: 'main', isPrivate: true }, lastCommitSha: null,
  })
  render(<SourceControlPanel />)
  expect(screen.queryByTestId('source-control-recent-commits')).not.toBeInTheDocument()
})
```

Extend `src/__tests__/contextMenuGistVisibility.test.tsx` with a case asserting `Publish as gist` is absent when `host: 'forgejo'` (follow the file's existing render/setup pattern).

- [ ] **Step 2: Run them — verify they fail**

Run: `nvm use && npx jest src/__tests__/sourceControlHostGating.test.tsx src/__tests__/contextMenuGistVisibility.test.tsx`
Expected: FAIL (items still render).

- [ ] **Step 3: Implement the gates**

Apply the design notes to both components.

- [ ] **Step 4: Run the gating tests + full suite + typecheck**

Run: `npx jest src/__tests__/sourceControlHostGating.test.tsx src/__tests__/contextMenuGistVisibility.test.tsx && npm run typecheck && npm test`
Expected: PASS across the suite.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/ContextMenu.tsx src/components/sidebar/SourceControlPanel.tsx src/__tests__/sourceControlHostGating.test.tsx src/__tests__/contextMenuGistVisibility.test.tsx
git commit -m "feat(sync): hide GitHub-only features (gist/history/revert) on non-GitHub hosts"
```

---

### Task 5: Lint, build, and qa-tester sanity sweep

**Files:** none (verification only)

- [ ] **Step 1: Full verification**

Run: `nvm use && npm run lint && npm run typecheck && npm test && npm run build`
Expected: all green. (Run `rm -rf .next` first if the build complains about stale module paths.)

- [ ] **Step 2: qa-tester Playwright sanity sweep**

Dispatch the `qa-tester` subagent to drive the connect flow up to host selection and the Forgejo base-URL/PAT form rendering (the real device flow / live PAT submit stay out of scope). Capture a screenshot of the host picker and the Forgejo form.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin feat/host-picker-ui
gh pr create --repo rotecodefraktion/noteser --base main \
  --title "feat(sync): host-picker UI — connect GitHub / Codeberg / Forgejo vaults" \
  --body "Implements docs/superpowers/specs/2026-06-28-host-picker-ui-design.md (issue #17). Final UI building block for multi-host sync."
```

---

## Self-Review

**Spec coverage:**
- Provider gap (`getAuthenticatedUser`) → Task 1 ✓
- Host-selection step + Codeberg/Forgejo PAT + base-URL → Task 2 ✓
- Repo picker host-blind → Task 3 ✓
- Hide GitHub-only features → Task 4 ✓
- Error handling (base-URL validation, ForgejoAPIError surfaced) → Task 2 ✓
- Testing (unit per provider/modal/gate; qa-tester sanity) → Tasks 1–5 ✓
- Out-of-scope items (no Forgejo file-history port, no Forgejo OAuth) → respected (Task 4 hides rather than ports) ✓

**Placeholder scan:** No TBD/TODO; every code step shows the code. ✓

**Type consistency:** `HostUser { id: string|number; login; name: string|null; avatarUrl? }`, `hostUserToGitHubUser` → `GitHubUser { id: number; login; name; avatar_url }`, `HostRepo { owner; name; defaultBranch; isPrivate }`, `makeGitHostProvider({ host, token, baseUrl })` — consistent across Tasks 1–4. ✓

**Note for executor:** Test files in this repo that exercise live `fetch` use the `@jest-environment node` docblock and the `jsonResponse` helper; component tests use jsdom (default). The new component tests (Tasks 2–4) are jsdom and must NOT carry the node docblock.
