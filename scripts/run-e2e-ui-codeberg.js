/* eslint-disable @typescript-eslint/no-require-imports */
// Runner for the LIVE Codeberg UI walkthrough (e2e/live/codeberg-ui-connect.spec.ts).
//
// Loads the test token from ~/.config/noteser/codeberg-test-token.env into the
// environment, then runs Playwright on ONLY that spec. The token value is never
// printed, echoed, or passed on the command line — it is read from the file and
// handed to the child process via its environment, the same way the jest live
// harness runner (run-e2e-sync-codeberg.js) does.
//
// Usage: npm run e2e:ui:codeberg

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const TOKEN_FILE = path.join(os.homedir(), '.config', 'noteser', 'codeberg-test-token.env')
const TOKEN_KEY = 'CODEBERG_TEST_TOKEN'

function loadTokenEnv() {
  let raw
  try {
    raw = fs.readFileSync(TOKEN_FILE, 'utf8')
  } catch {
    console.error(`[e2e:ui:codeberg] Token file not found at ${TOKEN_FILE}.`)
    console.error('[e2e:ui:codeberg] The live UI walkthrough needs CODEBERG_TEST_TOKEN to run.')
    process.exit(1)
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (key) process.env[key] = val
  }
  if (!process.env[TOKEN_KEY]) {
    console.error(`[e2e:ui:codeberg] ${TOKEN_KEY} not present in ${TOKEN_FILE}.`)
    process.exit(1)
  }
}

loadTokenEnv()

const result = spawnSync(
  process.execPath,
  [
    path.join('node_modules', '.bin', 'playwright'),
    'test',
    'e2e/live/codeberg-ui-connect.spec.ts',
    '--reporter=list',
  ],
  { stdio: 'inherit', env: process.env },
)

process.exit(result.status ?? 1)
