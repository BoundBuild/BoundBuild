[README.md](https://github.com/user-attachments/files/31011931/README.md)
# BoundBuild — MVP

> **Capture. Document. Get Paid.**
> Mobile-first construction app that turns a 30-second site conversation into a structured,
> time-stamped, dispatchable commercial record. Built to the *BoundBuild MVP Builder Brief*
> and its success metrics.

Voice note (or typed note) + photos → AI-structured draft → human review → dispatch to the
QS/office → searchable project ledger. Under a minute, one-handed, built for dirty gloves.

---

## ▶️ Quick start

```bash
npm install
npm start            # → http://localhost:8080
```

Nothing else needed for the demo. The server seeds a pilot company with two weeks of realistic
site events, capture sessions, dispatches and analytics on first boot (`data/db.json`).

### Demo accounts (password: `boundbuild-demo`)

| Account | Role | What to try |
|---|---|---|
| `foreman1@kowhaiconstruction.co.nz` | Foreman (user) | Capture → AI draft → save → dispatch |
| `qs@kowhaiconstruction.co.nz` | QS (admin) | Pilot console, outbox, team, exports |
| `founder@boundbuild.app` | Founder | Cross-company view (Companies tab) |

The login screen has one-tap demo logins. **Registration creates a brand-new company** (pilot bootstrap).

### End-to-end tests

```bash
npx playwright-core install chromium   # once
npm test                               # headless UI smoke test, 37 checks

npm run test:e2e                       # full pipeline vs mocked providers
```

`test:e2e` proves the real stack end-to-end without needing API keys: auth → audio upload →
server-side STT (mock Whisper) → AI structuring → event persistence → dispatch with a verified
PDF attachment through a mock Resend endpoint → `.eml`/PDF downloads → admin test delivery.
Swap the mocks for real credentials by filling `.env`.

---

## ✅ What's in the MVP (per the brief)

- **Mobile app basics** — secure login, user↔company, project selector, home screen with large
  orange record button, recent events, bottom nav (Home / Ledger / Record / Projects / Settings).
- **Capture flow** — tap to record audio (MediaRecorder), live captions (Web Speech API),
  optional photos (compressed client-side), quick text note, timestamped. Voice memo feel,
  not an admin workflow.
- **Offline behaviour** — failed saves queue on-device and sync automatically later
  (Settings → Offline queue → Sync). Photos are compressed so queued drafts stay small.
- **AI structuring** — transcript → structured draft: title, type, project, location, summary,
  instructed-by, time impact, cost impact, confidence, original audio retained. Every field
  editable; drafts clearly labelled as AI-generated, not legal/commercial advice.
- **Review & edit** — full field editing before/after save, add/remove photos, full audit trail
  (created / edited / dispatched / reviewed).
- **Dispatch** — branded **Commercial Event Record PDF** + branded HTML email to the nominated
  recipient (QS/PM/office), secure public recipient link with photos, `.eml` export (multipart,
  PDF included), outbox with preview and PDF download. Event stays in the ledger.
- **Email delivery** — real transactional email via **Resend** (API key, no SMTP server needed)
  or any **SMTP** provider (Postmark, SES, Mailgun…). Without credentials, dispatches queue to
  the outbox with the email body, PDF and `.eml` — add a key and delivery goes live with no
  code changes. The Pilot console shows live config status and a **Send test email** button.
- **Server-side speech-to-text** — phone mic → BoundBuild server → STT API (OpenAI-compatible
  Whisper endpoint). Configure with `STT_PROVIDER=whisper` + `OPENAI_API_KEY`; falls back to
  in-browser transcription when unset, so capture never breaks either way.
- **Ledger** — project-based, newest first, status tags (Draft / Sent / Reviewed), search +
  filters (status, type, project).
- **Pilot instrumentation** — median capture time, completion rate, usable-AI-draft rate,
  dispatch rate, weekly active users, events/user/week, 14-day charts, CSV exports of events
  and capture sessions. All visible in the **Pilot console**.
- **Admin** — companies (founder), team/user creation with roles (founder / admin / user),
  project creation with default recipients, dispatch outbox.

## 🚫 Explicitly out of scope (per the brief)

Project management workflows · contract analysis · entitlement decisions · pricing engines ·
client approvals · complex permissions · Procore/Xero/MYOB/Autodesk integrations · heavy
dashboards · safety/defects/RFIs/diaries/claims · multi-org enterprise admin · public
self-serve onboarding. (Registration is a deliberate pilot bootstrap, not self-serve scale.)

---

## 🧱 Architecture

| Layer | Choice | Why |
|---|---|---|
| Frontend | Mobile-first web app (no build step, vanilla JS SPA, PWA-ready) | Runs on any phone browser, installable; no app-store gate for pilots. Native wrapper (Capacitor) is a v1.1 wrapper, not a rewrite. |
| Backend | Node.js + Express 5, single process | Zero-build, trivially deployable (any Node host), easy for a small team to extend. |
| Data | JSON file store (`data/db.json`, atomic writes, defensive migrations) | Fine at pilot scale; Postgres is the documented upgrade path — the store module is the only seam that changes. |
| Files | Local `uploads/` (audio + photos) served via `/media` | Swap to S3/R2 when pilots grow; media records already abstract the storage path. |
| Auth | scrypt-hashed passwords + server-side session tokens (HttpOnly cookie/Bearer) | No external auth dependency for pilots; roles founder/admin/user. |
| Speech→text | **Server-side STT (Whisper API) when configured**; browser Web Speech API as fallback | Phone mic → BoundBuild → STT API is the pilot path (`STT_PROVIDER=whisper`); zero-key browser fallback keeps capture working anywhere. |
| AI structuring | **heuristic-v1 engine shipped** + optional LLM path | Works today with no keys and full transparency; set `OPENAI_API_KEY` and the same request is routed to `gpt-4o-mini` with a strict JSON schema — same shape, same UI. |
| Email | **Resend (API) or SMTP**, branded HTML + **PDF attachment** | One Resend key = live delivery (free tier covers pilots). No key → outbox mode with `.eml`/PDF/link; Pilot console has a test-delivery button. |
| QS output | **A4 Commercial Event Record PDF** (pdfkit) + branded email + recipient web page | Full record: branding, ref, timestamps, type, location, instructed-by, AI summary, cost/time impacts, photos, submitter, status, audit trail. |

### Decision-sheet answers (brief §12)

| Open question | Decision |
|---|---|
| Mobile stack | Mobile-first responsive web app + PWA manifest/SW. Capacitor wrapper later if pilots demand store presence. |
| Backend/db/storage | Express + JSON store → Postgres + S3 on the roadmap. |
| Speech-to-text / AI | Browser STT now; heuristic extractor now; `OPENAI_API_KEY` opt-in for LLM drafts. |
| Dispatch format | A4 branded Commercial Event Record **PDF attached to a branded HTML email** via Resend or SMTP + secure `/r/:token` recipient page + `.eml` download. No credentials → outbox mode (everything still works); add one key to go live. |
| Offline v1 vs v1.1 | v1: queue-and-sync for saves (photos compressed, audio uploaded live when possible). v1.1: full offline capture incl. audio via IndexedDB + SW background sync. |
| Who creates projects/recipients | Company admins (and founder). Recipients default per project; overridable at dispatch. |
| Event status model | `draft → sent → reviewed`, each transition audit-logged with user + timestamp. |

## 🗃️ Data model (brief §9)

`Company` (name, pilot status, users, projects) · `User` (name, email, role, company) ·
`Project` (name, location, company, default recipients) · `Event` (ref, title, type, summary,
project, status, timestamps, creator) + detail (location, instructed by, time/cost impact,
notes) · `Media` (audio/images ↔ event) · `Dispatch` (recipient, sent time, method, status,
token) · plus `CaptureSession` and `Audit` for instrumentation.

## 📈 Pilot instrumentation

Collected on every capture: start→save duration, completion (saved vs abandoned), events per
user per week, fields changed after AI draft (draft usefulness), dispatch rate, weekly active
users. Exposed in the Pilot console (admin) with 14-day charts and raw CSV exports for both
events and capture sessions.

## 🔐 Notes for production

- Sessions: 30-day tokens, httpOnly cookie, `SameSite=Lax`. Add CSRF protection + rate
  limiting before wider rollout.
- Passwords: scrypt (node crypto) with per-user salt. Demo users share a known password —
  change or disable them before any real pilot.
- The public `/r/:token` link is the pilot-stage "recipient view"; token is unguessable (128-bit).
- Set `PORT`, SMTP, and OpenAI values via `.env` (see `.env.example`).

## 🧭 File map

```
server/index.js        API routes, auth, admin, recipient pages
server/store.js        JSON datastore (single seam to swap for Postgres)
server/ai.js           heuristic structuring + optional LLM path
server/stt.js          server-side speech-to-text (Whisper API, fallback browser)
server/pdf.js          branded A4 Commercial Event Record PDF (pdfkit)
server/emailTemplate.js branded dispatch email
server/mailer.js       Resend / SMTP / outbox with PDF attachments + .eml
server/seed.js         demo pilot data
public/js/app.js       SPA: router, views, capture flow, admin console
public/js/api.js       API client + offline queue
public/js/recorder.js  MediaRecorder + transcription orchestration
public/css/app.css     industrial black/orange design system
test/smoke.cjs         headless UI end-to-end test (37 checks)
test/e2e.cjs           full-pipeline test vs mocked Resend + Whisper (npm run test:e2e)
test/mocks.cjs         mock external services for e2e
```

## 🗺️ After pilots (v1.1+)

Native wrapper · full offline capture (IndexedDB audio + background sync) · Postgres + S3 ·
push notifications · RFI/diary modules · Xero/MYOB exports · template-based dispatch variants ·
per-project roles. (Server-side STT and PDF dispatch are already in the MVP.)

---

*BoundBuild MVP v0.1.0 — built to the MVP Builder Brief. Capture. Document. Get Paid.*
