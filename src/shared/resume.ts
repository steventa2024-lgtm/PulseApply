/**
 * Resume documents: the structured model edited in the Resume Helper, and the
 * single HTML renderer used both for the live preview (renderer process) and
 * for the PDF export (main process). Because both use the same HTML, CSS and
 * pagination function, the downloaded PDF has the same pages as the preview.
 *
 * Everything here is plain, dependency-free TypeScript so it runs in either
 * process.
 */

export type ResumeTemplateId = 'classic' | 'modern' | 'technical'
export type ResumePageSize = 'letter' | 'a4'
export type ResumeSectionId =
  'summary' | 'experience' | 'skills' | 'education' | 'certifications' | 'projects'

export interface ResumeContact {
  fullName: string
  email: string
  phone: string
  location: string
  linkedin: string
  website: string
}

export interface ResumeExperience {
  id: string
  title: string
  company: string
  location?: string
  /** YYYY-MM */
  startDate?: string
  /** YYYY-MM */
  endDate?: string
  current: boolean
  bullets: string[]
}

export interface ResumeEducation {
  id: string
  institution: string
  degree?: string
  field?: string
  location?: string
  graduationDate?: string
  details?: string
}

export interface ResumeCertification {
  id: string
  name: string
  issuer?: string
  date?: string
}

export interface ResumeProject {
  id: string
  name: string
  link?: string
  bullets: string[]
}

export interface ResumeDocument {
  id: string
  name: string
  template: ResumeTemplateId
  pageSize: ResumePageSize
  contact: ResumeContact
  headline?: string
  summary?: string
  experience: ResumeExperience[]
  education: ResumeEducation[]
  skills: string[]
  certifications: ResumeCertification[]
  projects: ResumeProject[]
  sectionOrder: ResumeSectionId[]
  targetRole?: string
  origin: 'imported' | 'created'
  sourceResumeId?: string
  version: number
  isMaster: boolean
  createdAt: string
  updatedAt: string
}

export interface ResumeDocumentSummary {
  id: string
  name: string
  template: ResumeTemplateId
  version: number
  isMaster: boolean
  origin: 'imported' | 'created'
  updatedAt: string
  resumeId?: string
}

export interface ResumeVersionInfo {
  version: number
  note?: string
  createdAt: string
}

export type SuggestionKind =
  | 'missing_contact'
  | 'missing_summary'
  | 'weak_verb'
  | 'first_person'
  | 'long_bullet'
  | 'no_bullets'
  | 'add_quantity'
  | 'skill_in_text'
  | 'target_keyword'
  | 'duplicate_skill'
  | 'date_missing'
  | 'too_long'
  | 'rewrite'

export interface ResumeSuggestion {
  id: string
  kind: SuggestionKind
  /** Dot path into the document, e.g. `experience.0.bullets.2`, `summary`, `skills`. */
  path: string
  section: ResumeSectionId | 'contact'
  message: string
  before?: string
  /** Replacement text (for `skills`, a comma-separated list to add). Absent = advice only. */
  after?: string
  /**
   * True when accepting would add a claim only the user can confirm (a skill
   * or keyword). Such suggestions are never applied without an explicit accept.
   */
  requiresConfirmation: boolean
  source: 'rules' | 'ollama'
}

export const TEMPLATES: { id: ResumeTemplateId; label: string; description: string }[] = [
  {
    id: 'classic',
    label: 'Professional Classic',
    description: 'Serif headings, centred name, ruled sections. Suits most industries.'
  },
  {
    id: 'modern',
    label: 'Modern Minimal',
    description: 'Clean sans-serif, left-aligned, subtle accent colour.'
  },
  {
    id: 'technical',
    label: 'Technical',
    description: 'Compact layout with skills up front. Suits technical and trade roles.'
  }
]

export const SECTION_LABEL: Record<ResumeSectionId, string> = {
  summary: 'Summary',
  experience: 'Experience',
  skills: 'Skills',
  education: 'Education',
  certifications: 'Certifications',
  projects: 'Projects'
}

export const DEFAULT_SECTION_ORDER: ResumeSectionId[] = [
  'summary',
  'experience',
  'skills',
  'education',
  'certifications',
  'projects'
]

/** CSS pixel sizes at 96 dpi. */
export const PAGE_PX: Record<ResumePageSize, { width: number; height: number; css: string }> = {
  letter: { width: 816, height: 1056, css: '8.5in 11in' },
  a4: { width: 794, height: 1123, css: '210mm 297mm' }
}

