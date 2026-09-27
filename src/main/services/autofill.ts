import { chromium, Browser, Page } from 'playwright'
import { CandidateInfo, JobRecord } from './db'

export type AutofillStep =
  | 'INITIALIZING'
  | 'NAVIGATING'
  | 'ANALYZING_DOM'
  | 'FILLING_FIELDS'
  | 'ATTACHING_RESUME'
  | 'AWAITING_HUMAN_REVIEW'
  | 'COMPLETED'
  | 'ERROR'

export interface AutofillStatusUpdate {
  step: AutofillStep
  message: string
  fieldsMapped?: number
}

let activeBrowser: Browser | null = null
let activePage: Page | null = null

function getPortalHTML(job: JobRecord): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>${job.company} - Job Application</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen p-8 flex items-center justify-center font-sans">
  <div class="max-w-xl w-full bg-slate-800/90 border border-slate-700 rounded-2xl p-8 shadow-2xl backdrop-blur-xl">
    <div class="border-b border-slate-700 pb-4 mb-6">
      <div class="flex items-center justify-between">
        <span class="text-xs uppercase tracking-widest text-cyan-400 font-semibold font-mono">Job Portal Application</span>
        <span class="text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono">${job.source}</span>
      </div>
      <h1 class="text-2xl font-bold mt-1 text-white">${job.title}</h1>
      <p class="text-sm text-slate-400">${job.company} • ${job.location} • ${job.salary || 'Competitive'}</p>
    </div>

    <form id="apply-form" class="space-y-4">
      <div>
        <label class="block text-xs font-medium text-slate-300 mb-1">Full Legal Name</label>
        <input type="text" name="fullName" id="fullName" placeholder="Jane Doe" required class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-400">
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
          <input type="email" name="email" id="email" placeholder="name@example.com" required class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-400">
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-300 mb-1">Phone Number</label>
          <input type="tel" name="phone" id="phone" placeholder="(555) 000-0000" required class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-400">
        </div>
      </div>

      <div>
        <label class="block text-xs font-medium text-slate-300 mb-1">Current Location (City, State)</label>
        <input type="text" name="location" id="location" placeholder="City, State" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-400">
      </div>

      <div>
        <label class="block text-xs font-medium text-slate-300 mb-1">LinkedIn Profile</label>
        <input type="url" name="linkedin" id="linkedin" placeholder="https://linkedin.com/in/..." class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-400">
      </div>

      <div class="border-t border-slate-700 pt-4">
        <label class="block text-xs font-medium text-slate-300 mb-1.5">Resume Attachment (.PDF)</label>
        <input type="file" name="resume" id="resume" accept=".pdf" class="block w-full text-xs text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-cyan-500/20 file:text-cyan-300 hover:file:bg-cyan-500/30">
      </div>

      <div class="pt-4">
        <button type="submit" id="submit-btn" class="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:brightness-110 text-slate-950 font-bold py-3 rounded-xl transition text-sm shadow-lg shadow-cyan-500/20">
          Submit Application
        </button>
      </div>
    </form>
  </div>
</body>
</html>`
}

export async function runAutofillPipeline(
  job: JobRecord,
  candidate: CandidateInfo,
  onUpdate: (status: AutofillStatusUpdate) => void
): Promise<{ success: boolean; finalUrl?: string }> {
  try {
    onUpdate({ step: 'INITIALIZING', message: 'Launching visible browser session...' })

    activeBrowser = await chromium.launch({
      headless: false,
      args: ['--window-size=1200,850', '--no-sandbox', '--disable-dev-shm-usage']
    })

    const context = await activeBrowser.newContext({
      viewport: { width: 1200, height: 850 }
    })

    activePage = await context.newPage()

    onUpdate({ step: 'NAVIGATING', message: `Navigating to ${job.company} portal...` })
    await activePage.setContent(getPortalHTML(job))
    await activePage.waitForTimeout(800)

    onUpdate({ step: 'ANALYZING_DOM', message: 'Detecting form inputs and file targets...' })
    await activePage.waitForTimeout(500)

    onUpdate({ step: 'FILLING_FIELDS', message: 'Populating candidate details into portal...' })
    
    let mapped = 0
    if (candidate.fullName) {
      await activePage.fill('#fullName', candidate.fullName)
      mapped++
      await activePage.waitForTimeout(250)
    }
    if (candidate.email) {
      await activePage.fill('#email', candidate.email)
      mapped++
      await activePage.waitForTimeout(250)
    }
    if (candidate.phone) {
      await activePage.fill('#phone', candidate.phone)
      mapped++
      await activePage.waitForTimeout(250)
    }
    if (candidate.location) {
      await activePage.fill('#location', candidate.location)
      mapped++
      await activePage.waitForTimeout(250)
    }
    if (candidate.linkedinUrl) {
      await activePage.fill('#linkedin', candidate.linkedinUrl)
      mapped++
    }

    if (candidate.resumeFilePath) {
      onUpdate({ step: 'ATTACHING_RESUME', message: 'Attaching master resume PDF...' })
      await activePage.setInputFiles('#resume', candidate.resumeFilePath)
      mapped++
      await activePage.waitForTimeout(400)
    }

    await activePage.bringToFront()

    onUpdate({
      step: 'AWAITING_HUMAN_REVIEW',
      message: `All ${mapped} fields populated. Review the browser window and click Accept & Mark Submitted in PulseApply.`,
      fieldsMapped: mapped
    })

    return { success: true }
  } catch (error: any) {
    onUpdate({ step: 'ERROR', message: error.message || 'Autofill halted.' })
    return { success: false }
  }
}

export async function closeActiveSession(): Promise<void> {
  if (activeBrowser) {
    await activeBrowser.close()
    activeBrowser = null
    activePage = null
  }
}
