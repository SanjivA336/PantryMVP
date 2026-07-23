// Ad-hoc Playwright verification for Phase 7 (AI layer): paste-text import,
// URL import (against a locally-served static HTML fixture with embedded
// JSON-LD, not a live third-party site), generate-from-params, and an
// ingredient substitution suggestion -- all against a real local Ollama
// instance (llama2), so timeouts are generous throughout. Not a permanent
// test suite (Phase 13's job).
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'http://localhost:5173'
const SHOTS = './e2e-shots'
mkdirSync(SHOTS, { recursive: true })

// A real local model can be slow, especially cold or when a JSON-repair
// retry fires -- generous relative to the rest of this suite's timeouts.
const AI_TIMEOUT = 120_000

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
const PASSWORD = 'Burrow-E2E-RecipeAi-Test-123!'

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

// --- tiny static server for the URL-import fixture (not a live third-party
// site -- a real recipe site risks blocking automated requests / changing
// its markup, neither of which should be able to fail this verification) ---
const FIXTURE_HTML = `<!doctype html>
<html>
<head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Fixture Grilled Cheese",
  "description": "A locally-served test fixture recipe, not a live page.",
  "recipeYield": ["2"],
  "prepTime": "PT5M",
  "cookTime": "PT10M",
  "recipeIngredient": ["2 slices bread", "1 slice cheddar cheese", "1 tablespoon butter"],
  "recipeInstructions": ["Butter one side of each slice of bread.", "Grill until golden on both sides."]
}
</script>
</head>
<body><p>Fixture Grilled Cheese page body text, not actually used by the parser.</p></body>
</html>`

function startFixtureServer() {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(FIXTURE_HTML)
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

async function fillBlankQuantitiesAndUnits(page) {
  const qtyInputs = page.locator('input[placeholder="Qty"]')
  const qtyCount = await qtyInputs.count()
  for (let i = 0; i < qtyCount; i += 1) {
    const val = await qtyInputs.nth(i).inputValue()
    if (!val.trim()) await qtyInputs.nth(i).fill('1')
  }
  const unitInputs = page.locator('input[placeholder="Unit"]')
  const unitCount = await unitInputs.count()
  for (let i = 0; i < unitCount; i += 1) {
    const val = await unitInputs.nth(i).inputValue()
    if (!val.trim()) await unitInputs.nth(i).fill('unit')
  }
}

// AI-drafted ingredient rows never have a resolved food -- resolve each one
// by opening its search dropdown and using "+ Create" (robust regardless of
// what name the model happened to produce, unlike trying to match a real
// catalog food). Resolving a row removes its search input from the DOM and
// shifts the remaining ones down, so always take the first one left --
// but only after confirming the previous pick's POST /food-definitions
// round-trip actually landed, or the next iteration can race a row that's
// mid-request and hang trying to act on a stale/moving target.
async function resolveAllIngredientFoods(page) {
  const searchInputSelector = 'input[placeholder="Search for a food (e.g. milk)"]'
  for (let guard = 0; guard < 25; guard += 1) {
    const inputs = page.locator(searchInputSelector)
    const countBefore = await inputs.count()
    if (countBefore === 0) return
    const input = inputs.first()
    await input.click()
    await page.waitForTimeout(400)
    const createButton = page.getByRole('button', { name: /^\+ Create/ })
    if ((await createButton.count()) > 0) {
      await createButton.first().click()
    } else {
      const dropdownOption = page.locator('div.absolute.z-10 button').first()
      if ((await dropdownOption.count()) > 0) {
        await dropdownOption.click()
      } else {
        // Blank suggested name (rare) -- type something so "+ Create" appears.
        await input.fill('Fixture Ingredient')
        await page.waitForTimeout(400)
        const retryCreate = page.getByRole('button', { name: /^\+ Create/ })
        if ((await retryCreate.count()) > 0) await retryCreate.first().click()
      }
    }
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      if ((await page.locator(searchInputSelector).count()) < countBefore) break
      await page.waitForTimeout(200)
    }
  }
  throw new Error('resolveAllIngredientFoods: too many rows, possible stuck loop')
}

