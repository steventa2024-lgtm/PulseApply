import { ipcRenderer } from 'electron'
import { readJobFromPage } from '../shared/clip'

/**
 * Preload for the Browse & Save window. Adds a small "Save job to PulseApply"
 * panel (in a closed shadow root, so the site cannot read or restyle it). It
 * only reads the page when the user clicks Save; it never navigates, clicks or
 * fills anything on the site. Nothing is exposed to the page's JavaScript.
 */

interface SaveReply {
  ok: boolean
  error?: string
  saved?: boolean
  summary?: string
  needsDetails?: boolean
  missing?: string[]
  prefill?: { title?: string; company?: string; location?: string; url: string }
}

const CSS = `
:host{all:initial}
.box{position:fixed;right:16px;bottom:16px;z-index:2147483647;font:13px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#e2e8f0;background:#0f172a;border:1px solid #155e75;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.45);padding:10px 12px;width:300px}
.row{display:flex;gap:8px;align-items:center}
.brand{font-weight:700;color:#67e8f9;flex:1}
button{font:inherit;cursor:pointer;border-radius:8px;border:1px solid #0891b2;background:#0891b2;color:#fff;padding:6px 10px}
button.ghost{background:transparent;border-color:#334155;color:#cbd5e1}
.msg{margin-top:6px;font-size:12px;color:#cbd5e1}
.msg.ok{color:#6ee7b7}.msg.err{color:#fca5a5}
input{font:inherit;width:100%;box-sizing:border-box;margin-top:4px;padding:5px 7px;border-radius:6px;border:1px solid #334155;background:#020617;color:#e2e8f0}
label{display:block;margin-top:6px;font-size:11px;color:#94a3b8}
.min{display:none}
`

function mount(): void {
  if (document.getElementById('pulseapply-clipper')) return
  const host = document.createElement('div')
  host.id = 'pulseapply-clipper'
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `<style>${CSS}</style>
  <div class="box">
    <div class="row"><span class="brand">PulseApply</span>
      <button class="ghost" data-a="hide" title="Hide">–</button>
      <button data-a="save">Save job</button></div>
    <div class="msg" data-m>Open a job posting, then click “Save job”.</div>
    <form class="min" data-f>
      <label>Job title<input name="title" required></label>
      <label>Employer<input name="company" required></label>
      <label>Location (City, ST or Remote)<input name="location" required></label>
      <div class="row" style="margin-top:8px"><button type="submit">Save with these details</button></div>
    </form>
  </div>`
  const msg = root.querySelector('[data-m]') as HTMLElement
  const form = root.querySelector('[data-f]') as HTMLFormElement
  const box = root.querySelector('.box') as HTMLElement
  const say = (t: string, cls = ''): void => {
    msg.textContent = t
    msg.className = `msg ${cls}`
  }
  const send = async (overrides?: Record<string, string>): Promise<void> => {
    say('Saving…')
    let reply: SaveReply
    try {
      const job = readJobFromPage(document, location.href)
      reply = await ipcRenderer.invoke('clipper:save', { job, overrides })
    } catch (e) {
      reply = { ok: false, error: (e as Error).message }
    }
    if (!reply.ok) return say(reply.error ?? 'Could not save this page.', 'err')
    if (reply.needsDetails) {
      const p = reply.prefill ?? { url: location.href }
      ;(form.elements.namedItem('title') as HTMLInputElement).value = p.title ?? ''
      ;(form.elements.namedItem('company') as HTMLInputElement).value = p.company ?? ''
      ;(form.elements.namedItem('location') as HTMLInputElement).value = p.location ?? ''
      form.style.display = 'block'
      return say(
        `Couldn't read the ${(reply.missing ?? []).join(', ')} on this page — please fill in:`
      )
    }
    form.style.display = 'none'
    say(reply.summary ?? 'Saved.', 'ok')
  }
  root.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).getAttribute('data-a')
    if (a === 'save') void send()
    if (a === 'hide') box.style.display = 'none'
  })
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const f = new FormData(form)
    void send({
      title: String(f.get('title') ?? ''),
      company: String(f.get('company') ?? ''),
      location: String(f.get('location') ?? '')
    })
  })
  document.documentElement.appendChild(host)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
else mount()
// Single-page sites replace the body; re-attach if the panel disappears.
setInterval(() => {
  if (document.body && !document.getElementById('pulseapply-clipper')) mount()
}, 2000)
