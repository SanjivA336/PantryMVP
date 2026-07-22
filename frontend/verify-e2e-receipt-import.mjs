// Ad-hoc Playwright verification for Phase 6 (receipt scanning, manual
// review only): both capture inputs render, a real upload goes through the
// real Storage-RLS-gated pipeline and lands cleanly on FAILED (no Google
// Vision API key is configured in this dev environment -- that's expected,
// and confirms the whole upload+process error path works instead of
// crashing). Since we can't drive a real OCR call here, a session with
// already-parsed items is seeded directly via the service-role client
// (mirroring how the backend's own integration tests monkeypatch run_ocr)
// so the review/confirm/finalize UI can be verified end-to-end for real.
// Not a permanent test suite (Phase 13's job).
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
const PASSWORD = 'Burrow-E2E-Receipts-Test-123!'

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
const user = await createTestUser(`burrow-e2e-receipts-${suffix}@example.com`)

const browser = await chromium.launch()
const consoleErrors = []
const page = await browser.newPage()
trackConsole(page, 'A', consoleErrors)

let shot = 0
const snap = async (name) => {
  shot += 1
  await page.screenshot({
    path: `${SHOTS}/receipts-${String(shot).padStart(2, '0')}-${name}.png`,
    fullPage: true,
  })
}

console.log('--- login + create household + storage ---')
await page.goto(`${BASE}/login`)
await page.waitForSelector('text=Log in to Burrow')
await page.fill('input[type="email"]', user.email)
await page.fill('input[type="password"]', PASSWORD)
await page.click('button[type="submit"]')
await page.waitForURL(`${BASE}/`, { timeout: 10000 })

await page.goto(`${BASE}/households/new`)
await page.waitForSelector('text=Create a household')
await page.fill('input[placeholder="3BR Apartment on Main St"]', 'Receipts E2E House')
await page.fill('input[placeholder="Alex"]', 'Alex')
await page.click('button[type="submit"]')
await page.waitForURL(/\/households\/[0-9a-f-]+$/, { timeout: 10000 })
const householdId = page.url().split('/households/')[1]
console.log('household id:', householdId)

await page.goto(`${BASE}/households/${householdId}/storage`)
await page.waitForSelector('text=Storage locations')
await page.fill('input[placeholder="Name (e.g. Garage Fridge)"]', 'Test Fridge')
await page.click('button:has-text("Add")')
await page.waitForSelector('text=Test Fridge', { timeout: 15000 })

async function getAccessToken(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const data = await res.json()
  return data.access_token
}
const accessToken = await getAccessToken(user.email)
const membersData = await (
  await fetch(`${env.VITE_API_BASE_URL}/api/households/${householdId}/members`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
).json()
const memberId = membersData.data[0].id

console.log('--- scan-receipt page: both capture inputs render ---')
await page.goto(`${BASE}/households/${householdId}/scan-receipt`)
await page.waitForSelector('text=Scan Receipt')
const uploadInput = page.locator('input[type="file"]').nth(0)
const captureInput = page.locator('input[type="file"][capture="environment"]')
await uploadInput.waitFor({ state: 'attached' })
await captureInput.waitFor({ state: 'attached' })
console.log('OK: upload input and capture input both present')
await snap('scan-receipt-page')

console.log('--- upload a real image -> real Storage upload -> process -> FAILED (no API key) ---')
const fixtureImage = path.resolve(__dirname, 'e2e-shots', '01-inventory-empty.png')
await uploadInput.setInputFiles(fixtureImage)
await page.waitForURL(/\/scan-receipt\/[0-9a-f-]+$/, { timeout: 15000 })
await page.waitForSelector('text=Scan failed', { timeout: 15000 })
await page.waitForSelector('text=Retry')
console.log('OK: real upload + process pipeline cleanly reached FAILED (expected: no OCR API key configured)')
await snap('scan-failed-no-api-key')
const failedSessionId = page.url().split('/scan-receipt/')[1]

console.log('--- seed a COMPLETED session with parsed items directly (bypassing real OCR) ---')
const seededSessionId = crypto.randomUUID()
const seedPath = `${householdId}/${seededSessionId}.jpg`
await fetch(`${SUPABASE_URL}/storage/v1/object/receipt-images/${seedPath}`, {
  method: 'POST',
  headers: {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'image/jpeg',
  },
  body: readFileSync(fixtureImage),
})
await fetch(`${SUPABASE_URL}/rest/v1/receipt_import_sessions`, {
  method: 'POST',
  headers: {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  },
  body: JSON.stringify({
    id: seededSessionId,
    household_id: householdId,
    created_by_member_id: memberId,
    status: 'COMPLETED',
    image_path: seedPath,
    ocr_engine: 'google_vision',
    raw_ocr_text: 'WHOLE MILK 4.99',
    processed_at: new Date().toISOString(),
  }),
})
const itemId = crypto.randomUUID()
await fetch(`${SUPABASE_URL}/rest/v1/receipt_import_items`, {
  method: 'POST',
  headers: {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  },
  body: JSON.stringify({
    id: itemId,
    session_id: seededSessionId,
    position: 0,
    raw_line_text: 'WHOLE MILK 4.99',
    parsed_name: 'WHOLE MILK',
    parsed_price: '4.99',
    cost: '4.99',
    status: 'NEEDS_REVIEW',
  }),
})

console.log('--- review page: confirm the seeded item, then finalize ---')
await page.goto(`${BASE}/households/${householdId}/scan-receipt/${seededSessionId}`)
await page.waitForSelector('text=Review scanned items')
await page.waitForSelector('text=Scanned as: "WHOLE MILK 4.99"')
await snap('review-page-seeded-item')

await page.fill('input[placeholder="Search for a food (e.g. milk)"]', 'Whole Milk')
const milkOption = page.getByRole('button', { name: 'Whole Milk', exact: true })
await milkOption.waitFor()
await milkOption.click()
await page.fill('input[placeholder="Unit"]', 'count')
await page.locator('select').first().selectOption({ label: 'Test Fridge' })
await page.click('button:has-text("Confirm")')
await page.waitForSelector('button:has-text("Finalize"):not([disabled])', { timeout: 10000 })
await snap('review-page-confirmed')

await page.click('button:has-text("Finalize")')
await page.waitForURL(`${BASE}/households/${householdId}`, { timeout: 10000 })
await page.waitForSelector('text=Whole Milk')
console.log('OK: finalize imported the confirmed item into inventory')
await snap('inventory-after-finalize')

console.log('--- console errors collected ---')
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)')

await browser.close()

console.log('--- cleanup: delete household, seeded storage object, test user ---')
await fetch(`${env.VITE_API_BASE_URL}/api/households/${householdId}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${accessToken}` },
})
await fetch(`${SUPABASE_URL}/storage/v1/object/receipt-images/${seedPath}`, {
  method: 'DELETE',
  headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
})
await deleteTestUser(user.id)

console.log(
  '\nRESULT_JSON:' +
    JSON.stringify({ householdId, failedSessionId, seededSessionId, consoleErrors, ok: true }),
)
