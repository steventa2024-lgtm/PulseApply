import http from 'http'
import type { AddressInfo } from 'net'

/**
 * A controlled, local "employer" website used to exercise real browser
 * automation without ever submitting to an actual employer.
 */
export interface Submission {
  path: string
  fields: Record<string, string>
  files: string[]
}

function parseMultipart(body: Buffer, contentType: string): { fields: Record<string, string>; files: string[] } {
  const fields: Record<string, string> = {}
  const files: string[] = []
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType)
  if (!m) {
    for (const [k, v] of new URLSearchParams(body.toString('utf8'))) fields[k] = v
    return { fields, files }
  }
  const boundary = '--' + (m[1] ?? m[2])
  for (const part of body.toString('latin1').split(boundary)) {
    const head = /name="([^"]+)"(?:; filename="([^"]*)")?/.exec(part)
    if (!head) continue
    const value = part.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '')
    if (head[2] !== undefined) {
      if (head[2]) files.push(head[2])
    } else fields[head[1]] = value
  }
  return { fields, files }
}

const layout = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`

const GH_FORM = (errors: string[] = []) =>
  layout(
    'Warehouse Associate - Test Employer',
    `<h1>Warehouse Associate</h1>
<div id="app_body"><p>Pick and pack orders.</p></div>
${errors.length ? `<div role="alert" class="error">${errors.join('<br>')}</div>` : ''}
<form id="application_form" method="post" action="/gh/submit" enctype="multipart/form-data">
  <div class="field"><label for="first_name">First Name *</label><input id="first_name" name="first_name" required></div>
  <div class="field"><label for="last_name">Last Name *</label><input id="last_name" name="last_name" required></div>
  <div class="field"><label for="email">Email *</label><input id="email" name="email" type="email" required></div>
  <div class="field"><label for="phone">Phone</label><input id="phone" name="phone" type="tel"></div>
  <div class="field"><label for="resume">Resume/CV *</label><input id="resume" name="resume" type="file" required accept=".pdf,.doc,.docx"></div>
  <div class="field"><label for="linkedin">LinkedIn Profile</label><input id="linkedin" name="linkedin" type="url"></div>
  <div class="field"><label for="q_auth">Are you legally authorized to work in the United States? *</label>
    <select id="q_auth" name="q_auth" required><option value="">Select...</option><option value="1">Yes</option><option value="0">No</option></select></div>
  <div class="field"><label for="q_sponsor">Will you now or in the future require sponsorship for employment visa status? *</label>
    <select id="q_sponsor" name="q_sponsor" required><option value="">Select...</option><option value="1">Yes</option><option value="0">No</option></select></div>
  <div class="field"><label for="q_forklift">Do you have a current forklift certification? *</label>
    <select id="q_forklift" name="q_forklift" required><option value="">Select...</option><option>Yes</option><option>No</option></select></div>
  <div class="field"><label for="q_hear">How did you hear about this job?</label><input id="q_hear" name="q_hear"></div>
  <fieldset><legend>Gender (voluntary self-identification)</legend>
    <label><input type="radio" name="gender" value="f"> Female</label><label><input type="radio" name="gender" value="m"> Male</label><label><input type="radio" name="gender" value="x"> Decline to self-identify</label></fieldset>
  <button type="submit" id="submit_app">Submit Application</button>
</form>`
  )

export async function startTestEmployerSite(): Promise<{ url: string; submissions: Submission[]; close: () => Promise<void> }> {
  const submissions: Submission[] = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const send = (status: number, html: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers })
      res.end(html)
    }
    if (req.method === 'POST') {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const { fields, files } = parseMultipart(Buffer.concat(chunks), req.headers['content-type'] ?? '')
        submissions.push({ path: url.pathname, fields, files })
        if (url.pathname === '/gh/submit') {
          const missing = ['first_name', 'last_name', 'email', 'q_auth', 'q_sponsor', 'q_forklift'].filter((k) => !fields[k])
          if (missing.length || files.length === 0) return send(200, GH_FORM([`Missing: ${missing.join(', ') || 'resume'}`]))
          return send(303, '', { location: '/gh/confirmation' })
        }
        if (url.pathname === '/generic/submit') {
          return send(
            200,
            layout(
              'Apply',
              `<div role="alert" class="error">Phone number is invalid</div>
<form method="post" action="/generic/submit"><label for="full">Full name *</label><input id="full" name="full" required value="${fields.full ?? ''}">
<label for="em">Email address *</label><input id="em" name="em" type="email" required value="${fields.em ?? ''}">
<label for="ph">Phone *</label><input id="ph" name="ph" type="tel" required aria-invalid="true" value="${fields.ph ?? ''}">
<button type="submit">Submit</button></form>`
            )
          )
        }
        if (url.pathname === '/ambiguous/submit') return send(200, layout('Processing', '<h1>We are processing your request.</h1><p>Please wait.</p>'))
        if (url.pathname === '/multi/submit') return send(200, layout('Done', '<h1>Thank you for applying!</h1><p>Your application has been received.</p>'))
        return send(404, 'not found')
      })
      return
    }
    switch (url.pathname) {
      case '/gh/jobs/1':
        return send(200, GH_FORM())
      case '/gh/confirmation':
        return send(200, layout('Application submitted', '<h1>Thank you for applying!</h1><p>Your application has been submitted. Application ID: GH-48213</p>'))
      case '/generic/apply':
        return send(
          200,
          layout(
            'Apply',
            `<form method="post" action="/generic/submit"><label for="full">Full name *</label><input id="full" name="full" required>
<label for="em">Email address *</label><input id="em" name="em" type="email" required>
<label for="ph">Phone *</label><input id="ph" name="ph" type="tel" required>
<button type="submit">Submit</button></form>`
          )
        )
      case '/ambiguous/apply':
        return send(
          200,
          layout('Apply', `<form method="post" action="/ambiguous/submit"><label for="n">Name *</label><input id="n" name="n" required><label for="e">Email *</label><input id="e" name="e" type="email" required><button type="submit">Submit application</button></form>`)
        )
      case '/captcha/apply':
        return send(
          200,
          layout(
            'Apply',
            `<form method="post" action="/generic/submit"><label for="n">Name *</label><input id="n" name="n" required><label for="e">Email *</label><input id="e" name="e" type="email" required>
<div class="g-recaptcha" data-sitekey="test-key"></div><button type="submit">Submit application</button></form>`
          )
        )
      case '/multi/1':
        return send(
          200,
          layout('Step 1', `<form method="get" action="/multi/2"><label for="fn">First name *</label><input id="fn" name="fn" required><label for="ln">Last name *</label><input id="ln" name="ln" required><button type="submit">Next</button></form>`)
        )
      case '/multi/2':
        return send(
          200,
          layout('Step 2', `<form method="post" action="/multi/submit" enctype="multipart/form-data"><label for="cv">Upload your resume *</label><input id="cv" name="cv" type="file" required><button type="submit">Submit application</button></form>`)
        )
      case '/login':
        return send(200, layout('Sign in', `<form><label for="u">Email</label><input id="u" type="email"><label for="p">Password</label><input id="p" type="password"><button>Sign in</button></form>`))
    }
    return send(404, layout('Not found', 'not found'))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    submissions,
    close: () => new Promise<void>((r) => server.close(() => r()))
  }
}