export const PAGE_GAP_PX = 24

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function escapeHtml(s: string | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatMonth(ym: string | undefined): string {
  if (!ym) return ''
  const m = /^(\d{4})-(\d{2})$/.exec(ym)
  if (!m) return ym
  const month = Number(m[2])
  return month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${m[1]}` : m[1]
}

export function dateRange(start?: string, end?: string, current?: boolean): string {
  const a = formatMonth(start)
  const b = current ? 'Present' : formatMonth(end)
  if (a && b) return `${a} – ${b}`
  return a || b
}

/** `First_Last_Resume.pdf`, ASCII-safe. */
export function resumeFileName(doc: Pick<ResumeDocument, 'contact' | 'name'>): string {
  const base = (doc.contact.fullName || doc.name || 'Resume')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 -]+/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join('_')
  return `${base || 'My'}_Resume.pdf`
}

export function emptyResumeDocument(id: string, now = new Date().toISOString()): ResumeDocument {
  return {
    id,
    name: 'My resume',
    template: 'classic',
    pageSize: 'letter',
    contact: { fullName: '', email: '', phone: '', location: '', linkedin: '', website: '' },
    experience: [],
    education: [],
    skills: [],
    certifications: [],
    projects: [],
    sectionOrder: [...DEFAULT_SECTION_ORDER],
    origin: 'created',
    version: 0,
    isMaster: false,
    createdAt: now,
    updatedAt: now
  }
}

/** Plain-text rendering (used for matching, profile text and tests). */
export function resumePlainText(doc: ResumeDocument): string {
  const lines: string[] = []
  const c = doc.contact
  lines.push(c.fullName)
  if (doc.headline) lines.push(doc.headline)
  lines.push([c.email, c.phone, c.location, c.linkedin, c.website].filter(Boolean).join(' | '))
  for (const sec of doc.sectionOrder) {
    if (sec === 'summary' && doc.summary) lines.push('SUMMARY', doc.summary)
    if (sec === 'experience' && doc.experience.length) {
      lines.push('EXPERIENCE')
      for (const e of doc.experience) {
        lines.push(`${e.title} — ${e.company}${e.location ? `, ${e.location}` : ''}`)
        lines.push(dateRange(e.startDate, e.endDate, e.current))
        for (const b of e.bullets) lines.push(`• ${b}`)
      }
    }
    if (sec === 'skills' && doc.skills.length) lines.push('SKILLS', doc.skills.join(', '))
    if (sec === 'education' && doc.education.length) {
      lines.push('EDUCATION')
      for (const e of doc.education)
        lines.push([e.degree, e.field, e.institution, e.graduationDate].filter(Boolean).join(', '))
    }
    if (sec === 'certifications' && doc.certifications.length) {
      lines.push('CERTIFICATIONS')
      for (const c2 of doc.certifications)
        lines.push([c2.name, c2.issuer, c2.date].filter(Boolean).join(', '))
    }
    if (sec === 'projects' && doc.projects.length) {
      lines.push('PROJECTS')
      for (const p of doc.projects) {
        lines.push(p.name)
        for (const b of p.bullets) lines.push(`• ${b}`)
      }
    }
  }
  return lines.filter((l) => l !== undefined && l !== '').join('\n')
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#fff;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
#pa-source{position:absolute;left:-10000px;top:0;width:var(--content-w)}
.pa-page{width:var(--page-w);height:var(--page-h);background:#fff;overflow:hidden;position:relative;break-after:page;page-break-after:always}
.pa-page:last-child{break-after:auto;page-break-after:auto}
.pa-body{position:absolute;left:var(--margin-x);top:var(--margin-y);width:var(--content-w);height:var(--content-h);overflow:hidden}
.pa-block{break-inside:avoid}
ul.pa-block{list-style:none;padding-left:14px;position:relative}
ul.pa-block li::before{content:'•';position:absolute;left:2px}
.pa-row{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
.pa-muted{color:#555}
body.preview{background:#e5e7eb}
body.preview #pa-pages{display:flex;flex-direction:column;align-items:center;gap:${PAGE_GAP_PX}px;padding:${PAGE_GAP_PX}px 0}
body.preview .pa-page{box-shadow:0 1px 4px rgba(0,0,0,.25)}
@media print{body.preview{background:#fff}body.preview #pa-pages{gap:0;padding:0}body.preview .pa-page{box-shadow:none}}
`

const TEMPLATE_CSS: Record<ResumeTemplateId, string> = {
  classic: `
:root{--margin-x:0.7in;--margin-y:0.6in}
body{font-family:Georgia,'Times New Roman',Times,serif;font-size:10.5pt;line-height:1.35}
.pa-name{font-size:21pt;text-align:center;letter-spacing:.5px}
.pa-headline{text-align:center;font-style:italic;margin-top:2px}
.pa-contact{text-align:center;font-size:9.5pt;margin-top:4px;color:#333}
.pa-h{font-size:11pt;text-transform:uppercase;letter-spacing:1.2px;border-bottom:1px solid #111;margin:12px 0 5px;padding-bottom:2px}
.pa-entry{margin-top:6px}
.pa-title{font-weight:bold}
ul.pa-block{margin-top:1px}
`,
  modern: `
:root{--margin-x:0.65in;--margin-y:0.55in}
body{font-family:'Helvetica Neue',Helvetica,Arial,'Liberation Sans',sans-serif;font-size:10pt;line-height:1.4;color:#1f2937}
.pa-name{font-size:22pt;font-weight:700;color:#0e7490}
.pa-headline{font-size:11pt;color:#374151;margin-top:1px}
.pa-contact{font-size:9pt;margin-top:4px;color:#4b5563}
.pa-h{font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#0e7490;margin:13px 0 4px}
.pa-entry{margin-top:6px}
.pa-title{font-weight:600}
`,
  technical: `
:root{--margin-x:0.55in;--margin-y:0.5in}
body{font-family:Arial,'Liberation Sans',Helvetica,sans-serif;font-size:9.5pt;line-height:1.3}
.pa-name{font-size:18pt;font-weight:700}
.pa-headline{font-size:10pt;font-weight:600;margin-top:1px}
.pa-contact{font-size:8.5pt;margin-top:3px;color:#333}
.pa-h{font-size:9.5pt;font-weight:700;text-transform:uppercase;background:#f1f5f9;padding:2px 5px;margin:9px 0 4px}
.pa-entry{margin-top:4px}
.pa-title{font-weight:700}
.pa-skills{columns:2;column-gap:18px}
`
}

/** Section order used by a template (technical puts skills first). */
export function effectiveOrder(doc: ResumeDocument): ResumeSectionId[] {
  const order = doc.sectionOrder.length ? doc.sectionOrder : DEFAULT_SECTION_ORDER
  if (doc.template !== 'technical') return order
  return ['skills', ...order.filter((s) => s !== 'skills')]
}

function block(html: string, cls = '', keep = false): string {
  return `<div class="pa-block${keep ? ' pa-keep' : ''}${cls ? ' ' + cls : ''}">${html}</div>`
}

function bullets(list: string[]): string {
  return list
    .filter((b) => b.trim())
    .map((b) => `<ul class="pa-block"><li>${escapeHtml(b.trim())}</li></ul>`)
    .join('')
}

/**
 * Renders the resume as an HTML document. The flow content goes into
 * `#pa-source`; {@link paginateResume} then distributes its blocks over
 * fixed-size `.pa-page` elements.
 */
export function renderResumeHtml(
  doc: ResumeDocument,
  opts: { mode: 'preview' | 'print' } = { mode: 'print' }
): string {
  const page = PAGE_PX[doc.pageSize]
  const c = doc.contact
  const parts: string[] = []
  const contactLine = [c.location, c.phone, c.email, c.linkedin, c.website]
    .filter((x) => x && x.trim())
    .map((x) => escapeHtml(x.trim()))
    .join(' &nbsp;|&nbsp; ')
  parts.push(
    block(
      `<div class="pa-name">${escapeHtml(c.fullName || 'Your Name')}</div>` +
        (doc.headline ? `<div class="pa-headline">${escapeHtml(doc.headline)}</div>` : '') +
        (contactLine ? `<div class="pa-contact">${contactLine}</div>` : ''),
      'pa-header'
    )
  )
  const heading = (s: ResumeSectionId): string =>
    block(`<h2 class="pa-h">${SECTION_LABEL[s]}</h2>`, '', true)

  for (const s of effectiveOrder(doc)) {
    if (s === 'summary' && doc.summary?.trim()) {
      parts.push(heading(s), block(`<p>${escapeHtml(doc.summary.trim())}</p>`))
    }
    if (s === 'experience' && doc.experience.length) {
      parts.push(heading(s))
      for (const e of doc.experience) {
        parts.push(
          block(
            `<div class="pa-row"><span><span class="pa-title">${escapeHtml(e.title)}</span>${e.company ? `, ${escapeHtml(e.company)}` : ''}${e.location ? `<span class="pa-muted"> — ${escapeHtml(e.location)}</span>` : ''}</span><span class="pa-muted">${escapeHtml(dateRange(e.startDate, e.endDate, e.current))}</span></div>`,
            'pa-entry',
            e.bullets.length > 0
          ),
          bullets(e.bullets)
        )
      }
    }
    if (s === 'skills' && doc.skills.length) {
      parts.push(
        heading(s),
        block(
          doc.template === 'technical'
            ? `<div class="pa-skills">${doc.skills.map((k) => `<div>${escapeHtml(k)}</div>`).join('')}</div>`
            : `<p>${doc.skills.map(escapeHtml).join(', ')}</p>`
        )
      )
    }
    if (s === 'education' && doc.education.length) {
      parts.push(heading(s))
      for (const e of doc.education) {
        const deg = [e.degree, e.field].filter(Boolean).join(', ')
        parts.push(
          block(
            `<div class="pa-row"><span><span class="pa-title">${escapeHtml(e.institution)}</span>${deg ? ` — ${escapeHtml(deg)}` : ''}${e.location ? `<span class="pa-muted">, ${escapeHtml(e.location)}</span>` : ''}</span><span class="pa-muted">${escapeHtml(formatMonth(e.graduationDate))}</span></div>` +
              (e.details ? `<p class="pa-muted">${escapeHtml(e.details)}</p>` : ''),
            'pa-entry'
          )
        )
      }
    }
    if (s === 'certifications' && doc.certifications.length) {
      parts.push(heading(s))
      for (const k of doc.certifications)
        parts.push(
          block(
            `<div class="pa-row"><span><span class="pa-title">${escapeHtml(k.name)}</span>${k.issuer ? `, ${escapeHtml(k.issuer)}` : ''}</span><span class="pa-muted">${escapeHtml(formatMonth(k.date))}</span></div>`
          )
        )
    }
    if (s === 'projects' && doc.projects.length) {
      parts.push(heading(s))
      for (const p of doc.projects)
        parts.push(
          block(
            `<span class="pa-title">${escapeHtml(p.name)}</span>${p.link ? ` <span class="pa-muted">${escapeHtml(p.link)}</span>` : ''}`,
            'pa-entry',
            p.bullets.length > 0
          ),
          bullets(p.bullets)
        )
    }
  }

  const vars = `:root{--page-w:${page.width}px;--page-h:${page.height}px;--content-w:calc(var(--page-w) - 2*var(--margin-x));--content-h:calc(var(--page-h) - 2*var(--margin-y))}`
  const pageRule = `@page{size:${page.css};margin:0}`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(resumeFileName(doc).replace(/\.pdf$/, ''))}</title><style>${pageRule}${BASE_CSS}${TEMPLATE_CSS[doc.template]}${vars}</style></head><body class="${opts.mode}"><div id="pa-source">${parts.join('')}</div><div id="pa-pages"></div></body></html>`
}

/**
 * Distributes `#pa-source` blocks over fixed-size pages. Headings (`.pa-keep`)
 * are never left alone at the bottom of a page. Self-contained on purpose: the
 * main process serializes it with `Function.prototype.toString` and runs it in
 * the PDF window, the renderer calls it directly on the preview iframe.
 * Returns the number of pages.
 */
export function paginateResume(d: Document): number {
  const src = d.getElementById('pa-source')
  const out = d.getElementById('pa-pages')
  if (!src || !out) return 0
  out.innerHTML = ''
  let body: HTMLElement = d.createElement('div')
  const newPage = (): void => {
    const pg = d.createElement('div')
    pg.className = 'pa-page'
    body = d.createElement('div')
    body.className = 'pa-body'
    pg.appendChild(body)
    out.appendChild(pg)
  }
  newPage()
  const blocks = Array.prototype.slice.call(src.children) as HTMLElement[]
  for (const original of blocks) {
    const b = original.cloneNode(true) as HTMLElement
    body.appendChild(b)
    if (body.scrollHeight > body.clientHeight + 1 && body.children.length > 1) {
      body.removeChild(b)
      const carry: Element[] = []
      while (
        body.lastElementChild &&
        body.lastElementChild.classList.contains('pa-keep') &&
        body.children.length > 1
      ) {
        carry.unshift(body.lastElementChild)
        body.removeChild(body.lastElementChild)
      }
      newPage()
      for (const c of carry) body.appendChild(c)
      body.appendChild(b)
    }
  }
  src.style.display = 'none'
  return out.children.length
}
