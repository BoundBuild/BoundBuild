# BoundBuild MVP — Deployment & Phone Install Runbook

This is the step-by-step path from "code in a workspace" to "foremen using it on a real site
with their phones." Read once, then follow in order. Total time for the happy path: **~1–2 hours**,
mostly waiting for the host to build.

---

## TL;DR

1. Get the code onto your laptop
2. Push to GitHub
3. Deploy on Render (free tier to start) → you get an `https://…` URL
4. Open that URL on your phone → **Add to Home Screen** → it installs like an app
5. Add `RESEND_API_KEY` → test delivery from the Pilot console
6. Create real users + projects → hand phones to your pilot foreman

---

## Step 0 — What you're installing and why

BoundBuild is a **progressive web app (PWA)**, not a binary app. There is no `.apk`/`.ipa` to
download. You deploy the server, and any phone browser installs it from the URL:

- **Android (Chrome):** "Add to Home screen" → installs with app icon, fullscreen, like an app.
- **iPhone (Safari):** Share → "Add to Home Screen" → same.
- Works on any device; no app store approval; instant updates (just redeploy).

A native wrapper (Capacitor → TestFlight/Play Store) is only worth doing *after* pilots prove
the product — see Step 9.

---

## Step 1 — Get the code onto your laptop

**Option A (easiest):** In this workspace's file browser, download the `boundbuild` folder as
a zip. Unzip into e.g. `~/boundbuild`.

**Option B (recommended for deployment):** push to GitHub so the host can pull it.

```bash
cd ~/boundbuild
git init
git add -A
git commit -m "BoundBuild MVP v0.1.0"
gh repo create boundbuild --private --source=. --push   # or create on github.com and:
# git remote add origin git@github.com:YOU/boundbuild.git && git push -u origin main
```

> `.gitignore` already excludes `node_modules/`, `data/`, `uploads/`, `.env` — your data and
> secrets never get committed.

---

## Step 2 — Run it on your laptop first (5 min)

```bash
cd ~/boundbuild
npm install
npm start            # → http://localhost:8080
```

- Sign in as **Mike** (`mike@harbourline.nz` / `boundbuild-demo`) or register a fresh company.
- Test a **real voice capture in desktop Chrome** (mic works on `localhost`).
- Run the tests to confirm your copy is healthy:
  ```bash
  npm test            # 37-check UI smoke test
  npm run test:e2e    # full pipeline test vs mocked email/STT providers
  ```

---

## Step 3 — Deploy to the internet

You need three things from a host: **HTTPS** (required for microphone + PWA install),
**Node 18+**, and **persistent storage** for `data/` + `uploads/`.

### Option A — Render (recommended for speed) — free tier to start

1. Create an account at render.com → **New → Web Service** → connect your GitHub repo.
2. Settings:
   - **Name:** `boundbuild`
   - **Environment:** `Node`
   - **Build command:** `npm install`
   - **Start command:** `node server/index.js`
   - **Instance type:** Free (fine for pilot; 50s cold starts on free tier — upgrade to
     Starter ~US$7/mo for instant start)
   - **Add a persistent disk** (Starter+): mount at `/data` and `/uploads` (or one disk at
     `/opt/boundbuild-data` and set env vars below). **Without a disk, data resets on every
     redeploy** — fine for demos, NOT fine for a live pilot.
3. Environment variables (see Step 4).
4. Deploy → you get `https://boundbuild.onrender.com`.

### Option B — Railway (similar, also easy; volumes for persistence)

`railway.com` → New Project → Deploy from GitHub → add volume mounted at `/data` →
set `BB_DATA_DIR=/data`, `BB_UPLOADS_DIR=/data/uploads` → deploy.

### Option C — VPS (most control, cheapest long-term, ~US$6/mo)

```bash
# Ubuntu 22.04+ on DigitalOcean/Hetzner/etc.
ssh root@YOUR_SERVER
apt update && apt install -y nodejs npm nginx certbot
node -v   # want v18+; else: curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs

cd /opt && git clone git@github.com:YOU/boundbuild.git && cd boundbuild
npm install
npm install -g pm2
BB_PUBLIC_URL=https://app.yourdomain.co.nz PORT=8080 \
RESEND_API_KEY=re_xxx \
pm2 start server/index.js --name boundbuild
pm2 save && pm2 startup

# nginx reverse proxy + free HTTPS cert
# /etc/nginx/sites-available/boundbuild:
#   server {
#     listen 80; server_name app.yourdomain.co.nz;
#     location / { proxy_pass http://127.0.0.1:8080; proxy_set_header Host $host; }
#   }
ln -s /etc/nginx/sites-available/boundbuild /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d app.yourdomain.co.nz
```

---

## Step 4 — Environment variables (the important ones)

Create `.env` (copy of `.env.example`) or set in the host's dashboard:

| Variable | Required? | What it does |
|---|---|---|
| `PORT` | auto on Render/Railway; `8080` elsewhere | HTTP port |
| `BB_PUBLIC_URL` | **Yes, on any host** | Base URL for dispatch links, e.g. `https://boundbuild.onrender.com`. Without it, emails contain `localhost` links that don't work. |
| `RESEND_API_KEY` | Yes, before going live | Real email delivery (resend.com, free tier = 100 emails/day). |
| `RESEND_FROM` | Recommended | Verified sender, e.g. `BoundBuild <events@yourdomain.co.nz>`. Until your domain is verified, Resend sends from `onboarding@resend.dev`. |
| `STT_PROVIDER=whisper` + `OPENAI_API_KEY` | Optional | Server-side speech-to-text (Whisper). Without it the phone's browser does transcription — fine to start. |
| `OPENAI_MODEL` | Optional | `gpt-4o-mini` default; used for LLM structuring too. |
| `BB_DATA_DIR` / `BB_UPLOADS_DIR` | If using persistent disk | Point at your mounted volume. Defaults: `./data`, `./uploads`. |

