# Burrow

A home for your food — shared-household kitchen/pantry management system.

See `.claude/plans/` (or your Claude Code plan history) for the full phased build plan. High-level layout:

```
/supabase   Supabase CLI project — migrations + config.toml (schema/RLS source of truth)
/backend    FastAPI (Python, managed with uv)
/frontend   React + TypeScript + Vite (Tailwind CSS v4)
```

## Setup

1. Copy `.env.example` to `.env` at the repo root and fill in your Supabase project's URL/keys (Project Settings → API in the Supabase dashboard).
2. Backend: `cd backend && uv run uvicorn app.main:app --reload`
3. Frontend: `cd frontend && npm install && npm run dev`
4. Supabase CLI (installed as a root devDependency, no global install needed): `npx supabase <command>` from the repo root — e.g. `npx supabase link --project-ref <ref>`, `npx supabase db push`.

## Backend tooling

- Dependency management: `uv` (`uv add <pkg>`, `uv run <cmd>`)
- Lint/format: `uv run ruff check .` / `uv run ruff format .`
- Tests: `uv run pytest`

## Frontend tooling

- Lint: `npm run lint` (oxlint)
- Format: `npx prettier --write .`
- Build: `npm run build`
