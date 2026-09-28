# PulseApply

A desktop job-search assistant (Electron + React + TypeScript) that searches **real job sources**,
explains how each job matches your resume, opens the **real employer application page**, fills in
what it can from your approved profile, and waits for **your explicit approval** before submitting.

PulseApply never invents vacancies, salaries, employers or qualifications. Every job links to an
identifiable source; values PulseApply derives itself are marked as inferred; missing pay is shown
as “Not disclosed”.

---

## Upgrading an existing installation

If your PulseApply window shows **“Run Scraper”**, **“Initiate Autofill”**, **“Accept & Mark
Submitted”** or a **“+12 point boost”** for preferred locations, you are running the *old* code
(the `main` branch or an unpushed local copy). This version lives on the branch
`claude/pulseapply-production-upgrade-hjv49f`:

```bash
cd pulseapply
git status                      # commit or stash any local changes you want to keep
git fetch origin
git checkout claude/pulseapply-production-upgrade-hjv49f
npm install
npm run dev
```

Your data folder (`%APPDATA%\pulseapply`) is kept: the old JSON database is backed up and
imported once, and the SQLite database is copied to `pulseapply.sqlite.pre-v<N>.bak` before any
schema upgrade.

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
npm test               # 103 tests; the UI test needs `npm run build` first, browser/PDF tests need Chromium
```

> **Application browser.** Autofill opens a *visible* browser. PulseApply tries, in order: a custom
> executable (Settings), Playwright’s Chromium (`npx playwright install chromium`), installed
> Google Chrome, then Microsoft Edge (preinstalled on Windows). If none is available, the
> Applications page tells you what to install.

---

## How it works

| Area | What it does |
|---|---|
| **Match criteria** | One saved set of criteria (occupation, location + radius, work mode, employment type, pay, minimum match score, required/preferred skills) drives Search, Results, the dashboard, scheduled searches and Telegram. Editing it re-checks every stored job immediately. |
| **Hard filters first** | Occupation, location, work mode, employment type, pay and age are checked **before** any score is calculated. Jobs that fail are listed under *Excluded* with the reason; they get no score. |
| **Location** (strict by default) | *Strict*: only jobs inside the radius (or remote jobs open to your country, if Remote is selected). *Preferred only* (opt-in): jobs anywhere are shown, nearby ones rank higher, far ones are labelled “Outside your preferred area”. Jobs whose location cannot be verified go to a separate *Location could not be verified* group. |
| **Resume Helper** | Improve an uploaded resume or build one from guided questions; live paginated preview beside the editor; three ATS-friendly templates; Letter/A4; **Download PDF** (real, selectable text, verified after writing); **Set as master** updates your profile, the resume attached to applications and all match scores. |
| **Search** | Natural-language queries (“part-time barista within 15 miles”, “remote junior frontend developer”) are parsed into occupation, location, radius, work mode, pay, schedule and seniority. |
| **Sources** | Providers run in parallel with bounded concurrency, timeouts, retries with backoff, `Retry-After` handling, per-provider caching and cancellation. One failing source never stops the others. |
| **Geography** | Offline GeoNames gazetteer (112k cities, US ZIPs) with distance-based radius filtering; remote postings are checked against their stated eligibility (US-only, Europe, worldwide…). Unresolvable locations are marked *unknown*, never *local*. |
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
| **CareerOneStop** | Government (U.S. DOL) | Free User ID + token ([register](https://www.careeronestop.org/Developers/WebAPI/registration.aspx)) | National Labor Exchange: local and hourly jobs from state job banks and employers across the U.S. |
| **The Muse** | Aggregator | None (optional key raises limits) | U.S. metro areas, mostly salaried roles; filtered by city |
| **Greenhouse / Lever / Ashby / SmartRecruiters** | Employer ATS | None — add employers on **Sources** | Only the employers you register (APIs are per-company) |
| **Employer career pages** | Employer site | None — add a careers URL | Pages publishing schema.org `JobPosting` data; robots.txt respected |
| Remote OK, Remotive, Arbeitnow, Jobicy, Himalayas | Remote boards | None | Queried only for remote searches (Arbeitnow also for Europe) |
| Brave Search API | Discovery | Optional key | Suggests employer ATS boards near your search (you choose what to add) |
| LinkedIn, Indeed, ZipRecruiter, Glassdoor | Restricted | — | No authorized API: PulseApply opens a pre-filled search for manual browsing. Never scraped. |

**For local (non-remote) searches, connect at least one keyed source** — for U.S. hourly jobs
(warehouse, retail, food service) CareerOneStop and Adzuna give the best coverage.
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
| `pulseapply.sqlite.pre-v<N>.bak` | Copy of the database made before a schema upgrade. |
| `resumes/` | Your uploaded resumes and PDFs of resumes set as master in the Resume Helper. |

On first launch of this version, the legacy JSON is imported once (idempotent): contact details are
imported **unconfirmed** (the old parser substituted hardcoded defaults when extraction failed), the
old default work-authorization value is **not** imported, the previous sample job records are kept
for history but hidden, and jobs previously marked “applied” become `SUBMISSION_UNVERIFIED` (the old
version recorded approval, not an observed submission). Details appear under Settings → Data.

## Resume Helper

* **Improve existing resume** — pick an uploaded resume (or upload one). PulseApply turns it into an
  editable document; nothing changes until you accept a suggestion.
* **Create new resume** — guided questions (contact, target role, jobs in your own words,
  education, skills checklist for the role, template). Only your answers are used.
* **Suggestions** only rephrase or reorganize what you wrote (e.g. “Responsible for training” →
  “Trained”, removing “I”), point out gaps, or list keywords for a target role or a saved job.
  Skills/keywords are added only when you accept them. PulseApply never invents employers,
  education, certifications, dates or numbers.
* **Local AI (optional)** — set `generateModel` for Ollama (e.g. `ollama pull llama3.2`) to get
  wording suggestions from a model on your computer. Rewrites that add numbers, names or new
  content are discarded automatically.
* **Download PDF** uses Chromium's print engine (`printToPDF`) in an isolated window with all
  network access blocked. The file is named `First_Last_Resume.pdf`, re-opened and its text checked
  before PulseApply reports success, and can be opened or shown in its folder.
* **Set as master resume** (with confirmation) stores the PDF as your default resume for
  applications, replaces the profile's experience/education/skills/contact with the document's
  content, and re-scores stored jobs. Earlier resumes stay available per application.

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
    eligibility/     authoritative criteria, evaluateJobEligibility, scoreEligibleJob, recalculation
    matching/        explainable matcher, candidate model, Ollama embeddings
    applications/    browser manager, form inspector, field mapper, ATS adapters, submission verifier, state machine
    telegram/        Bot API client, polling lock, bot service
    scheduler/       saved-search scheduler
    persistence/     SQLite, migrations, repositories, legacy import, secrets
    resume/          PDF/DOCX extraction, profile extraction, Resume Helper agent, PDF export
src/preload/         sandboxed, allow-listed IPC bridge
src/renderer/        React UI
src/shared/          types, IPC contract, resume model + HTML renderer/paginator shared by all processes
resources/geo/       offline gazetteer (GeoNames, CC BY 4.0) — rebuild with `npm run build:gazetteer`
tests/               unit, integration and browser tests (synthetic fixtures; no live data)
```

Geographic data © [GeoNames](https://www.geonames.org/), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
