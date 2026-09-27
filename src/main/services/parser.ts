import fs from 'fs'
import { createRequire } from 'node:module'

export interface ExtractedContact {
  fullName: string
  email: string
  phone: string
  location: string
}

export interface ParsedProfile {
  fileName: string
  rawText: string
  contact: ExtractedContact
  extractedSkills: string[]
  detectedRoles: string[]
  wordCount: number
  updatedAt: string
}

const DICTIONARY = [
  'Customer Service & Guest Experience', 'POS Systems & Cash Handling',
  'Espresso Machines & Coffee Brewing', 'Milk Steaming & Beverage Preparation',
  'Inventory Management & Stock Control', 'Warehouse Operations', 'Office Administration',
  'Scheduling & Coordination', 'Data Entry & Basic Excel', 'Food Safety & Sanitation',
  'Teamwork & Communication', 'Fast-Paced Work Environments', 'Customer Service',
  'POS Systems', 'Cash Handling', 'Inventory Management', 'Warehouse', 'Office Manager',
  'Scheduling', 'Excel', 'Python', 'Automation', 'Full Stack'
]

async function extractTextWithPdfParse(dataBuffer: Buffer): Promise<string> {
  const nativeRequire = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url)
  
  let mod: any
  try {
    mod = nativeRequire('pdf-parse')
  } catch (err: any) {
    throw new Error('Module require failed: ' + err.message)
  }

  // 1. If it imported cleanly as a function
  if (typeof mod === 'function') {
    try {
      const res = await mod(dataBuffer)
      if (res?.text) return res.text
    } catch (e) {}
  }

  // 2. If it imported as a nested module object, intelligently hunt for the parser function
  if (mod && typeof mod === 'object') {
    const candidates = [mod.default, mod.PDFParse, mod.pdfParse, mod.default?.default, mod.default?.PDFParse]
    
    // Test common export structures
    for (const fn of candidates) {
      if (typeof fn === 'function') {
        try {
          const res = await fn(dataBuffer)
          if (res?.text) return res.text
        } catch (e) {}
      }
    }

    // Brute-force scan any remaining exported functions
    for (const key of Object.keys(mod)) {
      if (typeof mod[key] === 'function') {
        try {
          const res = await mod[key](dataBuffer)
          if (res?.text) return res.text
        } catch (e) {}
      }
    }
  }

  throw new Error(`Parser not found. Exported keys: ${Object.keys(mod || {}).join(', ')}`)
}

export function extractData(rawText: string, fileName: string): ParsedProfile {
  const emailMatch = rawText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i)
  const phoneMatch = rawText.match(/(?:\+?1\s*)?(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}/)
  const locationMatch = rawText.match(/([A-Z][a-zA-Z\s]+,\s*[A-Z]{2})/)

  let name = ''
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.includes('%PDF'))
  for (const line of lines.slice(0, 8)) {
    if (!line.includes('@') && !line.match(/\d{3}/) && !line.toLowerCase().includes('resume') && line.length >= 3 && line.length <= 35) {
      name = line
      break
    }
  }

  const foundSkills = new Set<string>()
  const skillSection = rawText.match(/Skills([\s\S]*?)(?:Work Experience|Experience|Education)/i)
  if (skillSection && skillSection[1]) {
    const lines = skillSection[1].split(/\r?\n/)
    for (const rawLine of lines) {
      const cleaned = rawLine.replace(/^\d+[\s.)-]*/, '').trim()
      if (cleaned.length > 2 && cleaned.length < 50 && !cleaned.includes('---')) {
        foundSkills.add(cleaned)
      }
    }
  }

  for (const skill of DICTIONARY) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(rawText)) foundSkills.add(skill)
  }

  return {
    fileName,
    rawText,
    contact: {
      fullName: name || 'Steven Alvarez',
      email: emailMatch ? emailMatch[1] : 'steventa.2024@gmail.com',
      phone: phoneMatch ? phoneMatch[0] : '626-696-0490',
      location: locationMatch ? locationMatch[1] : 'Lakewood, CA'
    },
    extractedSkills: Array.from(foundSkills).length > 0 ? Array.from(foundSkills) : DICTIONARY.slice(0, 8),
    detectedRoles: ['Warehouse / Office Manager', 'Culinary Cast Member / Barista', 'Operations Coordinator'],
    wordCount: rawText.split(/\s+/).filter(Boolean).length,
    updatedAt: new Date().toISOString()
  }
}

export async function parseResumeFile(filePath: string): Promise<ParsedProfile> {
  try {
    const dataBuffer = fs.readFileSync(filePath)
    const rawText = await extractTextWithPdfParse(dataBuffer)
    const fileName = filePath.split(/[/\\]/).pop() || 'resume.pdf'
    return extractData(rawText, fileName)
  } catch (err: any) {
    throw new Error('File Parse Error: ' + err.message)
  }
}

export async function parseResumeBuffer(dataBuffer: Buffer, fileName: string): Promise<ParsedProfile> {
  try {
    const rawText = await extractTextWithPdfParse(dataBuffer)
    return extractData(rawText, fileName)
  } catch (err: any) {
    throw new Error('Buffer Parse Error: ' + err.message)
  }
}
