---
name: find-jobs-near-me
description: Find real job postings near the user for the occupations in their PulseApply search, by browsing public employer career pages and job pages in the user's browser, and drop them into PulseApply's job inbox. Use when the user asks to find jobs near them, look for jobs online, "send jobs to my app", or fill PulseApply with jobs from the web.
---

# Find jobs near me → PulseApply job inbox

You browse the web for **real, currently open** job postings that fit what the user is
looking for, and save them as a JSON file in PulseApply's job inbox. PulseApply imports the
file within seconds and runs every job through the same occupation, location and work-mode
filters as its API sources — so collect broadly but honestly, and let the app filter.

## 1. Find the inbox and the search request

The inbox is PulseApply's data folder + `inbox`:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\pulseapply\inbox` (PowerShell: `"$env:APPDATA\pulseapply\inbox"`) |
| macOS | `~/Library/Application Support/pulseapply/inbox` |
| Linux | `~/.config/pulseapply/inbox` |

PulseApply also shows the exact path on its **Sources** page ("Job inbox"). Read
`_search-request.json` in that folder — it lists the `occupations`, `query`, `location`,
`radius`, `workModes` and `excludedOccupations` from the user's saved criteria. If it is
missing (app never started), ask the user what jobs and which city they want.

## 2. Browse

Use whatever browser the session has (Claude in Chrome, the built-in browser), otherwise web
search + fetch. For each occupation (e.g. "Warehouse Associate", "Barista"):

1. Search: `<occupation> jobs near <location>` and `<occupation> hiring <city> <state>`.
   Google's job listings panel usually links to the employer's own posting — follow those.
2. Good sources: employer career sites, applicant-tracking pages (Greenhouse, Lever, Ashby,
   SmartRecruiters, Workday, iCIMS, Taleo job pages), state/government job banks, city and
   school-district job pages, local business "We're hiring" pages.
3. Open each individual posting and read it. Record only what the page states.

Rules — these are not optional:

- **Never invent anything.** Every job must come from a page you actually opened. If a field
  (pay, type, posting date) is not on the page, leave it out.
- The `url` must be the link to that posting page. Prefer the employer's own page.
- Do **not** collect from LinkedIn, Indeed, Glassdoor or ZipRecruiter pages (their terms
  forbid automated collection). If a listing only exists there, skip it and mention to the
  user that they can open it themselves.
- Never sign in, create accounts, solve or bypass CAPTCHAs, or get around blocks or paywalls.
  If a site blocks you, move on.
- Browse at a human pace and stop at about 40 jobs per run.
- Skip postings that are closed/expired, clearly outside the requested area (unless
  `workModes` includes `remote` and the posting is remote), or in an excluded occupation.

## 3. Write the inbox file

Write ONE file named `jobs-<YYYYMMDD-HHMMSS>.json` into the inbox. Write it to a `.tmp` name
first and rename it to `.json` when complete (PulseApply only reads finished `.json` files).

```json
{
  "jobs": [
    {
      "title": "Warehouse Associate",
      "company": "Example Distribution Co.",
      "location": "Carson, CA",
      "url": "https://careers.example.com/jobs/12345",
      "applyUrl": "https://careers.example.com/jobs/12345/apply",
      "description": "Text copied from the posting (responsibilities, requirements)…",
      "salary": "$19.50–$21.00 an hour",
      "employmentType": "Full-time",
      "workMode": "onsite",
      "postedAt": "2026-09-30",
      "foundOn": "Google jobs → employer site"
    }
  ]
}
```

Required: `title`, `company`, `location` (city + state, or "Remote"), `url` (public http/https).
Optional: `applyUrl`, `description` (strongly recommended — matching uses it), `salary`
(exactly as advertised), `employmentType`, `workMode` (`onsite` | `hybrid` | `remote`),
`postedAt` (ISO date), `foundOn`. A schema.org `JobPosting` object copied from a page's
JSON-LD is also accepted (it must include `url`).

## 4. Confirm

After a few seconds the file moves to `inbox/imported/` (or `inbox/failed/` with an
`.errors.txt` explaining why). Tell the user how many jobs you saved, which sites they came
from, and anything you skipped and why. In PulseApply they appear on **Results**: eligible
ones under *Eligible*, others under *Excluded* with the reason. Imported jobs are marked
*Unverified* until the user clicks *Check availability*.
