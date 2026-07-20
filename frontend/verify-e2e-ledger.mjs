// Ad-hoc Playwright verification for Phase 2c: the accounting-type selector
// on the add-item form, the Balances page, and — the part that can only be
// verified in a real browser — Realtime actually pushing live updates to a
// *second* browser session without that session ever reloading or
// navigating away. Not a permanent test suite (Phase 13's job).
//
// Provisions two real Supabase Auth users via the Admin API (same approach
// as the backend's pytest integration suite) and drives two separate
// Playwright browser contexts as two different household members.
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'http://localhost:5173'
// Reuses the already-gitignored e2e-shots/ directory (see .gitignore —
// it's an exact-name match, not a prefix, so a differently-named dir
// wouldn't be ignored).
const SHOTS = './e2e-shots'
mkdirSync(SHOTS, { recursive: true })

function loadRootEnv() {
  const text = readFileSync(path.resolve(__dirname, '..', '.env'), 'utf-8')
  const env = {}
  for (const line of text.split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (match) env[match[1]] = match[2]
  }
  return env
}

const env = loadRootEnv()
const SUPABASE_URL = env.SUPABASE_URL
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const PASSWORD = 'Burrow-E2E-Ledger-Test-123!'

async function createTestUser(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  })
  if (!res.ok) throw new Error(`create_test_user failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function deleteTestUser(id) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  })
}

function trackConsole(page, label, errors) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[${label}] ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`[${label}] pageerror: ${err.message}`))
}

const suffix = Date.now().toString(36)
const userA = await createTestUser(`burrow-e2e-ledger-a-${suffix}@example.com`)
const userB = await createTestUser(`burrow-e2e-ledger-b-${suffix}@example.com`)

const browser = await chromium.launch()
const consoleErrors = []

const contextA = await browser.newContext()
const pageA = await contextA.newPage()
trackConsole(pageA, 'A', consoleErrors)

const contextB = await browser.newContext()
const pageB = await contextB.newPage()
trackConsole(pageB, 'B', consoleErrors)

let shot = 0
const snap = async (page, name) => {
  shot += 1
  await page.screenshot({
    path: `${SHOTS}/ledger-${String(shot).padStart(2, '0')}-${name}.png`,
    fullPage: true,
  })
}

async function login(page, email) {
  await page.goto(`${BASE}/login`)
  await page.waitForSelector('text=Log in to Burrow')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 10000 })
}

console.log('--- A: login + create household ---')
await login(pageA, userA.email)
await pageA.goto(`${BASE}/households/new`)
await pageA.waitForSelector('text=Create a household')
await pageA.fill('input[placeholder="3BR Apartment on Main St"]', 'Ledger E2E House')
await pageA.fill('input[placeholder="Alex"]', 'Alex')
await pageA.click('button[type="submit"]')
await pageA.waitForURL(/\/households\/[0-9a-f-]+$/, { timeout: 10000 })
const householdId = pageA.url().split('/households/')[1]
const joinCode = await pageA
  .locator('text=Join code:')
  .textContent()
  .then((t) => t.replace('Join code:', '').trim())
console.log('household id:', householdId, 'join code:', joinCode)

console.log('--- A: add a storage location ---')
await pageA.goto(`${BASE}/households/${householdId}/storage`)
await pageA.waitForSelector('text=Storage locations')
await pageA.fill('input[placeholder="Name (e.g. Garage Fridge)"]', 'Shared Fridge')
await pageA.click('button:has-text("Add")')
await pageA.waitForSelector('text=Shared Fridge', { timeout: 15000 })

console.log('--- B: login + join household by code ---')
await login(pageB, userB.email)
await pageB.goto(`${BASE}/households/join`)
await pageB.waitForSelector('text=Join a household')
await pageB.fill('input[placeholder="ABCD2345"]', joinCode)
await pageB.fill('input[placeholder="Alex"]', 'Blair')
await pageB.click('button[type="submit"]')
await pageB.waitForURL(`${BASE}/households/${householdId}`, { timeout: 10000 })

console.log('--- B: sit on the Balances page (baseline, nothing owed yet) ---')
await pageB.goto(`${BASE}/households/${householdId}/balances`)
await pageB.waitForSelector('text=All settled up')
await snap(pageB, 'balances-empty')

console.log('--- A: add a UNIT_BASED item split with B, no reload triggered on B ---')
await pageA.goto(`${BASE}/households/${householdId}/inventory/add`)
await pageA.waitForSelector('text=Add an item')
await pageA.fill('input[placeholder="Search for a food (e.g. milk)"]', 'Whole Milk')
const milkResult = pageA.getByRole('button', { name: 'Whole Milk', exact: true })
await milkResult.waitFor()
await milkResult.click()
await pageA.fill('input[type="number"][step="any"]', '10')
await pageA.locator('select').nth(0).selectOption({ label: 'Shared Fridge' })
await pageA.fill('input[type="number"][step="0.01"]', '10.00')
await pageA.locator('select').nth(1).selectOption({
  label: 'Unit-based — split evenly, but charge extra to whoever goes over their share',
})
await snap(pageA, 'add-item-unit-based')
await pageA.click('button:has-text("Add item")')
await pageA.waitForURL(`${BASE}/households/${householdId}`, { timeout: 10000 })

console.log('--- B: balance should appear via Realtime, with no reload/navigation ---')
await pageB.waitForSelector('text=/owes/', { timeout: 15000 })
// Screenshots taken in the same tick as waitForSelector resolving can catch
// a pre-paint frame (Playwright/CDP quirk, not app state) -- a beat here is
// just for a clean screenshot; the real pass/fail check is the textContent
// read below, which is correct even without this wait.
await pageB.waitForTimeout(200)
await snap(pageB, 'balances-live-updated')
const balanceText = await pageB.locator('li:has-text("owes")').first().textContent()
console.log('balance seen by B (via realtime):', balanceText)
if (!balanceText.includes('$5.00')) {
  throw new Error(`Expected a $5.00 balance (10.00 / 2 members), got: ${balanceText}`)
}

console.log('--- B: sit on Inventory page, A discards the item, B sees it vanish live ---')
await pageB.goto(`${BASE}/households/${householdId}`)
await pageB.waitForSelector('text=Whole Milk')
await pageA.goto(`${BASE}/households/${householdId}`)
await pageA.waitForSelector('text=Whole Milk')
await pageA.click('button:has-text("Discard")')
await pageA.waitForSelector('text=Nothing in inventory yet.')
await pageB.waitForSelector('text=Nothing in inventory yet.', { timeout: 15000 })
await snap(pageB, 'inventory-live-discarded')

console.log('--- console errors collected ---')
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)')

await browser.close()

console.log('--- cleanup: delete household (cascade) then both test users ---')
// households.created_by_user_id is ON DELETE RESTRICT (see the master plan)
// -- the household must go first, or deleting userA below would fail.
const signInRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: userA.email, password: PASSWORD }),
})
const { access_token } = await signInRes.json()
await fetch(`${env.VITE_API_BASE_URL}/api/households/${householdId}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${access_token}` },
})
await deleteTestUser(userA.id)
await deleteTestUser(userB.id)

console.log('\nRESULT_JSON:' + JSON.stringify({ householdId, consoleErrors, ok: true }))
