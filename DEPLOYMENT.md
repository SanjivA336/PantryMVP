# Deploying Burrow

The plan, in one picture:

```
Browser ──> Cloudflare Workers burrowapp.site        (the React app: static files)
Browser ──> Render             api.burrowapp.site    (the FastAPI backend, free tier)
Browser ──> Supabase           <ref>.supabase.co     (sign-in, live updates)
Render  ──> Supabase                                  (data, service-role key)
```

| Piece | Host | Why |
|---|---|---|
| Frontend | Cloudflare Workers static assets (free) | Free, domain already lives at Cloudflare. The dashboard no longer offered classic Pages; the Workers flow serves the same static files |
| Backend | Render free web service, Virginia | Free, no card needed; Virginia is the closest Render region to Supabase (AWS ca-central-1, Montreal) |
| Database + auth | Supabase free (existing project) | Dev and prod share one project (see README, Phase 3) |
| Errors | Sentry (existing two projects) | Already wired up |
| Email | Resend (existing) | Already wired up |

Phase 5 of the README is writing this down. Phase 6 is doing it.

## Know the tradeoffs before you start

- **Cold starts.** Render's free tier puts the backend to sleep after about 15 minutes with no
  traffic, and the first request afterward waits roughly 30 to 60 seconds while it wakes. The
  frontend loads instantly (Cloudflare serves it), so users see the app but its first
  data load is slow. Options, cheapest first:
  1. Accept it for a small private group.
  2. **Already built:** the app sends a quiet request to `/health` the moment any page loads
     (even the login page), so the server is usually awake by the time someone has typed their
     password. If a real request is still pending after 10 seconds, a "Getting things ready…"
     banner appears and goes away when it answers (`frontend/src/lib/serverWake.ts`). The AI
     endpoints are excluded because they are slow by nature.
  3. Ping `https://api.burrowapp.site/health` every 5 minutes with a free uptime monitor
     (for example UptimeRobot). That fits inside Render's free instance hours (about 750 per
     month, and a month is about 744 hours) as long as it's the only free web service in your
     workspace. Check Render's current terms first; this is a common workaround, not a feature.
- **Supabase also pauses** after about a week with no activity. Real users keep it awake, and
  `/health` does not touch Supabase, so a pinger would not.
- **No backups.** Free Supabase has none and you chose not to pay for PITR. Take a manual dump
  before anything risky (see README, Phase 3).
- **One backend instance only.** The rate limiter keeps its counters in memory.
- **The rate limiter can be dodged** by someone deliberately sending fake `X-Forwarded-For`
  values (see the comment in `backend/Dockerfile`). It's a backstop against casual hammering,
  not a security boundary.
- **AI and receipt scanning are off in production.** They need Ollama and Google Vision, and
  they are developer-gated. Leave `DEVELOPER_USER_IDS` unset on Render.

## Step 0: Before touching any host

1. Everything green locally: `cd backend && uv run pytest`, `cd frontend && npm run lint && npm run build`.
2. **Done (legal version `2026-10-01.2`).** The Privacy Policy's provider table names
   **Cloudflare** (hosts the website and DNS; sees your IP address and request logs) and
   **Render** (hosts the API; sees your IP address, request logs, and the data passing through).
   If you change hosts later, update both the Word file and `frontend/src/legal/privacy.ts`,
   and bump `LEGAL_VERSION` in `frontend/src/legal/version.ts`.
3. Push to GitHub and confirm CI passes on `main`. Both Render and Cloudflare deploy from the
   GitHub repo (`SanjivA336/PantryMVP`).
4. Take a manual backup (see README, Phase 3) into a folder outside the repo.
5. Confirm every migration is on the live project: `npx supabase migration list --linked`.

## Step 1: Supabase settings (dashboard)

Authentication, URL Configuration:
- **Site URL:** `https://burrowapp.site`
- **Redirect URLs:** add `https://burrowapp.site/**`. Keep `http://localhost:5173/**` so local
  development still works.

Without this, confirmation and password-reset links point to the wrong place or are rejected.

Authentication, Emails:
- Confirm the **Confirm sign up** and **Reset password** templates match
  `supabase/templates/confirmation.html` and `recovery.html` (the config file only covers the
  local stack).
- Confirm custom SMTP is still on and pointed at Resend.

**Check:** nothing to deploy yet. You'll test the links in Step 6.

## Step 2: Backend on Render

1. Render dashboard, **New +, Blueprint**, connect the GitHub repo. Render reads `render.yaml`.
2. When asked, fill the secrets (they come from your local `.env`): `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SENTRY_DSN` (the backend one).
   `ENVIRONMENT` and `CORS_ORIGINS` are already set in the file.
3. Apply. The first build takes a few minutes.
4. Custom domain: in the service's Settings, add `api.burrowapp.site`. Render shows a target
   (like `burrow-api.onrender.com`). In Cloudflare DNS add a **CNAME**, name `api`, to that
   target. Use **DNS only** (grey cloud) so Render can issue its certificate; wait for Render to
   show it verified.

**Check:** open `https://api.burrowapp.site/health` (the first load may take a minute). You
should see `{"status":"ok","environment":"production"}`.

