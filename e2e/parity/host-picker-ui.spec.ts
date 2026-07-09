/**
 * Focused sanity sweep: vault-connect modal host picker UI
 * (feat/host-picker-ui branch, merged into main via #25)
 *
 * Covers 5 scenarios without completing any live network submission:
 *  1. Host picker renders 3 options
 *  2. Codeberg branch: PAT form, NO base-URL field
 *  3. Forgejo branch: BOTH base-URL + PAT fields
 *  4. Forgejo base-URL validation fires on empty/invalid URL
 *  5. GitHub branch: device-flow UI (requesting or waiting)
 *
 * Screenshots are saved to .superpowers/sdd/qa-shots/ for the QA report.
 */

import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'
import * as path from 'path'

const SHOT_DIR = path.resolve(
  __dirname,
  '../../.superpowers/sdd/qa-shots',
)

async function shot(page: Parameters<typeof import('@playwright/test').expect>[0], name: string) {
  // @ts-expect-error page is a Page here
  await page.screenshot({
    path: path.join(SHOT_DIR, `host-picker-${name}.png`),
    fullPage: false,
  })
}

test.describe('Host-picker UI — vault connect modal', () => {
  test.beforeEach(async ({ page }) => {
    await setupCleanVault(page)
    await page.goto('/')
    await waitForTestHooks(page)

    // Open the modal directly via the store — avoids fragile sidebar nav.
    await page.evaluate(() => {
      ;(window as any).__noteser_test.stores.uiStore
        .getState()
        .openModal({ type: 'github-auth' })
    })

    // The modal must be visible before any scenario steps.
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('dialog').getByText('Connect a vault')).toBeVisible()
  })

  // ── Scenario 1 ──────────────────────────────────────────────────────────────
  test('1. host picker shows three options with correct testids', async ({ page }) => {
    const dialog = page.getByRole('dialog')

    await expect(dialog.getByTestId('host-pick-github')).toBeVisible()
    await expect(dialog.getByTestId('host-pick-codeberg')).toBeVisible()
    await expect(dialog.getByTestId('host-pick-forgejo')).toBeVisible()

    // Text labels
    await expect(dialog.getByTestId('host-pick-github')).toContainText('GitHub')
    await expect(dialog.getByTestId('host-pick-codeberg')).toContainText('Codeberg')
    await expect(dialog.getByTestId('host-pick-forgejo')).toContainText('Forgejo')

    await shot(page as any, '1-host-picker')
  })

  // ── Scenario 2 ──────────────────────────────────────────────────────────────
  test('2. Codeberg branch: PAT input shown, NO base-URL field', async ({ page }) => {
    const dialog = page.getByRole('dialog')

    await dialog.getByTestId('host-pick-codeberg').click()

    // PAT input and submit must appear
    await expect(dialog.getByTestId('forgejo-pat-input')).toBeVisible({ timeout: 3_000 })
    await expect(dialog.getByTestId('forgejo-pat-submit')).toBeVisible()

    // Base-URL field must NOT be present for Codeberg
    await expect(dialog.getByTestId('forgejo-baseurl-input')).not.toBeVisible()

    await shot(page as any, '2-codeberg-pat-form')
  })

  // ── Scenario 3 ──────────────────────────────────────────────────────────────
  test('3. Forgejo branch: BOTH base-URL and PAT fields visible', async ({ page }) => {
    const dialog = page.getByRole('dialog')

    await dialog.getByTestId('host-pick-forgejo').click()

    await expect(dialog.getByTestId('forgejo-baseurl-input')).toBeVisible({ timeout: 3_000 })
    await expect(dialog.getByTestId('forgejo-pat-input')).toBeVisible()
    await expect(dialog.getByTestId('forgejo-pat-submit')).toBeVisible()

    await shot(page as any, '3-forgejo-both-fields')
  })

  // ── Scenario 4 ──────────────────────────────────────────────────────────────
  test('4. Forgejo base-URL validation: empty URL + PAT → inline error, no crash', async ({ page }) => {
    const dialog = page.getByRole('dialog')

    await dialog.getByTestId('host-pick-forgejo').click()
    await expect(dialog.getByTestId('forgejo-pat-input')).toBeVisible({ timeout: 3_000 })

    // ── 4a: Empty base URL ──────────────────────────────────────────────────
    // Fill in a PAT but leave base URL empty
    await dialog.getByTestId('forgejo-pat-input').fill('a-fake-token-value')

    // The submit button should be enabled (PAT is non-empty)
    await expect(dialog.getByTestId('forgejo-pat-submit')).not.toBeDisabled()

    // Submit with empty URL → React validation fires (empty passes HTML5 URL
    // constraint but fails the custom regex check), so custom error DOES appear.
    await dialog.getByTestId('forgejo-pat-submit').click()
    await expect(dialog).toContainText('Enter your Forgejo/Gitea server URL', { timeout: 3_000 })

    // Modal must still be open (no crash / navigation)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Connect a vault')).toBeVisible()
    await shot(page as any, '4a-forgejo-url-validation-empty')

    // ── 4b: Invalid URL "notaurl" ───────────────────────────────────────────
    // The base-URL input is type="text" (NOT type="url") precisely so the
    // browser's native HTML5 constraint validation can't pre-empt our own
    // onSubmit handler. So a malformed-but-non-empty value like "notaurl"
    // still reaches the React regex check and surfaces the SAME custom inline
    // error as the empty case.
    await dialog.getByTestId('forgejo-baseurl-input').fill('notaurl')
    await dialog.getByTestId('forgejo-pat-submit').click()

    await expect(dialog).toContainText('Enter your Forgejo/Gitea server URL', { timeout: 3_000 })
    // The modal must still be open (no crash / navigation).
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Connect a vault')).toBeVisible()
    await shot(page as any, '4b-forgejo-url-validation-notaurl')
  })

  // ── Scenario 5 ──────────────────────────────────────────────────────────────
  test('5. GitHub branch: device-flow UI loads (requesting or waiting state)', async ({ page }) => {
    const dialog = page.getByRole('dialog')

    await dialog.getByTestId('host-pick-github').click()

    // The modal should remain open and switch to the GitHub device-flow view.
    // The device flow starts immediately; we'll see either the spinner
    // ("Requesting a device code") or the waiting state (user code + link).
    // We do NOT wait for a successful network call — just assert the UI changed.
    await expect(dialog).toBeVisible()

    // The device flow starts immediately; wait for the requesting spinner OR
    // the waiting-state code display (whichever the network allows first).
    // The PAT toggle link is present in BOTH states and is a stable signal.
    const isPATToggle = dialog.getByTestId('github-pat-toggle')
    await expect(isPATToggle).toBeVisible({ timeout: 10_000 })

    // Additionally verify that either the spinner text or the waiting-state
    // link is visible. Both states render one of these texts.
    const isRequesting = dialog.getByText(/Requesting a device code/i)
    const isWaiting = dialog.getByText(/Copy code & Open GitHub/i)
    // Use first() to avoid strict-mode failure when both locators match
    // (which can happen transiently as state transitions).
    await expect(isRequesting.or(isWaiting).first()).toBeVisible({ timeout: 10_000 })

    await shot(page as any, '5-github-device-flow')
  })
})
