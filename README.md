# PulseApply

A desktop job-search assistant (Electron + React + TypeScript) that searches **real job sources**,
explains how each job matches your resume, opens the **real employer application page**, fills in
what it can from your approved profile, and waits for **your explicit approval** before submitting.

PulseApply never invents vacancies, salaries, employers or qualifications. Every job links to an
identifiable source; values PulseApply derives itself are marked as inferred; missing pay is shown
as “Not disclosed”.

---

## Quick start

Requirements: **Node.js 22+**, npm 10+, Windows / macOS / Linux.

```bash
npm install                          # also downloads Electron and rebuilds native deps
npx playwright install chromium      # browser used for application autofill (optional, see below)
npm run dev                          # start in development mode
```

Production build:

```bash
npm run build          # typecheck + bundle (out/)
npm start              # run the built bundle
npm run build:win      # Windows installer   (also: build:mac, build:linux, build:unpack)
```

Quality checks:

```bash
npm run lint
npm run typecheck
npm test               # 76 tests; the UI test needs `npm run build` first, browser tests need Chromium
```

> **Application browser.** Autofill opens a *visible* browser. PulseApply tries, in order: a custom
> executable (Settings), Playwright’s Chromium (`npx playwright install chromium`), installed
> Google Chrome, then Microsoft Edge (preinstalled on Windows). If none is available, the
> Applications page tells you what to install.

---

## How it works

| Area | What it does |
|---|---|
| **Search** | Natural-language queries (“part-time barista within 15 miles”, “remote junior frontend developer”) are parsed into occupation, location, radius, work mode, pay, schedule and seniority. |
| **Sources** | Providers run in parallel with bounded concurrency, timeouts, retries with backoff, `Retry-After` handling, per-provider caching and cancellation. One failing source never stops the others. |
| **Location** | Offline GeoNames gazetteer (112k cities, US ZIPs) with distance-based radius filtering; remote postings are checked against their stated eligibility (US-only, Europe, worldwide…). Unresolvable locations are marked *unknown*, never *local*. |
| **Relevance** | An occupational taxonomy (≈75 occupations with synonyms, incl. non-English titles) classifies jobs by **title first**. A paralegal job never appears for a warehouse search just because both mention “customer service”. |
| **Dedup** | Same posting from several sources → one card “Found through N sources”, preferring the employer’s own link. Different shifts/requisitions stay separate. |
| **Verification** | `EMPLOYER_CONFIRMED`, `SOURCE_CONFIRMED`, `STALE`, `EXPIRED`, `REMOVED`, `VERIFICATION_FAILED`; on-demand availability checks; basic scam warning signals. |
| **Matching** | Explainable weighted criteria (occupation, specific skills, required licenses, experience, transferable skills, seniority, location, work mode, pay, employment type). No score floor; caps stop generic skills from inflating unrelated jobs. Optional local semantic similarity via Ollama. Scores are labelled as heuristics, not hiring probabilities. |
| **Applications** | Label-based form detection (not hard-coded selectors), resume upload, multi-step forms, CAPTCHA/sign-in detection (PulseApply pauses — it never bypasses them). Submission is recorded as `SUBMITTED` **only** when the site shows a confirmation; otherwise `SUBMISSION_UNVERIFIED`. |
| **Automation** | Saved searches with intervals, pause/resume, run-now, backoff on failure, no duplicate runs; Telegram notifies only about jobs not previously sent. |

### Job sources

