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
- Consume and discard actions; full purchase history is retained even after
  an item is fully used up
- 11 food categories with color-coded tags throughout the UI

### Cost splitting / ledger
- Three accounting types per food: shared-consumable, unit-based, or personal
- Automatic ledger entries on purchase and on over-allotment ("overage")
  consumption
- Pairwise balance computation, plus a minimal-transfer settle-up plan (the
  standard debt-simplification heuristic used by tools like Splitwise)
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
- Upload or camera-capture a receipt photo
- OCR (Google Cloud Vision) + regex-based line-item parsing
- Per-item review/edit before import, reusing the same food-search UI as
  manual add
- Resumable after an OCR failure; finalize is idempotent (safe to retry)

### Real-time & UX
- Supabase Realtime keeps household data live in sync across members
- Dark, off-black/green themed UI; responsive layout (sidebar on desktop,
  bottom tab bar on mobile)

## Roadmap / not yet implemented

- **Real unit conversion** for recipe ingredient availability — currently
  binary have/don't-have, with a quantity shown only when units already
  match exactly
- **Additional AI providers** beyond Ollama — the `AiProvider` abstraction is
  built to be swappable by config, but only a local Ollama backend exists
  today
- **Additional OCR engines** beyond Google Cloud Vision — same
  swappable-by-config design, only one engine implemented
- **Garden / harvest-based tracking** — an initial `GARDEN` storage type was
  dropped, pending its own harvest-date-based tracking model (no "buy more"
  signal makes sense for a garden the way it does for purchased food)
- **Fuzzy/semantic ingredient matching** for AI-recipe food resolution —
  currently exact, case-insensitive name matching only
- **Push/email notifications** for warnings or balances — all surfacing is
  in-app only today

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
