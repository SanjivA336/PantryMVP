// Ad-hoc Playwright verification for Phase 3 (the warnings layer): expiry
// badges on individual items, the low/out-of-stock summary banner (which
// has no single item to badge, since "out of stock" means zero ACTIVE items
// exist), and that both update live in a second browser session via
// Realtime. Not a permanent test suite (Phase 13's job).
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
const PASSWORD = 'Burrow-E2E-Warnings-Test-123!'

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
const user = await createTestUser(`burrow-e2e-warnings-${suffix}@example.com`)

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
    path: `${SHOTS}/warnings-${String(shot).padStart(2, '0')}-${name}.png`,
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

async function addItem(page, householdId, { foodName, quantity, expiryDate }) {
  await page.goto(`${BASE}/households/${householdId}/inventory/add`)
  await page.waitForSelector('text=Add an item')
  await page.fill('input[placeholder="Search for a food (e.g. milk)"]', foodName)
  const result = page.getByRole('button', { name: foodName, exact: true })
  await result.waitFor()
  await result.click()
  await page.fill('input[type="number"][step="any"]', quantity)
  await page.locator('select').nth(0).selectOption({ label: 'Test Fridge' })
  await page.fill('input[type="number"][step="0.01"]', '5.00')
  if (expiryDate) {
    await page.fill('input[type="date"] >> nth=0', expiryDate)
  }
  await page.click('button:has-text("Add item")')
  await page.waitForURL(`${BASE}/households/${householdId}`, { timeout: 10000 })
}

console.log('--- A: login + create household + storage ---')
await login(pageA)
await pageA.goto(`${BASE}/households/new`)
await pageA.waitForSelector('text=Create a household')
await pageA.fill('input[placeholder="3BR Apartment on Main St"]', 'Warnings E2E House')
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

console.log('--- A: add milk expiring tomorrow ---')
const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
await addItem(pageA, householdId, { foodName: 'Whole Milk', quantity: '10', expiryDate: tomorrow })

console.log('--- A: expiry badge visible on the milk row ---')
await pageA.waitForSelector('text=/Expires in (0|1) day/')
await snap(pageA, 'expiry-badge')
console.log('OK: expiry badge rendered')

console.log('--- B: sit on Inventory page, sees the same badge on load ---')
await login(pageB)
await pageB.goto(`${BASE}/households/${householdId}`)
await pageB.waitForSelector('text=/Expires in (0|1) day/')

console.log('--- A: add butter, then consume down to low stock ---')
await addItem(pageA, householdId, { foodName: 'Butter', quantity: '10' })
await pageA.waitForSelector('text=Butter')
const butterRow = pageA.locator('li', { hasText: 'Butter' })
await butterRow.locator('input[placeholder="Amount"]').fill('9')
await butterRow.locator('button:has-text("Use")').click()
await pageA.waitForSelector('text=1.0 / 10.0 g')

console.log('--- B: low-stock banner appears live, no reload ---')
await pageB.waitForSelector('text=Running low:', { timeout: 15000 })
await pageB.waitForTimeout(200)
await snap(pageB, 'low-stock-banner')
const lowStockText = await pageB.locator('p:has-text("Running low:")').textContent()
console.log('B sees (via realtime):', lowStockText)
if (!lowStockText.includes('Butter')) throw new Error(`Expected Butter in low-stock banner, got: ${lowStockText}`)

console.log('--- A: consume the rest of the butter -> out of stock ---')
const butterRowAgain = pageA.locator('li', { hasText: 'Butter' })
await butterRowAgain.locator('input[placeholder="Amount"]').fill('1')
await butterRowAgain.locator('button:has-text("Use")').click()
await butterRowAgain.waitFor({ state: 'detached', timeout: 10000 })

console.log('--- B: out-of-stock banner appears live, no reload ---')
await pageB.waitForSelector('text=Out of stock:', { timeout: 15000 })
await snap(pageB, 'out-of-stock-banner')
const outOfStockText = await pageB.locator('p:has-text("Out of stock:")').textContent()
console.log('B sees (via realtime):', outOfStockText)
if (!outOfStockText.includes('Butter')) throw new Error(`Expected Butter in out-of-stock banner, got: ${outOfStockText}`)

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
