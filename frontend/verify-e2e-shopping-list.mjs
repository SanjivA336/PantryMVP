// Ad-hoc Playwright verification for Phase 4 (shopping list): manual
// add/remove, sections, the "Suggest List" button, the tagged-vs-manual
// distinction, the dismissal rule (removed suggestion doesn't silently
// reappear), and live updates across a second browser session. Not a
// permanent test suite (Phase 13's job).
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'http://localhost:5173'
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
const PASSWORD = 'Burrow-E2E-ShopList-Test-123!'

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
const user = await createTestUser(`burrow-e2e-shoplist-${suffix}@example.com`)

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
    path: `${SHOTS}/shoplist-${String(shot).padStart(2, '0')}-${name}.png`,
    fullPage: true,
  })
}

async function login(page) {
  await page.goto(`${BASE}/login`)
  await page.waitForSelector('text=Log in to Burrow')
  await page.fill('input[type="email"]', user.email)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 10000 })
}

console.log('--- A: login + create household + storage ---')
await login(pageA)
await pageA.goto(`${BASE}/households/new`)
await pageA.waitForSelector('text=Create a household')
await pageA.fill('input[placeholder="3BR Apartment on Main St"]', 'Shopping List E2E House')
await pageA.fill('input[placeholder="Alex"]', 'Alex')
await pageA.click('button[type="submit"]')
await pageA.waitForURL(/\/households\/[0-9a-f-]+$/, { timeout: 10000 })
const householdId = pageA.url().split('/households/')[1]
console.log('household id:', householdId)

await pageA.goto(`${BASE}/households/${householdId}/storage`)
await pageA.waitForSelector('text=Storage locations')
await pageA.fill('input[placeholder="Name (e.g. Garage Fridge)"]', 'Test Fridge')
await pageA.click('button:has-text("Add")')
await pageA.waitForSelector('text=Test Fridge', { timeout: 15000 })

console.log('--- B: login, sit on Shopping List page ---')
await login(pageB)
await pageB.goto(`${BASE}/households/${householdId}/shopping-list`)
await pageB.waitForSelector('text=Nothing on the list yet.')

console.log('--- A: create a section, add a manual item into it ---')
await pageA.goto(`${BASE}/households/${householdId}/shopping-list`)
await pageA.waitForSelector('text=Shopping List')
await pageA.fill('input[placeholder="New section (e.g. Produce)"]', 'Household')
await pageA.click('button:has-text("+ Add section")')
// <option> elements are never "visible" per Playwright's rules (they only
// render when the <select> is open) -- wait for DOM attachment instead.
await pageA.waitForSelector('option:has-text("Household")', { state: 'attached' })

await pageA.fill('input[placeholder="Add an item (e.g. paper towels)"]', 'Paper towels')
await pageA.selectOption('select', { label: 'Household' })
await pageA.click('button:has-text("Add")')
await pageA.waitForSelector('text=Paper towels')
await snap(pageA, 'manual-item-in-section')

console.log('--- B: sees the manual item live, no reload ---')
await pageB.waitForSelector('text=Paper towels', { timeout: 15000 })
// Target the section heading specifically -- "text=Household" also matches
// the (non-visible) <option> in the add-item form's section dropdown.
await pageB.locator('h3', { hasText: 'Household' }).waitFor()
console.log('OK: B saw manual item + section live')

console.log('--- A: buy butter, consume down to low stock ---')
await pageA.goto(`${BASE}/households/${householdId}/inventory/add`)
await pageA.waitForSelector('text=Add an item')
await pageA.fill('input[placeholder="Search for a food (e.g. milk)"]', 'Butter')
const butterResult = pageA.getByRole('button', { name: 'Butter', exact: true })
await butterResult.waitFor()
await butterResult.click()
await pageA.fill('input[type="number"][step="any"]', '10')
await pageA.locator('select').nth(0).selectOption({ label: 'Test Fridge' })
await pageA.fill('input[type="number"][step="0.01"]', '5.00')
await pageA.click('button:has-text("Add item")')
await pageA.waitForURL(`${BASE}/households/${householdId}`, { timeout: 10000 })

const butterRow = pageA.locator('li', { hasText: 'Butter' })
await butterRow.locator('input[placeholder="Amount"]').fill('9')
await butterRow.locator('button:has-text("Use")').click()
await pageA.waitForSelector('text=1.0 / 10.0 g')

console.log('--- A: click Suggest List -> Butter appears, tagged Suggested ---')
await pageA.goto(`${BASE}/households/${householdId}/shopping-list`)
await pageA.waitForSelector('text=Shopping List')
await pageA.click('button:has-text("Suggest List")')
await pageA.waitForSelector('text=Butter')
const suggestedBadge = pageA.locator('li', { hasText: 'Butter' }).locator('text=Suggested')
await suggestedBadge.waitFor()
await snap(pageA, 'suggested-item-tagged')
console.log('OK: suggested item visibly tagged')

console.log('--- B: sees the suggested Butter live too ---')
await pageB.waitForSelector('text=Butter', { timeout: 15000 })

console.log('--- A: remove the suggested Butter, then Suggest List again -> stays removed ---')
const butterListItem = pageA.locator('li', { hasText: 'Butter' })
await butterListItem.locator('button:has-text("Remove")').click()
await butterListItem.waitFor({ state: 'detached', timeout: 10000 })

await pageA.click('button:has-text("Suggest List")')
await pageA.waitForTimeout(1000)
const butterStillGone = await pageA.locator('li', { hasText: 'Butter' }).count()
if (butterStillGone !== 0) {
  throw new Error('Removed suggestion silently reappeared after Suggest List was clicked again')
}
console.log('OK: dismissed suggestion did not reappear')
await snap(pageA, 'dismissal-holds')

console.log('--- console errors collected ---')
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)')

await browser.close()

console.log('--- cleanup: delete household then test user ---')
const signInRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: user.email, password: PASSWORD }),
})
const { access_token } = await signInRes.json()
await fetch(`${env.VITE_API_BASE_URL}/api/households/${householdId}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${access_token}` },
})
await deleteTestUser(user.id)

console.log('\nRESULT_JSON:' + JSON.stringify({ householdId, consoleErrors, ok: true }))
