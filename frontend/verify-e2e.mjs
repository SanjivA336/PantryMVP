// Ad-hoc Playwright verification script for Phase 1 — NOT a permanent test
// suite (that's Phase 13's job). Drives the real UI in a real browser and
// screenshots each step so a human (or Claude) can actually look at it.
//
// Uses pre-provisioned users (via Supabase's Admin API, same as the pytest
// RLS suite) and drives the LOGIN form rather than signup — Supabase's
// hosted-project email rate limit was exhausted by earlier manual testing,
// so repeated real signups fail with "email rate limit exceeded". The
// signup form's render + submit-call correctness were already verified
// directly; this run covers everything after login.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:5173'
const SHOTS = './e2e-shots'
mkdirSync(SHOTS, { recursive: true })

const [emailA, emailB, , , password] = process.argv[2].split('|')

const consoleErrors = []

function trackConsole(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(`[${label}] ${msg.text()}`)
    }
  })
  page.on('pageerror', (err) => {
    consoleErrors.push(`[${label}] pageerror: ${err.message}`)
  })
}

const browser = await chromium.launch()
const ctxA = await browser.newContext()
const ctxB = await browser.newContext()
const pageA = await ctxA.newPage()
const pageB = await ctxB.newPage()
trackConsole(pageA, 'A')
trackConsole(pageB, 'B')

let shot = 0
const snap = async (page, name) => {
  shot += 1
  await page.screenshot({
    path: `${SHOTS}/${String(shot).padStart(2, '0')}-${name}.png`,
    fullPage: true,
  })
}

async function login(page, email) {
  await page.goto(`${BASE}/login`)
  await page.waitForSelector('text=Log in to Burrow')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 10000 })
}

console.log('--- A: login ---')
await snap(pageA, 'a-login-page-before')
await login(pageA, emailA)
await snap(pageA, 'a-after-login')

console.log('--- A: create household ---')
await pageA.goto(`${BASE}/households/new`)
await pageA.waitForSelector('text=Create a household')
await snap(pageA, 'a-create-household-page')
await pageA.fill('input[placeholder="3BR Apartment on Main St"]', 'Playwright Test House')
await pageA.fill('input[placeholder="Alex"]', 'Alex')
await pageA.click('button[type="submit"]')
await pageA.waitForURL(/\/households\/[0-9a-f-]+$/, { timeout: 10000 })
await snap(pageA, 'a-household-members-page')

const householdUrl = pageA.url()
const householdId = householdUrl.split('/households/')[1]
console.log('household id:', householdId)

const joinCodeText = await pageA.locator('text=Join code:').textContent()
const joinCode = joinCodeText.replace('Join code:', '').trim()
console.log('join code:', joinCode)

console.log('--- B: login ---')
await login(pageB, emailB)

console.log('--- B: join by code ---')
await pageB.goto(`${BASE}/households/join`)
await pageB.waitForSelector('text=Join a household')
await snap(pageB, 'b-join-household-page')
await pageB.fill('input[placeholder="ABCD2345"]', joinCode.toLowerCase())
await pageB.fill('input[placeholder="Alex"]', 'Blair')
await pageB.click('button[type="submit"]')
await pageB.waitForURL(`${BASE}/households/${householdId}`, { timeout: 10000 })
await snap(pageB, 'b-joined-household')

console.log('--- A: reload members page, should show both ---')
await pageA.reload()
await pageA.waitForSelector('text=Blair')
await snap(pageA, 'a-members-with-blair')

console.log('--- A: promote Blair to admin ---')
await pageA.click('button:has-text("Make admin")')
await pageA.waitForSelector('button:has-text("Revoke admin")')
await snap(pageA, 'a-blair-promoted')

console.log('--- A: storage tab ---')
await pageA.goto(`${BASE}/households/${householdId}/storage`)
await pageA.waitForSelector('text=Storage locations')
await snap(pageA, 'a-storage-page-empty')
await pageA.fill('input[placeholder="Name (e.g. Garage Fridge)"]', 'Garage Fridge')
await pageA.fill('input[placeholder="Description (optional)"]', 'Overflow fridge')
await pageA.click('button:has-text("Add")')
await pageA.waitForSelector('text=Garage Fridge')
await snap(pageA, 'a-storage-created')

console.log('--- A: stub pages ---')
for (const path of ['shopping-list', 'recipes', 'scan-receipt']) {
  await pageA.goto(`${BASE}/households/${householdId}/${path}`)
  await pageA.waitForSelector('text=under construction')
  await snap(pageA, `a-stub-${path}`)
}

console.log('--- console errors collected ---')
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)')

console.log('\nRESULT_JSON:' + JSON.stringify({ householdId, joinCode, consoleErrors }))

await browser.close()