If the Blueprint reports an error, the message names the offending line in `render.yaml`.

**If every login says "Your session isn't valid":** the token is fine but the backend's
service-role lookup of the account is failing, which means a wrong or badly pasted
`SUPABASE_SERVICE_ROLE_KEY` (it must be the service_role key, not the anon key) or
`SUPABASE_URL` on Render. Re-paste both from `.env` and let it redeploy. The app gives one
message for every auth failure on purpose, so the cause isn't visible in the browser.

## Step 3: Frontend on Cloudflare (Workers static assets)

Cloudflare's dashboard now creates a Workers project for new sites instead of classic Pages. It
serves the same built files. The repo already has `frontend/wrangler.jsonc`, which names the
project (`burrow`), points at the build output (`./dist`), and sets
`not_found_handling: single-page-application` so a refresh on `/terms` returns `index.html`
instead of a 404.

1. Cloudflare dashboard, **Workers & Pages, Create, Connect to Git**, pick the repo.
2. Settings:
   - Project name: `burrow` (must match `name` in `frontend/wrangler.jsonc`)
   - Root directory (path): `frontend`
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Non-production branch builds: off (you only deploy `main`)
   - Protect with Cloudflare Access: off (it would put a login wall on a public site)
   - API token: create a new one for this project rather than reusing an old token
3. Build variables (the name/value rows under Advanced settings, or Settings, Build, Variables
   and secrets). These are baked into the site at build time, so changing one means
   redeploying:

   | Name | Value |
   |---|---|
   | `NODE_VERSION` | `22` |
   | `VITE_SUPABASE_URL` | your project URL |
   | `VITE_SUPABASE_ANON_KEY` | the anon key (public by design) |
   | `VITE_API_BASE_URL` | `https://api.burrowapp.site` |
   | `VITE_SUPPORT_URL` | the Google Form link |
   | `VITE_SENTRY_DSN` | the frontend Sentry DSN |

   Leave `VITE_DEVELOPER_USER_IDS` unset. Encrypting these is optional: everything `VITE_*` ships
   in the browser bundle anyway. Never put the service-role key or the backend `SENTRY_DSN` here.
4. **Paste values without a trailing newline or space.** A stray newline in
   `VITE_SUPABASE_ANON_KEY` once broke the live-update WebSocket (the key ends up in its URL as
   `%0A`) while normal requests kept working. The app now trims these values when it reads them
   (`frontend/src/lib/supabaseClient.ts`), but paste carefully anyway. The same goes for the
   secrets on Render.
5. Deploy. Then, in the project's **Settings, Domains & Routes, Add, Custom domain**, add
   `burrowapp.site`. Because DNS is on Cloudflare, it creates the record for you.

**Check:** `https://burrowapp.site` loads, and so does `https://burrowapp.site/terms` when you
open it directly and when you refresh it. The `*.workers.dev` address will load too, but the API
only allows requests from `https://burrowapp.site` (`CORS_ORIGINS`), so log in on the real domain.

## Step 4: Email deliverability

1. In Cloudflare DNS add a TXT record named `_dmarc` with the value `v=DMARC1; p=none;`.
2. In Resend, turn off click and open tracking for the sending domain.
3. After Step 6's signup, open the email in Gmail, **Show original**, and confirm SPF, DKIM and
   DMARC all say PASS.

## Step 5: Sentry (optional polish)

Errors already flow once the DSNs are set. Frontend stack traces are minified until source maps
are uploaded in the build; that is a separate task.

## Step 6: Smoke test on the real URL

Use one real test account, then delete it from Account settings at the end. Signup and the
emails need a real inbox, so do those by hand. Everything after login can also be driven by a
browser script that signs in as that normal user (no service key); the first live run caught a
wrong key on Render and the newline bug above.

- [ ] Sign up: both checkboxes are required, the confirmation email arrives (note whether in
      spam), and its link lands on `https://burrowapp.site`.
- [ ] Log in, create a household, add an item, use the shopping list, check Balances.
- [ ] Forgot password: the email arrives and the reset link works.
- [ ] `/terms` and `/privacy` load directly, and from the signup page.
- [ ] "Contact support" opens the form from the sidebar, the Burrow settings tab and the
      Account page.
- [ ] Browser console shows no red CORS errors.
- [ ] A deliberate error shows up in Sentry (both projects) with environment `production`.
- [ ] After 15 idle minutes, open the site: the "Getting things ready…" banner should appear if
      the first request is slow, then clear on its own.

## Step 7: Invite people

Share `https://burrowapp.site`. That's v1.

## Rolling back

- **Backend:** Render, Deploys, pick a previous deploy, Rollback.
- **Frontend:** the Cloudflare project's Deployments (or Versions) list, roll back to a
  previous one.
- **Database:** migrations are not rolled back by redeploying. Use the manual dump you took in
  Step 0, and read each migration's own notes first.

## Moving hosts later

Because the API sits behind your own `api.burrowapp.site` name, moving the backend to another
host later (Fly.io, Cloud Run, Railway) only means pointing that DNS record somewhere else. The
`backend/Dockerfile` already works on any container host. The frontend would not need a rebuild.
