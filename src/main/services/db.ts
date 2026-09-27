import { app } from 'electron'
import fs from 'fs'
import { join } from 'path'
import { ParsedProfile } from './parser'

export interface CandidateInfo {
  fullName: string
  email: string
  phone: string
  location: string
  linkedinUrl: string
  githubUrl: string
  portfolioUrl: string
  workAuthorization: 'US Citizen' | 'Permanent Resident' | 'Need Sponsorship'
  resumeFilePath?: string
}

export interface JobRecord {
  id: string
  title: string
  company: string
  location: string
  source: 'Indeed' | 'LinkedIn' | 'ZipRecruiter'
  url: string
  salary?: string
  description: string
  requiredSkills: string[]
  matchScore: number
  matchedSkills: string[]
  missingSkills: string[]
  discoveredAt: string
  status: 'queued' | 'in_progress' | 'awaiting_review' | 'applied' | 'dismissed'
}

export interface AppDatabase {
  profile: ParsedProfile | null
  candidate: CandidateInfo
  settings: {
    minScoreThreshold: number
    cronIntervalHours: number
    targetRoles: string[]
    targetLocation: string
    hitlApprovalRequired: boolean
  }
  jobs: JobRecord[]
}

const DB_FILE = join(app.getPath('userData'), 'pulseapply_db.json')

const DEFAULT_DB: AppDatabase = {
  profile: null,
  candidate: {
    fullName: '',
    email: '',
    phone: '',
    location: '',
    linkedinUrl: '',
    githubUrl: '',
    portfolioUrl: '',
    workAuthorization: 'US Citizen'
  },
  settings: {
    minScoreThreshold: 75,
    cronIntervalHours: 3,
    targetRoles: ['Full Stack Developer', 'Software Engineer', 'Frontend Developer'],
    targetLocation: 'Remote',
    hitlApprovalRequired: true
  },
  jobs: []
}

export function loadDatabase(): AppDatabase {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), 'utf-8')
      return DEFAULT_DB
    }
    const data = fs.readFileSync(DB_FILE, 'utf-8')
    return { ...DEFAULT_DB, ...JSON.parse(data) }
  } catch (error) {
    console.error('Failed reading database:', error)
    return DEFAULT_DB
  }
}

export function saveDatabase(db: AppDatabase): void {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8')
  } catch (error) {
    console.error('Failed writing database:', error)
  }
}