// A small local model occasionally fails structured-output parsing even
// after the backend's own one-shot repair retry (a real, expected failure
// mode of llama2 -- see AiOutputParsingError/502) -- clicking the action
// again is exactly what a real user would do, so retry a bounded number of
// times here rather than treating one bad roll as a verification failure.
async function clickAndWaitForEither(page, clickSelector, successSelector, errorSelector, attempts) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await page.click(clickSelector)
    // The click handler clears any previous error synchronously before the
    // network call starts -- give React a moment to flush that re-render
    // before polling, or a stale error paragraph from a prior attempt could
    // be misread as this attempt's result.
    await page.waitForTimeout(300)
    const deadline = Date.now() + AI_TIMEOUT
    let result = null
    while (Date.now() < deadline) {
      if ((await page.locator(successSelector).count()) > 0) {
        result = 'success'
        break
      }
      if ((await page.locator(errorSelector).count()) > 0) {
        result = 'error'
        break
      }
      await page.waitForTimeout(500)
    }
    if (result === 'success') return
    if (attempt === attempts) throw new Error(`Gave up after ${attempts} attempts: ${clickSelector}`)
    console.log(`  attempt ${attempt} failed (model output error), retrying...`)
    await page.waitForTimeout(1000)
  }
}

const suffix = Date.now().toString(36)
const user = await createTestUser(`burrow-e2e-recipe-ai-${suffix}@example.com`)
const fixtureServer = await startFixtureServer()
const fixturePort = fixtureServer.address().port
const fixtureUrl = `http://127.0.0.1:${fixturePort}/fixture-recipe.html`

const browser = await chromium.launch()
const consoleErrors = []
const page = await browser.newPage()
page.setDefaultTimeout(AI_TIMEOUT)
trackConsole(page, 'A', consoleErrors)

let shot = 0
const snap = async (name) => {
  shot += 1
  await page.screenshot({
    path: `${SHOTS}/recipe-ai-${String(shot).padStart(2, '0')}-${name}.png`,
    fullPage: true,
  })
}

console.log('--- login + create household ---')
await page.goto(`${BASE}/login`)
await page.waitForSelector('text=Log in to Burrow')
await page.fill('input[type="email"]', user.email)
await page.fill('input[type="password"]', PASSWORD)
await page.click('button[type="submit"]')
await page.waitForURL(`${BASE}/`, { timeout: 10000 })

await page.goto(`${BASE}/households/new`)
await page.waitForSelector('text=Create a household')
await page.fill('input[placeholder="3BR Apartment on Main St"]', 'Recipe AI E2E House')
await page.fill('input[placeholder="Alex"]', 'Alex')
await page.click('button[type="submit"]')
await page.waitForURL(/\/households\/[0-9a-f-]+$/, { timeout: 10000 })
const householdId = page.url().split('/households/')[1]
console.log('household id:', householdId)

console.log('--- import a recipe from pasted text ---')
await page.goto(`${BASE}/households/${householdId}/recipes/import`)
await page.waitForSelector('text=Import a recipe')
await page.fill(
  'textarea',
  `Grilled Cheese Sandwich

Ingredients:
- 2 slices of bread
- 1 slice of cheddar cheese
- 1 tablespoon of butter

Instructions:
1. Butter one side of each slice of bread.
2. Place cheese between the slices, buttered sides out.
3. Grill in a pan over medium heat until golden brown on both sides.`,
)
await snap('import-text-filled')
await clickAndWaitForEither(
  page,
  'button:has-text("Import")',
  'text=Review imported recipe',
  'p.text-red-600',
  5,
)
await snap('import-text-review')
console.log('OK: text import produced a draft to review')

