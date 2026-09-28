import path from 'path'
import { log } from '../logger'

export type ResumeFormat = 'pdf' | 'docx' | 'txt'

export interface ExtractedText {
  text: string
  format: ResumeFormat
  pages?: number
  needsOcr: boolean
  ocrUsed: boolean
  warnings: string[]
}

export const MAX_RESUME_BYTES = 15 * 1024 * 1024

export function detectFormat(fileName: string, data: Buffer): ResumeFormat | null {
  const ext = path.extname(fileName).toLowerCase()
  if (data.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf'
  if (data[0] === 0x50 && data[1] === 0x4b && ext === '.docx') return 'docx'
  if (ext === '.txt' || ext === '.md') return 'txt'
  if (ext === '.pdf') return 'pdf'
  if (ext === '.docx') return 'docx'
  return null
}

async function pdfText(data: Buffer): Promise<{ text: string; pages: number }> {
  // pdf-parse v2 API: new PDFParse({ data }).getText()
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(data) })
  try {
    const result = await parser.getText()
    const text = result.text.replace(/\n*-- \d+ of \d+ --\n*/g, '\n').trim()
    return { text, pages: result.total }
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}

/**
 * Optional OCR for image-only PDFs. Requires the optional `tesseract.js`
 * package (not bundled). Returns null when OCR is unavailable.
 */
async function tryOcr(data: Buffer, warnings: string[]): Promise<string | null> {
  let tesseract: { recognize: (img: Buffer, lang: string) => Promise<{ data: { text: string } }> }
  try {
    const modName = 'tesseract.js'
    tesseract = (await import(/* @vite-ignore */ modName)) as never
  } catch {
    warnings.push(
      'This PDF appears to be scanned (no selectable text). Optional OCR is not installed: run `npm install tesseract.js` and re-upload, or upload a DOCX / text-based PDF.'
    )
    return null
  }
  try {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(data) })
    const shots = await parser.getScreenshot({ imageBuffer: true, scale: 2 } as never)
    await parser.destroy().catch(() => undefined)
    const texts: string[] = []
    for (const page of (shots as unknown as { pages: { data: Uint8Array }[] }).pages.slice(0, 5)) {
      const res = await tesseract.recognize(Buffer.from(page.data), 'eng')
      texts.push(res.data.text)
    }
    warnings.push('Text was recognised with OCR; please review every extracted field carefully.')
    return texts.join('\n')
  } catch (err) {
    log.warn('resume', `OCR failed: ${(err as Error).message}`)
    warnings.push(
      `OCR failed (${(err as Error).message}). Upload a DOCX or text-based PDF instead.`
    )
    return null
  }
}

export async function extractResumeText(fileName: string, data: Buffer): Promise<ExtractedText> {
  if (data.length > MAX_RESUME_BYTES) throw new Error('Resume file is larger than 15 MB')
  const format = detectFormat(fileName, data)
  if (!format) throw new Error('Unsupported file type. Upload a PDF, DOCX or TXT resume.')
  const warnings: string[] = []
  if (format === 'txt') {
    return {
      text: data.toString('utf8').replace(/^\uFEFF/, ''),
      format,
      needsOcr: false,
      ocrUsed: false,
      warnings
    }
  }
  if (format === 'docx') {
    const mammoth = await import('mammoth')
    const res = await mammoth.extractRawText({ buffer: data })
    for (const m of res.messages ?? []) if (m.type === 'error') warnings.push(m.message)
    return {
      text: res.value.replace(/\n{3,}/g, '\n\n').trim(),
      format,
      needsOcr: false,
      ocrUsed: false,
      warnings
    }
  }
  const { text, pages } = await pdfText(data)
  const meaningful = text.replace(/\s+/g, '').length
  if (meaningful < 40 * Math.max(1, Math.min(pages, 3))) {
    const ocr = await tryOcr(data, warnings)
    if (ocr) return { text: ocr, format, pages, needsOcr: false, ocrUsed: true, warnings }
    return { text, format, pages, needsOcr: true, ocrUsed: false, warnings }
  }
  return { text, format, pages, needsOcr: false, ocrUsed: false, warnings }
}
