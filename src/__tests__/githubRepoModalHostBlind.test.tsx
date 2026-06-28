/**
 * @jest-environment jsdom
 *
 * githubRepoModalHostBlind.test.tsx — asserts GitHubRepoModal fetches and
 * creates repos through the active host's provider (makeGitHostProvider),
 * not the GitHub-specific listUserRepos.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { GitHubRepoModal } from '../components/modals/GitHubRepoModal'
import { useUIStore, useGitHubStore } from '../stores'

const listRepos = jest.fn()
const createRepo = jest.fn()
const makeGitHostProvider = jest.fn()
jest.mock('../utils/gitHost', () => ({
  makeGitHostProvider: (...args: unknown[]) => makeGitHostProvider(...args),
}))

beforeEach(() => {
  listRepos.mockReset()
  createRepo.mockReset()
  makeGitHostProvider.mockClear().mockReturnValue({ listRepos, createRepo })
  useGitHubStore.setState({
    token: 'pat-x',
    host: 'forgejo',
    baseUrl: 'https://codeberg.org',
    syncRepo: null,
  })
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
