import type { Frame, Page } from 'playwright'

/**
 * Enumerates the fillable fields of an application form using accessible
 * labels (label[for], wrapping label, aria-label/labelledby, fieldset legend,
 * nearby text), names, ids and input types — not hardcoded selectors.
 *
 * Each field is tagged with a `data-pa-field` attribute so later actions can
 * target exactly the element that was inspected.
 */
export interface FieldOption {
  label: string
  value: string
  index: number
}

export interface InspectedField {
  key: string
  kind: 'text' | 'email' | 'tel' | 'url' | 'number' | 'date' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'checkbox-group' | 'file'
  label: string
  name: string
  id: string
  required: boolean
  filled: boolean
  value: string
  options: FieldOption[]
  accept?: string
  multiple?: boolean
  invalid: boolean
  frameIndex: number
}

export interface FormInspection {
  url: string
  title: string
  fields: InspectedField[]
  hasCaptcha: boolean
  hasPasswordField: boolean
  submitButton?: { key: string; text: string }
  nextButton?: { key: string; text: string }
  applyButton?: { key: string; text: string }
  validationErrors: string[]
  pageText: string
}

/** Browser-side script (plain JS so it is independent of the Node build's lib settings). */
export const INSPECT_SCRIPT = `(() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').replace(/\\s*\\*\\s*$/, ' *').trim();
  const visible = (el) => {
    if (!el || !el.getClientRects || el.getClientRects().length === 0) {
      // File inputs are often visually hidden behind a styled button.
      return el && el.type === 'file';
    }
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  };
  const textOf = (id) => { const n = id && document.getElementById(id); return n ? clean(n.innerText || n.textContent) : ''; };
  const labelFor = (el) => {
    let t = '';
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) t = clean(l.innerText || l.textContent); }
    if (!t) { const l = el.closest('label'); if (l) t = clean(l.innerText || l.textContent); }
    if (!t && el.getAttribute('aria-labelledby')) t = el.getAttribute('aria-labelledby').split(/\\s+/).map(textOf).join(' ');
    if (!t && el.getAttribute('aria-label')) t = clean(el.getAttribute('aria-label'));
    if (!t) { const fs = el.closest('fieldset'); const lg = fs && fs.querySelector('legend'); if (lg) t = clean(lg.innerText); }
    if (!t) {
      // Closest preceding text within the same field container.
      let c = el.parentElement; let depth = 0;
      while (c && depth < 4 && !t) {
        const cand = Array.from(c.querySelectorAll('label, legend, .label, .field-label, [class*="label"], [class*="Label"], h3, h4, p, span, div'))
          .filter((n) => !n.contains(el) && n.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
          .map((n) => clean(n.innerText || n.textContent)).filter((s) => s && s.length < 200);
        if (cand.length) t = cand[cand.length - 1];
        c = c.parentElement; depth++;
      }
    }
    if (!t && el.placeholder) t = clean(el.placeholder);
    if (!t && el.name) t = el.name.replace(/[_\\[\\]-]+/g, ' ').trim();
    return t.slice(0, 250);
  };
  const isRequired = (el, label) => el.required || el.getAttribute('aria-required') === 'true' || /\\*\\s*$/.test(label) || /\\(required\\)/i.test(label);
  let counter = 0;
  const fields = [];
  const groups = new Map();
  const els = Array.from(document.querySelectorAll('input, select, textarea'));
  for (const el of els) {
    const type = (el.getAttribute('type') || el.tagName).toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image', 'search', 'password'].includes(type)) continue;
    if (el.disabled || el.readOnly && type !== 'file') continue;
    if (!visible(el)) continue;
    if (el.closest('[aria-hidden="true"]') && type !== 'file') continue;
    if (type === 'radio' || (type === 'checkbox' && el.name && document.querySelectorAll('input[type="checkbox"][name="' + CSS.escape(el.name) + '"]').length > 1)) {
      const gkey = type + ':' + (el.name || el.id);
      let g = groups.get(gkey);
      if (!g) {
        const key = 'f' + (counter++);
        const fs = el.closest('fieldset, [role="radiogroup"], [role="group"]');
        let label = '';
        if (fs) { const lg = fs.querySelector('legend, [id$="label"], label'); label = lg ? clean(lg.innerText) : clean(fs.getAttribute('aria-label')); }
        if (!label) label = labelFor(el.closest('div') || el);
        g = { key, kind: type === 'radio' ? 'radio' : 'checkbox-group', label, name: el.name || '', id: el.id || '', required: false, filled: false, value: '', options: [], invalid: false, frameIndex: 0 };
        groups.set(gkey, g); fields.push(g);
      }
      const optLabel = labelFor(el) || el.value;
      el.setAttribute('data-pa-field', g.key); el.setAttribute('data-pa-option', String(g.options.length));
      g.options.push({ label: optLabel, value: el.value, index: g.options.length });
      if (el.required || el.getAttribute('aria-required') === 'true') g.required = true;
      if (el.checked) { g.filled = true; g.value = g.value ? g.value + ', ' + optLabel : optLabel; }
      if (el.getAttribute('aria-invalid') === 'true') g.invalid = true;
      continue;
    }
    const key = 'f' + (counter++);
    el.setAttribute('data-pa-field', key);
    const label = labelFor(el);
    const kind = el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : ['email', 'tel', 'url', 'number', 'date', 'checkbox', 'file'].includes(type) ? type : 'text';
    const f = { key, kind, label, name: el.name || '', id: el.id || '', required: isRequired(el, label), filled: false, value: '', options: [], invalid: el.getAttribute('aria-invalid') === 'true', frameIndex: 0 };
    if (kind === 'select') {
      f.options = Array.from(el.options).map((o, i) => ({ label: clean(o.textContent), value: o.value, index: i })).filter((o) => o.label);
      const sel = el.options[el.selectedIndex];
      f.filled = !!(sel && sel.value && !/^(select|choose|please|--)/i.test(clean(sel.textContent)));
      f.value = f.filled ? clean(sel.textContent) : '';
    } else if (kind === 'checkbox') {
      f.filled = el.checked; f.value = el.checked ? 'checked' : '';
    } else if (kind === 'file') {
      f.accept = el.getAttribute('accept') || ''; f.multiple = el.multiple; f.filled = !!(el.files && el.files.length); f.value = f.filled ? el.files[0].name : '';
    } else {
      f.value = (el.value || '').slice(0, 200); f.filled = !!f.value.trim();
    }
    fields.push(f);
  }
  const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a[role="button"], a.button, a[class*="apply"], a[class*="Apply"]')).filter(visible);
  const pick = (re) => {
    const b = buttons.find((x) => re.test(clean(x.innerText || x.value || x.getAttribute('aria-label'))));
    if (!b) return undefined;
    const key = 'b' + (counter++);
    b.setAttribute('data-pa-button', key);
    return { key, text: clean(b.innerText || b.value || b.getAttribute('aria-label')).slice(0, 80) };
  };
  const submitButton = pick(/^(submit( application| my application)?|send( application)?|apply now|complete application|finish)$/i) || pick(/submit/i);
  const nextButton = pick(/^(next|continue|save (and|&) continue|next step|proceed)/i);
  const applyButton = pick(/^(apply( for this job| now| to this job)?|i'?m interested|start (your )?application)$/i);
  const hasCaptcha = !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="arkoselabs"], iframe[src*="funcaptcha"], .g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]');
  const hasPasswordField = Array.from(document.querySelectorAll('input[type="password"]')).some(visible);
  const validationErrors = Array.from(document.querySelectorAll('[role="alert"], .error, .errors, .field-error, .invalid-feedback, [class*="error-message"], [class*="errorMessage"]'))
    .filter(visible).map((n) => clean(n.innerText)).filter((s) => s && s.length < 300).slice(0, 10);
  return { url: location.href, title: document.title, fields, hasCaptcha, hasPasswordField, submitButton, nextButton, applyButton, validationErrors, pageText: clean(document.body ? document.body.innerText : '').slice(0, 20000) };
})()`

