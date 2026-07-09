/**
 * LIVE UI walkthrough: connect a Codeberg vault through the real host-picker UI.
 *
 * Unlike the jest live harness (e2eSyncLiveCodeberg.test.ts), which drives the
 * sync functions directly, this drives the actual browser UI end-to-end:
 *   host picker → Codeberg → paste real PAT → submit
 *     → provider.getAuthenticatedUser() against LIVE Codeberg
 *     → setHost('forgejo', codeberg.org) + setSession
 *     → repo picker → provider.listRepos() against LIVE Codeberg
 *
 * It proves the new connect/repo wiring actually reaches a real Forgejo host
 * from the UI. It does NOT push/pull (the jest harness covers real sync), so it
 * does not mutate the test repo.
 *
 * Requires CODEBERG_TEST_TOKEN in the env (loaded by scripts/run-e2e-ui-codeberg.js
 * from ~/.config/noteser/codeberg-test-token.env). Skips when absent so a normal
 * `playwright test` run never hits the network or needs a secret.
 */

import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from '../parity/_helpers'

const TOKEN = process.env.CODEBERG_TEST_TOKEN
const OWNER = process.env.CODEBERG_TEST_OWNER || 'rotecodefraktion'
const REPO = process.env.CODEBERG_TEST_REPO || 'noteser-codeberg-test'

test.describe('LIVE — connect a Codeberg vault via the host picker', () => {
  test.skip(!TOKEN, 'CODEBERG_TEST_TOKEN not set — live UI walkthrough skipped')

  test('paste a real PAT → authenticates against Codeberg → lists real repos', async ({ page }) => {
    await setupCleanVault(page)
    await page.goto('/')
    await waitForTestHooks(page)

    // Open the connect modal directly via the store (stable; avoids sidebar nav).
    await page.evaluate(() => {
      ;(window as any).__noteser_test.stores.uiStore.getState().openModal({ type: 'github-auth' })
    })

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Connect a vault')).toBeVisible({ timeout: 5_000 })

    // Pick Codeberg → PAT-only form (fixed codeberg.org preset, no base-URL field).
    await dialog.getByTestId('host-pick-codeberg').click()
    await expect(dialog.getByTestId('forgejo-pat-input')).toBeVisible({ timeout: 3_000 })
    await expect(dialog.getByTestId('forgejo-baseurl-input')).not.toBeVisible()

    // Paste the real PAT and submit. TOKEN comes from the env (never inlined).
    await dialog.getByTestId('forgejo-pat-input').fill(TOKEN!)
    await dialog.getByTestId('forgejo-pat-submit').click()

    // getAuthenticatedUser() ran against LIVE Codeberg and setSession/setHost fired.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const s = (window as any).__noteser_test.stores.githubStore.getState()
            return { host: s.host, baseUrl: s.baseUrl, hasToken: !!s.token, login: s.user?.login ?? null }
          }),
        { timeout: 15_000 },
      )
      .toMatchObject({ host: 'forgejo', baseUrl: 'https://codeberg.org', hasToken: true })

    const connected = await page.evaluate(() => {
      const s = (window as any).__noteser_test.stores.githubStore.getState()
      return { login: s.user?.login ?? null }
    })
    expect(connected.login, 'authenticated user login should be populated from Codeberg').toBeTruthy()

    // The repo picker opens and lists real Codeberg repos via provider.listRepos().
    await expect(dialog.getByText(`${OWNER}/${REPO}`)).toBeVisible({ timeout: 15_000 })
  })
})