| Source | Type | Setup | Coverage |
|---|---|---|---|
| **Adzuna** | Aggregator | Free key ([signup](https://developer.adzuna.com/signup)) | Local jobs in 19 countries (US, UK, CA, AU, DE, FR, …) |
| **Jooble** | Aggregator | Free key ([about](https://jooble.org/api/about)); regional keys per country | International |
| **USAJOBS** | Government | Free key + registered email ([request](https://developer.usajobs.gov/apirequest/)) | U.S. federal jobs (“who may apply” shown per job) |
| **Greenhouse / Lever / Ashby / SmartRecruiters** | Employer ATS | None — add employers on **Sources** | Only the employers you register (APIs are per-company) |
| **Employer career pages** | Employer site | None — add a careers URL | Pages publishing schema.org `JobPosting` data; robots.txt respected |
| Remote OK, Remotive, Arbeitnow, Jobicy, Himalayas | Remote boards | None | Queried only for remote searches (Arbeitnow also for Europe) |
| Brave Search API | Discovery | Optional key | Suggests employer ATS boards near your search (you choose what to add) |
| LinkedIn, Indeed, ZipRecruiter, Glassdoor | Restricted | — | No authorized API: PulseApply opens a pre-filled search for manual browsing. Never scraped. |

**For local (non-remote) searches you need at least one aggregator key or registered employers.**
Without them, a local search will correctly report that no source could be queried. Coverage is only
as wide as the sources you connect — PulseApply does not claim global coverage it doesn’t have.

Quotas and rate limits are those of your own keys; 429 responses pause a provider until the time
the provider reports.

### Credentials and privacy

* Enter keys on **Sources** (and the Telegram token on **Automation**). They are encrypted with the
  OS keychain via Electron `safeStorage` (DPAPI / Keychain / libsecret) and never sent to the UI,
  logs or exports. `.env.example` lists optional environment variables for development; those are
  imported into the encrypted store once and are excluded from packaged builds.
* Work-authorization / sponsorship answers are optional, stored encrypted, and used for autofill
  only if you switch that on. Demographic, disability, veteran, criminal-history, certification,
  experience-years and legal-declaration questions are **never** answered automatically unless you
  added an explicit pre-approved answer.
* Resume files are copied into the app’s data folder (`resumes/`). Profile export excludes
  credentials; “Delete profile” removes the profile and stored resume files.

### Semantic matching with Ollama (optional)

```bash
# install from https://ollama.com, then:
ollama pull nomic-embed-text
```

Settings → *Semantic matching* shows whether it is active. Without Ollama the deterministic matcher
is used. No cloud AI or paid API is required.

### Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather) and paste its token on **Automation**.
2. Click **Start bot**, send `/start` to your bot, then **Authorize** your chat in PulseApply.
3. Scheduled searches with “notify” enabled send new matching jobs with *Save / Apply / Dismiss*
   buttons. Buttons carry persistent random tokens (not positions), keep working after new batches
   and restarts, expire after 14 days, and only work in authorized chats. “Apply” only *queues* the
   application; the browser opens when you are at your computer.

If you see a *409 Conflict*, another program or computer is polling the same bot token (or a
webhook is set — use **Remove webhook**). PulseApply itself runs a single poller per token.

---

## Data & migration

Data lives in Electron’s `userData` folder (`%APPDATA%\pulseapply` on Windows):

| File | Purpose |
|---|---|
| `pulseapply.sqlite` | SQLite database (sql.js). Written atomically; the previous version is kept as `.prev`. |
| `pulseapply_db.json` | Pre-upgrade database. **Never modified or deleted.** |
| `pulseapply_db.backup-<time>.json` | Byte-verified backup made before the one-time import. |
| `resumes/` | Your uploaded resume versions. |

On first launch of this version, the legacy JSON is imported once (idempotent): contact details are
imported **unconfirmed** (the old parser substituted hardcoded defaults when extraction failed), the
old default work-authorization value is **not** imported, the previous sample job records are kept
for history but hidden, and jobs previously marked “applied” become `SUBMISSION_UNVERIFIED` (the old
version recorded approval, not an observed submission). Details appear under Settings → Data.

## Demo mode

Settings → **Demo mode** creates a clearly labelled practice job and local practice form. Demo data
is never shown in normal mode and nothing is sent anywhere.

## Limitations

* Workday, iCIMS, Taleo, ADP, SuccessFactors and Oracle portals need accounts/sign-in and are routed
  to **manual completion** (the page opens; PulseApply records the outcome you confirm).
* Lever/Ashby/Greenhouse forms may show CAPTCHA; you complete it yourself.
* OCR for scanned PDFs is optional (`npm install tesseract.js`); otherwise upload DOCX or a text PDF.
* Scheduled searches run only while PulseApply is open.
* The database is single-process; PulseApply enforces a single running instance.

## Troubleshooting

| Symptom | Fix |
|---|---|
| “No job source could be queried” | Add an Adzuna/Jooble/USAJOBS key or register employers on **Sources**. |
| A source shows *Rate-limited* | Wait for the shown time; results are cached meanwhile. |
| “Could not start a browser” | `npx playwright install chromium`, or install Chrome/Edge, or set a path in Settings. |
| Telegram 409 | Stop other clients using the token; remove any webhook. |
| Scanned resume | Upload DOCX or text PDF, or install `tesseract.js`. |
| Verbose logs | Run with `PULSEAPPLY_DEBUG=1` (secrets are always redacted). |

## Project layout

```
src/main/            Electron main process
  app/services.ts    service composition root (Electron-independent, testable)
  ipc/handlers.ts    zod-validated IPC handlers
  services/
    jobs/            providers, geo, search intent & taxonomy, normalization, dedupe, verification, orchestration
    matching/        explainable matcher, candidate model, Ollama embeddings
    applications/    browser manager, form inspector, field mapper, ATS adapters, submission verifier, state machine
    telegram/        Bot API client, polling lock, bot service
    scheduler/       saved-search scheduler
    persistence/     SQLite, migrations, repositories, legacy import, secrets
    resume/          PDF/DOCX extraction and confidence-aware profile extraction
src/preload/         sandboxed, allow-listed IPC bridge
src/renderer/        React UI
src/shared/          types and IPC contract shared by all processes
resources/geo/       offline gazetteer (GeoNames, CC BY 4.0) — rebuild with `npm run build:gazetteer`
tests/               unit, integration and browser tests (synthetic fixtures; no live data)
```

Geographic data © [GeoNames](https://www.geonames.org/), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