async function inspectFrame(frame: Frame, frameIndex: number): Promise<FormInspection | null> {
  try {
    const res = (await frame.evaluate(INSPECT_SCRIPT)) as FormInspection
    res.fields.forEach((f) => (f.frameIndex = frameIndex))
    return res
  } catch {
    return null
  }
}

/**
 * Inspects the main frame plus same-origin or ATS iframes (employers often
 * embed a Greenhouse/Lever form in their own careers page).
 */
export async function inspectPage(page: Page): Promise<FormInspection> {
  const main = (await inspectFrame(page.mainFrame(), 0))!
  const frames = page.frames().slice(1, 6)
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    if (!/greenhouse|lever|ashby|smartrecruiters|apply|career|job/i.test(f.url())) continue
    const sub = await inspectFrame(f, i + 1)
    if (!sub || sub.fields.length === 0) continue
    main.fields.push(...sub.fields.map((x) => ({ ...x, key: `${i + 1}:${x.key}` })))
    main.hasCaptcha ||= sub.hasCaptcha
    main.submitButton ??= sub.submitButton && { ...sub.submitButton, key: `${i + 1}:${sub.submitButton.key}` }
    main.validationErrors.push(...sub.validationErrors)
  }
  return main
}

export function frameFor(page: Page, key: string): { frame: Frame; localKey: string } {
  const m = /^(\d+):(.*)$/.exec(key)
  if (!m) return { frame: page.mainFrame(), localKey: key }
  return { frame: page.frames()[Number(m[1])] ?? page.mainFrame(), localKey: m[2] }
}
