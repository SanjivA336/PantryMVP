// Ad-hoc Playwright verification for Phase 5 (recipes, manual creation
// only): create with multiple ingredients + steps, view detail with
// availability matching against real inventory, serving-scale multiplier,
// edit (replaces ingredients), delete, and the two stub buttons. Not a
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
const PASSWORD = 'Burrow-E2E-Recipes-Test-123!'

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
const user = await createTestUser(`burrow-e2e-recipes-${suffix}@example.com`)

const browser = await chromium.launch()
const consoleErrors = []
const page = await browser.newPage()
trackConsole(page, 'A', consoleErrors)

let shot = 0
const snap = async (name) => {
  shot += 1
  await page.screenshot({
    path: `${SHOTS}/recipes-${String(shot).padStart(2, '0')}-${name}.png`,
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
await page.fill('input[placeholder="3BR Apartment on Main St"]', 'Recipes E2E House')
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

console.log('--- buy 200g of butter (for the "have it" ingredient) ---')
await page.goto(`${BASE}/households/${householdId}/inventory/add`)
await page.waitForSelector('text=Add an item')
await page.fill('input[placeholder="Search for a food (e.g. milk)"]', 'Butter')
const butterResult = page.getByRole('button', { name: 'Butter', exact: true })
await butterResult.waitFor()
await butterResult.click()
await page.fill('input[type="number"][step="any"]', '200')
await page.locator('select').nth(0).selectOption({ label: 'Test Fridge' })
await page.fill('input[type="number"][step="0.01"]', '3.00')
await page.click('button:has-text("Add item")')
await page.waitForURL(`${BASE}/households/${householdId}`, { timeout: 10000 })

console.log('--- create a recipe with 2 ingredients (butter: have it, milk: missing) ---')
await page.goto(`${BASE}/households/${householdId}/recipes/new`)
await page.waitForSelector('text=New recipe')
await page.fill('input[name="name"]', 'Pancakes')
await page.fill('textarea[name="description"]', 'Fluffy breakfast pancakes')
await page.fill('input[name="servings"]', '4')
await page.fill('input[name="prep_time_minutes"]', '10')
await page.fill('input[name="cook_time_minutes"]', '15')

// Ingredient 1: Butter (50g, unit matches the 200g purchase's "g").
await page
  .locator('input[placeholder="Search for a food (e.g. milk)"]')
  .first()
  .fill('Butter')
const butterOption = page.getByRole('button', { name: 'Butter', exact: true })
await butterOption.waitFor()
await butterOption.click()
await page.locator('input[placeholder="Qty"]').first().fill('50')
await page.locator('input[placeholder="Unit"]').first().fill('g')

await page.click('button:has-text("+ Add ingredient")')
// After picking Butter above, its row's search input is replaced by a
// "selected" summary -- only the new row's search input remains, at index 0.
await page.locator('input[placeholder="Search for a food (e.g. milk)"]').first().fill('Whole Milk')
const milkOption = page.getByRole('button', { name: 'Whole Milk', exact: true })
await milkOption.waitFor()
await milkOption.click()
await page.locator('input[placeholder="Qty"]').nth(1).fill('2')
await page.locator('input[placeholder="Unit"]').nth(1).fill('cup')

await page.fill('textarea >> nth=1', 'Mix wet and dry ingredients')
await page.click('button:has-text("+ Add step")')
await page.fill('textarea >> nth=2', 'Cook on a griddle until golden')

await snap('create-form-filled')
await page.click('button:has-text("Create recipe")')
await page.waitForURL(/\/recipes\/[0-9a-f-]+$/, { timeout: 10000 })

console.log('--- detail page: availability reflects real inventory ---')
await page.waitForSelector('text=Pancakes')
await page.waitForSelector('text=In stock')
await page.waitForSelector('text=Missing')
await snap('detail-availability')
console.log('OK: Butter shows In stock, Milk shows Missing')

console.log('--- scale servings from 4 to 8, quantities double ---')
await page.fill('input[type="number"][min="1"]', '8')
await page.waitForSelector('text=100 g')
await snap('detail-scaled')
console.log('OK: 50g butter scaled to 100g at 8 servings')

console.log('--- edit: replace ingredients with just milk ---')
await page.click('text=Edit')
await page.waitForSelector('text=Edit recipe')
// Remove the (pre-filled) Butter row, keep Milk.
await page.locator('button:has-text("Remove")').first().click()
await page.click('button:has-text("Save changes")')
await page.waitForURL(/\/recipes\/[0-9a-f-]+$/, { timeout: 10000 })
await page.waitForSelector('text=Whole Milk')
const butterGone = await page.locator('text=Butter').count()
if (butterGone !== 0) throw new Error('Expected Butter to be removed from ingredients after edit')
console.log('OK: edit replaced the ingredient list')

console.log('--- delete recipe ---')
await page.click('text=Delete')
await page.waitForURL(`${BASE}/households/${householdId}/recipes`, { timeout: 10000 })
await page.waitForSelector('text=No recipes yet.')
console.log('OK: recipe deleted')

console.log('--- stub buttons render under-construction ---')
await page.click('text=Import from URL')
await page.waitForSelector('text=Recipe Import')
await page.goBack()
await page.click('text=Generate with AI')
await page.waitForSelector('text=AI Recipe Generation')
console.log('OK: both stubs render')

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
