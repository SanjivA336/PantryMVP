# Deploying Burrow

The plan, in one picture:

```
Browser ──> Cloudflare Pages   burrowapp.site        (the React app: static files)
Browser ──> Render             api.burrowapp.site    (the FastAPI backend, free tier)
Browser ──> Supabase           <ref>.supabase.co     (sign-in, live updates)
Render  ──> Supabase                                  (data, service-role key)
```

| Piece | Host | Why |
|---|---|---|
| Frontend | Cloudflare Pages (free) | Free, unlimited bandwidth, domain already lives at Cloudflare, SPA routing built in |
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
2. Update the Privacy Policy's provider table: replace the "Web hosting providers" row with
   **Cloudflare** (hosts the website and DNS; sees your IP address and request logs) and
   **Render** (hosts the API; sees your IP address, request logs, and the data passing through).
   Edit both the Word file and `frontend/src/legal/privacy.ts`, then bump `LEGAL_VERSION` in
   `frontend/src/legal/version.ts` and both documents' "updated" date. Do this before launch,
   while nobody has accepted the old version.
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

If the Blueprint reports an error, the message names the offending line in `render.yaml`. The
file was written from Render's documented format but could not be tested without an account.

## Step 3: Frontend on Cloudflare Pages

1. Cloudflare dashboard, **Workers & Pages, Create, Pages, Connect to Git**, pick the repo.
   (If Cloudflare only offers Workers static assets for new projects, the settings below still
   apply; the screens differ.)
2. Build settings:
   - Root directory: `frontend`
   - Build command: `npm run build`
   - Build output directory: `dist`
3. Environment variables (Production). These are baked into the site at build time, so changing
   one means redeploying:

   | Name | Value |
   |---|---|
   | `NODE_VERSION` | `22` |
   | `VITE_SUPABASE_URL` | your project URL |
   | `VITE_SUPABASE_ANON_KEY` | the anon key (public by design) |
   | `VITE_API_BASE_URL` | `https://api.burrowapp.site` |
   | `VITE_SUPPORT_URL` | the Google Form link |
   | `VITE_SENTRY_DSN` | the frontend Sentry DSN |

   Leave `VITE_DEVELOPER_USER_IDS` unset.
4. Deploy. Then, in the project's Custom domains, add `burrowapp.site`. Because DNS is on
   Cloudflare, it creates the records for you.

**Check:** `https://burrowapp.site` loads, and so does `https://burrowapp.site/terms` when you
open it directly and when you refresh it (Pages sends unknown paths to `index.html`).

## Step 4: Email deliverability

1. In Cloudflare DNS add a TXT record named `_dmarc` with the value `v=DMARC1; p=none;`.
2. In Resend, turn off click and open tracking for the sending domain.
3. After Step 6's signup, open the email in Gmail, **Show original**, and confirm SPF, DKIM and
   DMARC all say PASS.

## Step 5: Sentry (optional polish)

Errors already flow once the DSNs are set. Frontend stack traces are minified until source maps
are uploaded in the build; that is a separate task.

## Step 6: Smoke test on the real URL

Use one real test account, then delete it from Account settings at the end.

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
- **Frontend:** Cloudflare Pages, Deployments, roll back to a previous one.
- **Database:** migrations are not rolled back by redeploying. Use the manual dump you took in
  Step 0, and read each migration's own notes first.

## Moving hosts later

Because the API sits behind your own `api.burrowapp.site` name, moving the backend to another
host later (Fly.io, Cloud Run, Railway) only means pointing that DNS record somewhere else. The
`backend/Dockerfile` already works on any container host. The frontend would not need a rebuild.