**Verify after deploy:** open `https://YOUR-URL/api/health` → `{"ok":true,…}`.

---

## Step 5 — Turn on real email and verify delivery

1. Go to resend.com → sign up (2 min) → **API Keys** → create key (`re_…`).
2. Put it in the host's env vars (or `.env`) → redeploy.
3. Sign in to BoundBuild as an admin (Jess demo account or your registered company admin) →
   **Pilot console** → you'll see the green **"Email delivery live"** banner with a
   **"Send test email"** field.
4. Send a test to your own inbox → you should receive the branded HTML email with the
   **Commercial Event PDF** attached. That's the exact artifact a QS receives.
5. Optional: verify a custom sending domain in Resend (DNS records) so emails send from
   `events@yourdomain.co.nz` instead of `onboarding@resend.dev`.

> No SMTP server needed. (If you'd rather use SMTP, `SMTP_HOST/PORT/USER/PASS/FROM` work too.)

---

## Step 6 — Install it on your phone (this is the "download" part)

**Android (Chrome):**
1. Open `https://YOUR-URL` in Chrome on the phone.
2. Sign in.
3. Chrome menu (⋮) → **"Add to Home screen"** → **"Install"**.
4. It appears as an app with the orange **B** icon, opens fullscreen, and stays installed.

**iPhone (Safari):**
1. Open `https://YOUR-URL` in Safari.
2. Sign in.
3. Share button (□↑) → **"Add to Home Screen"** → **Add**.
4. Launch from the home screen — it runs standalone with the app icon.

**First capture on the phone:**
- Tap the orange record button → iOS/Android will ask **microphone permission** → Allow.
- Speak for 15–60 seconds → live captions appear → photos → AI draft → review → submit.
- If the mic ever fails, the app always offers "Type the description instead" — capture never blocks.

> **Gotcha:** microphone + PWA install only work over **HTTPS** (or `localhost`). Browsing to
> `http://192.168.x.x:8080` on your LAN will load the app but NOT give mic access — always
> use the deployed `https://` URL.

---

## Step 7 — Set up the real pilot

1. **Register your builder's company** (login screen → "Set up your company"). This creates a
   fresh company with no demo data. (The Harbourline demo company is just for show.)
2. As the company admin: **Projects** → create each real site (name, location, and the
   **QS/PM default recipient email**).
3. **Pilot console → Team** → add your foremen (name, email, temp password). Give them
   `user` role (capture + dispatch), give the QS `admin` role (review + console).
4. Give foremen the URL; they install it (Step 6) and log in with their own accounts.
5. Run the loop: foreman captures on site → **SUBMIT TO QS** → QS gets email + PDF →
   QS reviews in the app (or replies by email). Watch the **Pilot console** metrics.

---

## Step 8 — Keeping the pilot healthy (ops)

- **Backups:** the whole database is one file, `data/db.json`, plus `uploads/`. Nightly:
  `tar czf boundbuild-backup-$(date +%F).tgz data uploads` and copy it somewhere off-host
  (S3, Google Drive, another server). Restore = stop server, replace folder, start.
- **Uptime monitoring:** ping `/api/health` every minute (UptimeRobot free tier is fine).
- **Logs:** Render/Railway web UI; VPS: `pm2 logs boundbuild`.
- **Updates:** `git pull && npm install && pm2 restart boundbuild` (VPS) or push to GitHub
  (Render auto-redeploys).
- **Scale reality check:** the JSON store is single-process and perfect for pilot scale
  (dozens of users, hundreds of events). When you're past that, swap the `server/store.js`
  seam for Postgres — the README documents the path. Don't do it before the pilot answers
  the product question.

---

## Step 9 — Later: a "proper" native app (only after pilots)

When real usage justifies store presence:
1. Wrap the same codebase with **Capacitor** (`npx cap add ios/android`).
2. iOS: needs a Mac + Xcode + Apple Developer account (US$99/yr) → TestFlight for pilot
   builders.
3. Android: Play Console account (US$25 one-off) → internal testing track.

The web PWA and the native wrapper share 100% of the app code, so this is a packaging step,
not a rebuild. **Do not do this before the pilot.**

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Build fails: `ENOENT … package.json` | **The repo is empty/placeholder — the code was never pushed.** Check the repo on github.com: if it only has the default `README.md`, run `push-to-github.sh` from the downloaded folder (or the git commands in DEPLOY.md Step 1). |
| Mic button errors on phone | Not HTTPS (use deployed URL), or permission denied → use typed capture; check browser settings |
| Dispatch says "queued" not "sent" | `RESEND_API_KEY` missing or invalid → set it, redeploy, test from Pilot console |
| Email links point to `localhost` | `BB_PUBLIC_URL` not set → set to your `https://` URL, redeploy |
| Data disappears after redeploy | No persistent disk → add one, set `BB_DATA_DIR`/`BB_UPLOADS_DIR` |
| App won't install / no icon | Must be HTTPS; hard-refresh first visit; Android needs Chrome, iOS needs Safari |
| Slow first load on free tier | Free hosts sleep → upgrade to Starter or use a VPS |
| Registration says email exists | Demo seeded emails (mike@, jess@…) are reserved — use real addresses or register a new company |

---

*BoundBuild MVP v0.1.0 — deploy, install, and run a real pilot. Capture. Document. Get Paid.*
