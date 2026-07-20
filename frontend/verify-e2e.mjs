// Ad-hoc Playwright verification script — NOT a permanent test suite
// (that's Phase 13's job). Drives the real UI in a real browser and
// screenshots each step so a human (or Claude) can actually look at it.
//
// Uses a pre-provisioned user (via Supabase's Admin API, same as the pytest
// integration suite) and drives the LOGIN form — Supabase's hosted-project
// email rate limit gets exhausted fast by repeated real signups.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:5173'
const SHOTS = './e2e-shots'
mkdirSync(SHOTS, { recursive: true })

const [email, , password] = process.argv[2].split('|')

const consoleErrors = []

function trackConsole(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[${label}] ${msg.text()}`)
  })
  page.on('pageerror', (err) => consoleErrors.push(`[${label}] pageerror: ${err.message}`))
}

const browser = await chromium.launch()
const page = await browser.newPage()
trackConsole(page, 'A')

let shot = 0
const snap = async (name) => {
  shot += 1
  await page.screenshot({
    path: `${SHOTS}/${String(shot).padStart(2, '0')}-${name}.png`,
    fullPage: true,
  })
}

console.log('--- login ---')
await page.goto(`${BASE}/login`)
await page.waitForSelector('text=Log in to Burrow')
await page.fill('input[type="email"]', email)
await page.fill('input[type="password"]', password)
await page.click('button[type="submit"]')
await page.waitForURL(`${BASE}/`, { timeout: 10000 })

console.log('--- create household ---')
await page.goto(`${BASE}/households/new`)
await page.waitForSelector('text=Create a household')
await page.fill('input[placeholder="3BR Apartment on Main St"]', 'Inventory Test House')
await page.fill('input[placeholder="Alex"]', 'Alex')
await page.click('button[type="submit"]')
await page.waitForURL(/\/households\/[0-9a-f-]+$/, { timeout: 10000 })
const householdId = page.url().split('/households/')[1]
console.log('household id:', householdId)

console.log('--- inventory tab is the default landing page ---')
await page.waitForSelector('text=Nothing in inventory yet.')
await snap('inventory-empty')

console.log('--- add a storage location first ---')
await page.goto(`${BASE}/households/${householdId}/storage`)
await page.waitForSelector('text=Storage locations')
await page.fill('input[placeholder="Name (e.g. Garage Fridge)"]', 'Kitchen Fridge')
await page.click('button:has-text("Add")')
await page.waitForSelector('text=Kitchen Fridge', { timeout: 15000 })

console.log('--- go add an inventory item ---')
await page.goto(`${BASE}/households/${householdId}/inventory/add`)
await page.waitForSelector('text=Add an item')
await snap('add-item-empty')

console.log('--- search for a seeded food ---')
await page.fill('input[placeholder="Search for a food (e.g. milk)"]', 'Whole Milk')
// Exact-match, not substring: "+ Create \"Whole Milk\"" also contains the
// text "Whole Milk", so a substring selector matches both buttons and can
// resolve on the (always-present) Create button before real search results
// even arrive.
const milkResult = page.getByRole('button', { name: 'Whole Milk', exact: true })
await milkResult.waitFor()
await snap('food-search-results')
await milkResult.click()
await snap('food-selected')

console.log('--- fill the rest of the form ---')
await page.fill('input[type="number"][step="any"]', '2')
await page.selectOption('select', { label: 'Kitchen Fridge' })
await page.fill('input[type="number"][step="0.01"]', '4.99')
await snap('add-item-filled')
await page.click('button:has-text("Add item")')
await page.waitForURL(`${BASE}/households/${householdId}`, { timeout: 10000 })

console.log('--- item shows in inventory list ---')
await page.waitForSelector('text=Whole Milk')
await snap('inventory-with-item')

console.log('--- consume part of it ---')
await page.fill('input[placeholder="Amount"]', '1')
await page.click('button:has-text("Use")')
await page.waitForSelector('text=1.0 / 2.0 ml')
await snap('inventory-after-consume')

console.log('--- try to consume more than remains (should show an error, not crash) ---')
await page.fill('input[placeholder="Amount"]', '99')
await page.click('button:has-text("Use")')
await page.waitForSelector('text=/remaining quantity/i')
await snap('inventory-overconsume-error')

console.log('--- discard the item ---')
await page.click('button:has-text("Discard")')
await page.waitForSelector('text=Nothing in inventory yet.')
await snap('inventory-after-discard')

console.log('--- console errors collected ---')
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)')

console.log('\nRESULT_JSON:' + JSON.stringify({ householdId, consoleErrors }))

await browser.close()
