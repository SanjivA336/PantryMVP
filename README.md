# Burrow

A home for your food — shared-household kitchen/pantry management system.

```
/supabase   Supabase CLI project — migrations + config.toml (schema/RLS source of truth)
/backend    FastAPI (Python, managed with uv)
/frontend   React + TypeScript + Vite (Tailwind CSS v4)
```

## Features

### Households & members
- Email/password auth (Supabase Auth)
- Create a household, or join an existing one via an 8-character join code
- Per-household member roles (admin / regular) with deactivation
- Belong to multiple households, switchable from a picker screen

### Inventory tracking
- Shared global food catalog, with per-household variants so two households
  track the same food ("Milk") independently
- Manual item entry: quantity + unit, expiry/best-by date, cost, storage
  location, allowed members
- Per-item nicknames to tell apart two purchases of the same food (e.g. "HEB
  milk" vs "Costco milk")
- Storage locations (fridge / freezer / pantry / other), managed inline from
  the inventory view
- "Use" modal for logging consumption: remaining-amount bar, +/- steppers, a
  same-dimension unit switch, fraction presets (all / half / third / quarter)
  and rough "about this much" presets (a cup, a handful, ...)
- Consume and discard actions; full purchase history is retained even after
  an item is fully used up
- Correct a mis-logged consumption after the fact — an append-only signed
  adjustment, never an edit; re-splits an already-frozen item's ledger
  entries if needed
- Quantities are stored in a canonical base unit (g / ml / count) and
  converted to each household's chosen unit only for display
- 11 food categories with color-coded tags throughout the UI

### Cost splitting / ledger
- Three accounting types per food: shared-consumable, unit-based, or personal
- Automatic ledger entries on purchase and on over-allotment ("overage")
  consumption
- Live-until-frozen debt: while an item is still ACTIVE its share is
  recomputed from current usage on every read and nothing is posted; the
  final split is written to the ledger once, when the item's story ends
- Pairwise balance computation, plus a minimal-transfer settle-up plan (the
  standard debt-simplification heuristic used by tools like Splitwise)
- Recorded settlements: log "X paid Y $Z" as an append-only payment that
  nets against balances, with a past-settlements history; "deleting" one
  appends a reversing entry rather than mutating anything
- Balances dashboard: net-balance-over-time chart, top foods by spend,
  settled-vs-outstanding breakdown, and a per-member transaction drill-down

### Warnings
- Expiry warnings (expiring soon / expired), from expiry or best-by date
- Stock warnings (low stock / out of stock), relative to the most recent
  purchase size
- Per-warning dismissal that self-clears automatically once the underlying
  signal changes (e.g. a restock)

### Shopping list
- Manual items (linked to the shared food catalog) and sections, both
  drag-orderable
- A "collected" (in-cart) state distinct from removing an item
- Auto-suggest from current stock warnings, with either a temporary
  (until-next-purchase) or permanent per-food dismissal
- Clear-list action
- **"Bought marked items" wizard** — turns every collected item into a
  draft purchase "order" (removing them from the list at the same time so
  two people can't double-import). A two-pane modal: line list on the left,
  a per-line add-item form on the right with a complete/incomplete toggle;
  submit is gated until every line is complete, then all lines are written
  to inventory at once. Buyer is sticky (the last saved line's buyer
  carries forward). Drafts are resumable or deletable.

### Activity feed
- Household-wide, append-only log: item added / used / removed / moved,
  cost and usage corrections, settlements recorded/reversed, members
  joining/leaving
- Newest-first, keyset-paginated, filterable by category; events deep-link
  to the item they're about
- Live across devices via Supabase Realtime. Meant as the current
  stand-in for push/email notifications (none exist yet)

### Recipes
- Manual creation/editing: ingredients linked to the food catalog, ordered
  instructions, servings, prep/cook time
- Live ingredient availability against current inventory (have it / don't —
  plus an exact-quantity match when units align; no unit conversion)
- Import from a URL (reads schema.org Recipe JSON-LD, falls back to page
  text) or from pasted text, parsed by a local LLM
- Generate an original recipe from constraints: cuisine(s), a time range,
  dietary restrictions, required ingredients, a "pantry only" mode, and a
  freeform description
- AI-suggested ingredient substitutions, each with its own quantity/unit
- AI-drafted ingredients auto-link to a real food-catalog entry when an
  exact/close name match is found, instead of always requiring a manual pick

### Receipt scanning

Shares the "purchase session" review-and-finalize flow with the shopping
list wizard above (one set of tables, one idempotent finalize). Only the
OCR-backed steps below are gated to a developer allowlist.

- Upload or camera-capture a receipt photo
- OCR (Google Cloud Vision) extracts raw text, which the local LLM then
  parses into structured line items (name + price guaranteed, quantity/unit
  best-effort) and auto-links to a real food-catalog entry the same way AI
  recipe ingredients do; falls back to a plain regex line-splitter (no food-
  type guess) if the AI provider is unreachable
- Per-item review/edit before import, reusing the same food-search UI as
  manual add
- Resumable after an OCR failure; finalize is idempotent (safe to retry)

### Real-time & UX
- Supabase Realtime keeps household data live in sync across members
- Dark, off-black/green themed UI; responsive layout (sidebar on desktop,
  bottom tab bar on mobile)
- Installable as a PWA (manifest + service worker via `vite-plugin-pwa`):
  the app shell (JS/CSS/HTML, precached) loads and renders fully offline;
  API calls are never cached and always hit the network fresh

## What's left

Ordered by when it should happen, not just grouped by topic. AI/OCR
features (recipe generation, receipt scanning, AI recipe import) are
deliberately left out of this list entirely — they stay behind the
developer gate through v1. Hosting stays local (both frontend and
backend, on-machine) through Phase 5; only Phase 6 involves anything
leaving localhost.

### Phase 1 — Correctness & polish (local)

- [x] Confirm the AI/OCR routes (`recipes/generate`, `scan-receipt*`, and
  AI-backed recipe import) stay behind `DeveloperGuard` / `require_developer`
  at both the frontend route and backend endpoint level — verified, not
  reachable by a non-developer account.
- [x] **Consumption correction on a frozen item**: `freeze_item_debt` used
  to read `consumption_events` + the member roster as plain unlocked
  SELECTs, *then* claim the freeze via a compare-and-swap — a roster edit
  landing in between was priced on the stale snapshot and never reached
  the ledger. Fixed (migration 0039): the read and the claim now happen
  inside one `claim_item_debt_freeze` function under the same row lock
  `set_inventory_item_roster` already takes, so whichever side commits
  first is what wins — a late roster edit either gets priced correctly or
  is cleanly rejected as "already frozen," never silently lost.
- [x] Mobile-width pass across the app (done separately from this list).

### Phase 2 — Security & compliance basics

- [ ] **Skipped — needs your input.** Wire up an SMTP provider (Resend,
  Postmark, SES, …) so self-service password reset and email verification
  work — currently blocked at the UI layer specifically because no
  provider is configured. Needs an account/credentials only you can supply.
- [ ] **Skipped — needs your input.** Write a Terms of Service + Privacy
  Policy (even a minimal one) — needs real specifics (entity/contact name,
  jurisdiction, data-handling details) rather than generic filler text.
- [x] Add basic API rate limiting: a per-client-IP fixed-window cap
  (`app/core/rate_limit.py`, 120 requests/minute by default, configurable
  via `RATE_LIMIT_MAX_REQUESTS`/`RATE_LIMIT_WINDOW_SECONDS`), hand-rolled
  rather than pulled from a library after discovering `slowapi` silently
  no-ops against this project's FastAPI/Starlette version. `/health` stays
  exempt for uptime monitors; disabled entirely under pytest.
- [ ] **Skipped — needs your input.** Add error tracking (Sentry or
  similar) — needs an account/DSN for whichever provider you'd prefer.
- [ ] **Skipped — needs your input.** Decide on a support/contact channel
  (even just an email address).
- [x] CSV/data export: an "Export as CSV" button on the Inventory page,
  generated client-side (no server round trip) from whatever's currently
  shown (search/category/storage filters included), with buyer/shared-with
  member ids resolved to nicknames.

### Phase 3 — Prod environment split (still local)

- [ ] Create a separate prod Supabase project (distinct from the one used
  for development) and push all migrations to it.
- [ ] Decide the env var / secrets story for switching between dev and prod
  configs cleanly (e.g. a documented `.env.production`).
- [ ] Re-run the `rls` + `integration` suites against the new prod project
  specifically — passing against dev doesn't prove prod's migrations
  behave the same.
- [ ] Decide what happens to existing test data ("Test Zone" etc.) — prod
  should start clean.
- [ ] Confirm Supabase's backup/point-in-time recovery is enabled on the
  prod project before real data exists.

### Phase 4 — CI (still local hosting, just automation)

- [ ] GitHub Actions workflow: backend `pytest` (unit-marked), frontend
  `tsc` + `oxlint`, on every push/PR.
- [ ] Add a build check (`npm run build`) to the same workflow.

### Phase 5 — Deployment prep (decide & configure, don't cut over yet)

- [ ] Choose a backend host (needs a long-running process — Railway,
  Fly.io, Render, a VPS, …).
- [ ] Choose a frontend static host/CDN (Vercel, Netlify, Cloudflare
  Pages, …).
- [ ] Decide on a domain name and where DNS will live, if wanted.
- [ ] Add the real deployed frontend origin to CORS in
  `backend/app/main.py` (currently pinned to `localhost:5173/5174`) ahead
  of time.
- [ ] Write down the actual deploy steps (build command, required env
  vars, migration step) so cutover day is a checklist.

### Phase 6 — Cutover (the only phase that leaves localhost)

- [ ] Deploy the backend, pointed at the prod Supabase project.
- [ ] Deploy the frontend build, pointed at the deployed backend.
- [ ] Point the domain at the new deployment, if applicable.
- [ ] Full manual smoke test against the real production URL (signup →
  household → inventory → shopping list → balances) — not localhost.
- [ ] Invite real users. That's v1.

### Deferred past v1 (developer-gated; not required for launch)

- **Receipt review page** (`ReviewReceiptSessionPage`) got a mechanical
  rename onto the shared purchase-session model; its Confirm/Skip UX still
  assumes the old skip semantics and needs reworking — bundled with the
  rest of AI/OCR, not needed until that's turned on for real users.

### Longer-term

- **Real unit conversion** for recipe ingredient availability — weight↔volume
  needs a per-food density this app deliberately never asks for.
- **Additional AI providers** beyond Ollama and **OCR engines** beyond Google
  Cloud Vision — both are swappable by config, with one implementation each.
- **Garden / harvest-based tracking** — an initial `GARDEN` storage type was
  dropped, pending its own harvest-date-based model.
- **Fuzzy/semantic ingredient matching** for AI-recipe food resolution —
  currently exact, case-insensitive name matching only.
- **Push/email notifications** — the in-app activity feed is the stand-in.

## Setup

1. Copy `.env.example` to `.env` at the repo root and fill in your Supabase project's URL/keys (Project Settings → API in the Supabase dashboard).
2. Backend: `cd backend && uv run uvicorn app.main:app --reload`
3. Frontend: `cd frontend && npm install && npm run dev`
4. Supabase CLI (installed as a root devDependency, no global install needed): `npx supabase <command>` from the repo root — e.g. `npx supabase link --project-ref <ref>`, `npx supabase db push`.

## Backend tooling

- Dependency management: `uv` (`uv add <pkg>`, `uv run <cmd>`)
- Lint/format: `uv run ruff check .` / `uv run ruff format .`
- Tests: `uv run pytest` (unit tests only by default; `rls`, `integration`, and `ollama`-marked tests hit your real linked Supabase project and/or a local Ollama instance — run explicitly with e.g. `uv run pytest -m rls`)

## Frontend tooling

- Lint: `npm run lint` (oxlint)
- Format: `npx prettier --write .`
- Build: `npm run build`