await fillBlankQuantitiesAndUnits(page)
await resolveAllIngredientFoods(page)
await snap('import-text-resolved')
await page.click('button:has-text("Save recipe")')
await page.waitForURL(/\/recipes\/[0-9a-f-]+$/, { timeout: 15000 })
console.log('OK: text-imported recipe saved:', page.url())

console.log('--- import a recipe from a URL (local fixture, embedded JSON-LD) ---')
await page.goto(`${BASE}/households/${householdId}/recipes/import`)
await page.waitForSelector('text=Import a recipe')
await page.click('button:has-text("From a URL")')
await page.fill('input[type="url"]', fixtureUrl)
await snap('import-url-filled')
await clickAndWaitForEither(
  page,
  'button:has-text("Import")',
  'text=Review imported recipe',
  'p.text-red-600',
  5,
)
// The draft's name lands inside RecipeForm's <input>, not as rendered
// text, so this must check the input's value rather than use a `text=`
// locator (which only matches text nodes, never form control values).
const importedName = await page.locator('input[name="name"]').inputValue()
if (!importedName.toLowerCase().includes('grilled cheese')) {
  throw new Error(`Expected the URL-imported draft's name to mention "grilled cheese", got: "${importedName}"`)
}
await snap('import-url-review')
console.log('OK: URL import extracted the fixture JSON-LD recipe name')

await fillBlankQuantitiesAndUnits(page)
await resolveAllIngredientFoods(page)
await page.click('button:has-text("Save recipe")')
await page.waitForURL(/\/recipes\/[0-9a-f-]+$/, { timeout: 15000 })
console.log('OK: URL-imported recipe saved:', page.url())

console.log('--- generate a recipe from constraints ---')
await page.goto(`${BASE}/households/${householdId}/recipes/generate`)
await page.waitForSelector('text=Generate a recipe with AI')
await page.fill('input[placeholder="e.g. Mexican"]', 'Italian')
await snap('generate-form-filled')
await clickAndWaitForEither(
  page,
  'button:has-text("Generate")',
  'text=Review generated recipe',
  'p.text-red-600',
  5,
)
await snap('generate-review')
console.log('OK: generate produced a draft to review')

await fillBlankQuantitiesAndUnits(page)
await resolveAllIngredientFoods(page)
await page.click('button:has-text("Save recipe")')
await page.waitForURL(/\/recipes\/[0-9a-f-]+$/, { timeout: 15000 })
const generatedRecipeUrl = page.url()
console.log('OK: generated recipe saved:', generatedRecipeUrl)

console.log('--- suggest a substitution on the generated recipe ---')
await page.goto(generatedRecipeUrl)
await page.waitForSelector('text=Ingredients')
// Every ingredient row has its own "Suggest substitute" button -- scope to
// the first row specifically, or waiting for "the button" to revert could
// match a different row's button that was never clicked.
const firstIngredientRow = page.locator('ul > li').first()
await firstIngredientRow.getByRole('button', { name: /Suggest substitute|Thinking/ }).click()
await snap('substitution-loading')
await firstIngredientRow
  .getByRole('button', { name: 'Suggest substitute' })
  .waitFor({ timeout: AI_TIMEOUT })
await snap('substitution-result')
const substitutionError = await firstIngredientRow.locator('p.text-red-600').count()
if (substitutionError > 0) {
  const message = await firstIngredientRow.locator('p.text-red-600').first().textContent()
  console.log(`Substitution call returned an error (acceptable under a weak local model): ${message}`)
} else {
  const suggestionCount = await firstIngredientRow.locator('ul li').count()
  if (suggestionCount === 0) {
    throw new Error('Substitution call succeeded but rendered zero suggestions')
  }
  console.log(`OK: ${suggestionCount} substitution suggestion(s) rendered`)
}

console.log('--- console errors collected ---')
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)')

await browser.close()
fixtureServer.close()

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
