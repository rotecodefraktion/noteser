# Host-Picker-UI — Design

**Status:** Approved (2026-06-28)
**Tracking issue:** rotecodefraktion/noteser#17 — "Support Codeberg (Forgejo/Gitea) as a vault host"
**Builds on:** `docs/multi-host-sync-plan.md` (the GitHostProvider seam, PRs #20–#26)

## Problem

The multi-host sync backend is complete and verified end-to-end against real
GitHub and Codeberg: `GitHostProvider`, `GitHubProvider`, `ForgejoProvider`,
host-aware provider selection (`makeGitHostProvider`), and a store that carries
`host` + `baseUrl` + `setHost(host, baseUrl)`. But an end user cannot reach any
of it: the connect UI (`GitHubAuthModal`, `GitHubRepoModal`) only offers the
GitHub OAuth device flow. This is the final building block that makes Codeberg /
Forgejo usable from the UI.

## Key existing facts the design leans on

- `GitHubAuthModal` **already has a PAT path** (fine-grained token paste), and
  Forgejo/Codeberg authenticates exactly that way — a Personal Access Token,
  no device flow. The two paths converge on `setSession(token, user)`.
- The store already exposes `setHost(host, baseUrl)`, both fields persisted,
  reset in `disconnect()`. No persist version bump is needed (additive fields
  merge over the persisted blob).
- `runSync` / `switchVault` already build their provider via
  `makeGitHostProvider({host, token, baseUrl})` read from the store — the sync
  path is already host-aware.
- `HostUser { id, login, name, avatarUrl? }` is almost deckungsgleich with
  `GitHubUser { id, login, name, avatar_url }`.

## The one backend gap

The `GitHostProvider` interface defines the `HostUser` *type* but has **no
method that returns it**. The connect flow needs the authenticated user to call
`setSession`. So the interface gains one method:

```ts
getAuthenticatedUser(): Promise<HostUser>
```

- `GitHubProvider` → delegates to `fetchGitHubUser(token)` from `../github`,
  maps `{ id, login, name, avatar_url }` → `HostUser`.
- `ForgejoProvider` → `GET {apiBase}/user` (Gitea API), maps
  `{ id, login, full_name, avatar_url }` → `HostUser`.

Everything else is UI wiring onto existing building blocks.

## Components & changes

### 1. Provider layer (`src/utils/gitHost/`)

- `types.ts` — add `getAuthenticatedUser(): Promise<HostUser>` to
  `GitHostProvider`.
- `githubProvider.ts` — implement via `fetchGitHubUser`.
- `forgejoProvider.ts` — implement via `GET /user`.

A small `hostUserToGitHubUser(u: HostUser): GitHubUser` mapper (avatarUrl → avatar_url, id coerced to number where the store type requires it) lets the store keep its existing `GitHubUser` shape unchanged.

### 2. Connect flow (`GitHubAuthModal`)

Add a new **first step: host selection** (GitHub / Codeberg / Forgejo), then
branch:

- **GitHub** → existing device flow + PAT option, unchanged. On success also
  calls `setHost('github', null)`.
- **Codeberg** → `host='forgejo'`, `baseUrl='https://codeberg.org'`, PAT entry
  only (no device flow).
- **Forgejo/Gitea** → `host='forgejo'` + a base-URL field (self-hosted) + PAT
  entry.

PAT validation is host-agnostic:
`makeGitHostProvider({host, token, baseUrl}).getAuthenticatedUser()` → on
success `setHost(...)` + `setSession(token, user)` → chain into the repo picker
(or close if a sync repo already exists). The existing GitHub PAT path is
refactored onto this same shared mechanism so there is one validation path, not
two.

The device flow stays GitHub-only and is only reachable from the GitHub branch.

### 3. Repo picker (`GitHubRepoModal`) — make host-blind

Replace the direct `listUserRepos` / `createRepo` imports from `@/utils/github`
with `provider.listRepos()` / `provider.createRepo()` via `makeGitHostProvider`
(host/baseUrl/token from the store). Switch internal state from `GitHubRepo` to
`HostRepo` (fields map 1:1: `owner.login` → `owner`, `name`, `default_branch` →
`defaultBranch`, `private` → `isPrivate`). `handlePick` / `handleCreate` build
`SyncRepo` from `HostRepo`. `switchVault` / `runSync` are already host-aware.

The modal title becomes host-aware (e.g. "Codeberg vault" / "Forgejo vault" /
"GitHub vault"); the "Disconnect" affordance text follows suit.

### 4. Gate GitHub-only features (hide when `host !== 'github'`)

Gist, File-History and Revert-to-Commit use GitHub-exclusive APIs. Hide them
entirely when the active host is not GitHub. Affected entry points:

- `src/components/sidebar/ContextMenu.tsx` (publish-gist, file-history)
- `src/components/sidebar/SourceControlPanel.tsx` (revert / history)
- `src/app/page.tsx` (modal mounts / triggers, if conditionally rendered)
- `src/utils/commands.ts` (command-palette entries)

A single derived helper (e.g. `const isGitHub = host === 'github'`, or a
selector) drives all the conditionals so the gate is consistent.

## Data flow

```
choose host
  → GitHub:   device flow (or PAT)   ─┐
  → Codeberg: PAT (+ preset baseUrl) ─┤→ token
  → Forgejo:  PAT + base-URL field   ─┘
  → makeGitHostProvider({host, token, baseUrl}).getAuthenticatedUser()
  → setHost(host, baseUrl) + setSession(token, user)
  → repo picker  (provider.listRepos / provider.createRepo)
  → setSyncRepo(target)
  → switchVault(target)
  → runSync  (already host-aware via makeGitHostProvider)
```

## Error handling

- `ForgejoAPIError` already carries status + server message; the auth modal
  already renders an error view. A failed `getAuthenticatedUser()` surfaces as
  "That token did not work — check it has the right access to your vault repo."
- Base-URL validation before PAT submit for the Forgejo branch: non-empty,
  `http(s)://` scheme, trim trailing slashes (the provider already strips them).
  Codeberg uses the fixed preset and skips this.

## Testing

- **Unit:** `getAuthenticatedUser` for both providers (mapping + error path);
  host-selection step in the auth modal (RTL) including the Forgejo base-URL
  field and validation; host-blind repo modal (provider methods called, not the
  GitHub helpers); feature-gating helper.
- **E2E sanity:** `qa-tester` Playwright pass over the host-selection step and
  the Forgejo base-URL/PAT form rendering. The real device flow and a live PAT
  submit against external hosts stay out of scope (covered by the existing
  Codeberg live harness `e2e:sync:codeberg`).

## Out of scope (YAGNI)

- Porting File-History / Revert / Gist to Forgejo equivalents (Gitea *does*
  have a commits API, but that is a separate enhancement — hidden for now).
- OAuth for Forgejo (PAT is the documented, simplest path; matches the Obsidian
  Git trust model already in use).
- Per-host avatar/identity polish beyond what `setSession` already renders.
