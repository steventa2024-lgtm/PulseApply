import { useState, useEffect } from 'react'
import {
  FileText,
  Sliders,
  Sparkles,
  Clock,
  Briefcase,
  Zap,
  ArrowUpRight,
  Layers,
  UploadCloud,
  CheckCircle,
  FileCheck2,
  User,
  ShieldAlert,
  Send,
  XCircle,
  FileUp,
  Loader2
} from 'lucide-react'

export default function App() {
  const [activeTab, setActiveTab] = useState<'matches' | 'resume' | 'candidate' | 'rules'>('matches')
  const [profile, setProfile] = useState<any>(null)
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const [candidate, setCandidate] = useState({
    fullName: '',
    email: '',
    phone: '',
    location: '',
    linkedinUrl: '',
    githubUrl: '',
    portfolioUrl: '',
    workAuthorization: 'US Citizen'
  })

  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [autofillLog, setAutofillLog] = useState<{ step: string; message: string } | null>(null)

  useEffect(() => {
    if (window.api?.getDatabase) {
      window.api.getDatabase().then((db) => {
        if (db) {
          setProfile(db.profile)
          setJobs(db.jobs || [])
          if (db.candidate) setCandidate(db.candidate)
        }
      })
    }

    if (window.api?.onDatabaseSync) {
      window.api.onDatabaseSync((db) => {
        if (db) {
          setProfile(db.profile)
          setJobs(db.jobs || [])
          if (db.candidate) setCandidate(db.candidate)
        }
      })
    }

    if (window.api?.onPipelineUpdated) {
      window.api.onPipelineUpdated((updatedJobs) => {
        setJobs(updatedJobs)
        setLoading(false)
      })
    }

    if (window.api?.onAutofillStatus) {
      window.api.onAutofillStatus((status) => {
        setAutofillLog(status)
        if (status.step === 'COMPLETED') setActiveJobId(null)
      })
    }
  }, [])

  const processIncomingFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      alert('Please upload a PDF document.')
      return
    }

    setLoading(true)
    try {
      let result: any = null
      const nativePath = window.api?.getPathForFile ? window.api.getPathForFile(file) : (file as any).path

      if (nativePath && window.api?.parseResumePath) {
        result = await window.api.parseResumePath(nativePath)
      } else {
        const reader = new FileReader()
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = () => resolve((reader.result as string).split(',')[1])
          reader.readAsDataURL(file)
        })
        const base64 = await base64Promise
        result = await window.api.parseResumeBase64(file.name, base64)
      }

      if (result?.success && result.profile) {
        setProfile(result.profile)
        if (result.candidate) setCandidate(result.candidate)
        const updated = await window.api.forceRunScraper()
        setJobs(updated)
      } else if (result?.error) {
        alert(`Parsing error: ${result.error}`)
      }
    } catch (err: any) {
      alert(`Error reading file: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleNativePicker = async () => {
    if (!window.api?.selectAndParseResume) return
    setLoading(true)
    const result = await window.api.selectAndParseResume()
    setLoading(false)
    if (result.success && result.profile) {
      setProfile(result.profile)
      if (result.candidate) setCandidate(result.candidate)
      const updated = await window.api.forceRunScraper()
      setJobs(updated)
    }
  }

  const handleSaveCandidate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (window.api?.saveCandidate) {
      await window.api.saveCandidate(candidate as any)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2500)
    }
  }

  const handleStartAutofill = async (jobId: string) => {
    setActiveJobId(jobId)
    setAutofillLog({ step: 'INITIALIZING', message: 'Launching active browser session...' })
    if (window.api?.startAutofill) {
      await window.api.startAutofill(jobId)
    }
  }

  const handleConfirmSubmit = async () => {
    if (!activeJobId || !window.api?.confirmSubmission) return
    await window.api.confirmSubmission(activeJobId)
    setJobs((prev) =>
      prev.map((j) => (j.id === activeJobId ? { ...j, status: 'applied' } : j))
    )
    setActiveJobId(null)
    setAutofillLog(null)
  }

  const handleCancelAutofill = async () => {
    if (window.api?.cancelAutofill) {
      await window.api.cancelAutofill()
    }
    setActiveJobId(null)
    setAutofillLog(null)
  }

  const activeJob = jobs.find((j) => j.id === activeJobId)

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-[#090d16] font-sans text-slate-100 select-none">
      <div className="pointer-events-none absolute -top-32 -left-32 h-[420px] w-[420px] rounded-full bg-cyan-500/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/3 -right-32 h-[480px] w-[480px] rounded-full bg-indigo-500/10 blur-[140px]" />

      <header className="relative z-10 flex h-10 w-full items-center justify-between border-b border-white/[0.06] bg-slate-950/40 px-4 backdrop-blur-2xl">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-300">
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-cyan-400 to-blue-600 shadow-[0_0_12px_rgba(6,182,212,0.4)]">
              <Zap className="h-3 w-3 text-slate-950" />
            </div>
            <span>PulseApply</span>
            <span className="text-[10px] text-slate-500 font-mono">v1.0.0</span>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            <span className="font-medium tracking-tight">
              {profile ? 'PROFILE ACTIVE' : 'AWAITING RESUME'}
            </span>
          </div>
        </div>

        <div className="w-36 pointer-events-none" />
      </header>

      <div className="relative z-10 flex flex-1 overflow-hidden">
        <aside className="flex w-64 flex-col justify-between border-r border-white/[0.06] bg-slate-950/50 p-4 backdrop-blur-2xl">
          <div className="space-y-6">
            <div>
              <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Workspace
              </p>
              <nav className="mt-2 space-y-1.5">
                <button
                  onClick={() => setActiveTab('matches')}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs font-medium transition-all ${
                    activeTab === 'matches'
                      ? 'border border-cyan-500/30 bg-gradient-to-r from-cyan-500/15 via-sky-500/10 to-transparent text-cyan-300'
                      : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Layers className="h-4 w-4" />
                    <span>Top Matches</span>
                  </div>
                  <span className="rounded-full bg-cyan-500/20 px-1.5 py-0.2 text-[10px] font-semibold text-cyan-300">
                    {jobs.length}
                  </span>
                </button>

                <button
                  onClick={() => setActiveTab('resume')}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-all ${
                    activeTab === 'resume'
                      ? 'border border-cyan-500/30 bg-gradient-to-r from-cyan-500/15 to-transparent text-cyan-300'
                      : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-200'
                  }`}
                >
                  <FileText className="h-4 w-4" />
                  <span>Master Resume</span>
                  {profile && <CheckCircle className="ml-auto h-3.5 w-3.5 text-cyan-400" />}
                </button>

                <button
                  onClick={() => setActiveTab('candidate')}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-all ${
                    activeTab === 'candidate'
                      ? 'border border-cyan-500/30 bg-gradient-to-r from-cyan-500/15 to-transparent text-cyan-300'
                      : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-200'
                  }`}
                >
                  <User className="h-4 w-4" />
                  <span>Candidate Profile</span>
                  {candidate.fullName && <CheckCircle className="ml-auto h-3.5 w-3.5 text-cyan-400" />}
                </button>

                <button
                  onClick={() => setActiveTab('rules')}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-all ${
                    activeTab === 'rules'
                      ? 'border border-cyan-500/30 bg-gradient-to-r from-cyan-500/15 to-transparent text-cyan-300'
                      : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-200'
                  }`}
                >
                  <Sliders className="h-4 w-4" />
                  <span>Match Criteria</span>
                </button>
              </nav>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3.5 backdrop-blur-md">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-cyan-400" /> 3h Cron Runner
              </span>
              <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#38bdf8]" />
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-200">Next Triage in 02h 59m</p>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto p-8 relative">
          {activeJob && autofillLog && (
            <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 backdrop-blur-xl">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-amber-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                      Human-In-The-Loop Agent Active
                    </span>
                  </div>
                  <h3 className="text-base font-semibold text-white">
                    Applying to {activeJob.title} at {activeJob.company}
                  </h3>
                  <p className="text-xs text-amber-200/80 font-mono mt-1">{autofillLog.message}</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCancelAutofill}
                    className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Abort
                  </button>

                  {autofillLog.step === 'AWAITING_HUMAN_REVIEW' && (
                    <button
                      onClick={handleConfirmSubmit}
                      className="flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-1.5 text-xs font-semibold text-slate-950 shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:brightness-110"
                    >
                      <Send className="h-3.5 w-3.5" /> Accept & Mark Submitted
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'matches' && (
            <div className="space-y-6 max-w-5xl mx-auto">
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-5">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                    Top Triaged Matches
                    <Sparkles className="h-5 w-5 text-cyan-400" />
                  </h1>
                  <p className="mt-1 text-xs text-slate-400">
                    Scored against your resume's operations experience and certified skills.
                  </p>
                </div>

                <button
                  onClick={async () => {
                    setLoading(true)
                    const updated = await window.api.forceRunScraper()
                    setJobs(updated)
                    setLoading(false)
                  }}
                  disabled={loading || !profile}
                  className="flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-xs font-semibold text-slate-950 shadow-[0_0_20px_rgba(6,182,212,0.35)] hover:brightness-110 transition disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 fill-current" />}
                  {loading ? 'Rescanning Pipeline...' : 'Force Rescan'}
                </button>
              </div>

              {jobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 p-12 text-center">
                  <Briefcase className="h-8 w-8 text-slate-600 mb-2" />
                  <p className="text-sm font-medium text-slate-400">No vacancies currently in queue</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm">
                    Upload your resume on the Master Resume tab to trigger automatic pipeline scoring.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3.5">
                  {jobs.map((job) => (
                    <div
                      key={job.id}
                      className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 backdrop-blur-xl transition hover:border-cyan-500/40 hover:bg-white/[0.04]"
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2.5">
                            <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase text-slate-300">
                              {job.source}
                            </span>
                            {job.status === 'applied' && (
                              <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                                Applied
                              </span>
                            )}
                            {job.salary && (
                              <span className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-0.5 text-[10px] font-medium text-slate-300">
                                {job.salary}
                              </span>
                            )}
                          </div>

                          <h2 className="text-base font-semibold text-white group-hover:text-cyan-300 transition-colors">
                            {job.title}
                          </h2>

                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <Briefcase className="h-3.5 w-3.5 text-slate-500" />
                            <span>{job.company}</span>
                            <span>•</span>
                            <span>{job.location}</span>
                          </div>
                        </div>

                        <div className="flex flex-col items-end">
                          <div className="flex items-baseline gap-1 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-1.5 backdrop-blur-md">
                            <span className="text-lg font-black text-cyan-400 font-mono">
                              {job.matchScore}
                            </span>
                            <span className="text-[10px] font-semibold text-cyan-400">%</span>
                          </div>
                          <span className="mt-1 text-[10px] font-medium text-slate-400">Semantic Fit</span>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t border-white/[0.05] pt-3.5">
                        <div className="flex flex-wrap gap-1.5">
                          {job.matchedSkills?.map((skill: string) => (
                            <span
                              key={skill}
                              className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-1 text-[11px] text-slate-300"
                            >
                              {skill}
                            </span>
                          ))}
                        </div>

                        <button
                          onClick={() => handleStartAutofill(job.id)}
                          disabled={job.status === 'applied' || activeJobId !== null}
                          className="flex items-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/15 px-3.5 py-1.5 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-500/25 disabled:opacity-40"
                        >
                          <span>{job.status === 'applied' ? 'Submitted' : 'Initiate Autofill'}</span>
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'resume' && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">Master Resume Vector</h1>
                <p className="mt-1 text-xs text-slate-400">
                  Drag and drop your PDF resume directly into the vector dropzone or click to browse.
                </p>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setIsDragging(true)
                }}
                onDragLeave={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setIsDragging(false)
                }}
                className={`relative flex flex-col items-center justify-center rounded-3xl border-2 border-dashed p-12 text-center backdrop-blur-xl transition-all duration-200 cursor-pointer overflow-hidden ${
                  isDragging
                    ? 'border-cyan-400 bg-cyan-500/15 shadow-[0_0_40px_rgba(6,182,212,0.3)] scale-[1.01]'
                    : 'border-white/10 bg-white/[0.01] hover:border-cyan-500/40 hover:bg-white/[0.02]'
                }`}
              >
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="absolute inset-0 h-full w-full opacity-0 cursor-pointer z-20"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) processIncomingFile(file)
                    e.target.value = ''
                  }}
                  onDrop={(e) => {
                    setIsDragging(false)
                    const file = e.dataTransfer?.files?.[0]
                    if (file) {
                      e.preventDefault()
                      processIncomingFile(file)
                    }
                  }}
                />

                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10 pointer-events-none">
                  {loading ? (
                    <Loader2 className="h-8 w-8 text-cyan-300 animate-spin" />
                  ) : isDragging ? (
                    <FileUp className="h-8 w-8 text-cyan-300 animate-bounce" />
                  ) : (
                    <UploadCloud className="h-8 w-8 text-cyan-400" />
                  )}
                </div>

                <h3 className="mt-4 text-sm font-semibold text-white pointer-events-none">
                  {loading ? 'Extracting Resume Schema...' : isDragging ? 'Drop your PDF here' : 'Drag & drop master resume here'}
                </h3>
                <p className="mt-1 text-xs text-slate-400 pointer-events-none">
                  or click anywhere inside this box to browse
                </p>

                <div className="mt-5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleNativePicker()
                    }}
                    disabled={loading}
                    className="relative z-30 rounded-xl border border-cyan-500/40 bg-cyan-500/20 px-5 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/30 transition shadow-[0_0_15px_rgba(6,182,212,0.15)] disabled:opacity-50"
                  >
                    Open File Dialog
                  </button>
                </div>
              </div>

              {profile && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-5 backdrop-blur-xl">
                    <div className="flex items-center gap-3.5">
                      <FileCheck2 className="h-6 w-6 text-cyan-300" />
                      <div>
                        <h3 className="text-sm font-semibold text-white">{profile.fileName}</h3>
                        <p className="text-xs text-slate-400">{profile.wordCount} words indexed & ready</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1">
                      Active
                    </span>
                  </div>

                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 backdrop-blur-xl">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                      Indexed Skills ({profile.extractedSkills?.length || 0})
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {profile.extractedSkills?.map((skill: string) => (
                        <span
                          key={skill}
                          className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-300"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'candidate' && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-white">Candidate Details</h1>
                  <p className="mt-1 text-xs text-slate-400">
                    Contact information extracted from your resume and used during form autofill.
                  </p>
                </div>
                {saveSuccess && (
                  <span className="text-xs text-emerald-400 font-semibold bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 rounded-lg">
                    Changes Saved!
                  </span>
                )}
              </div>

              <form onSubmit={handleSaveCandidate} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-slate-300">Full Name</label>
                    <input
                      type="text"
                      value={candidate.fullName}
                      onChange={(e) => setCandidate({ ...candidate, fullName: e.target.value })}
                      className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-xs text-white focus:border-cyan-400 outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-slate-300">Email Address</label>
                    <input
                      type="email"
                      value={candidate.email}
                      onChange={(e) => setCandidate({ ...candidate, email: e.target.value })}
                      className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-xs text-white focus:border-cyan-400 outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-slate-300">Phone</label>
                    <input
                      type="text"
                      value={candidate.phone}
                      onChange={(e) => setCandidate({ ...candidate, phone: e.target.value })}
                      className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-xs text-white focus:border-cyan-400 outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-slate-300">Location</label>
                    <input
                      type="text"
                      value={candidate.location}
                      onChange={(e) => setCandidate({ ...candidate, location: e.target.value })}
                      className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-xs text-white focus:border-cyan-400 outline-none"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="text-xs font-medium text-slate-300">LinkedIn URL</label>
                    <input
                      type="text"
                      value={candidate.linkedinUrl}
                      placeholder="https://linkedin.com/in/..."
                      onChange={(e) => setCandidate({ ...candidate, linkedinUrl: e.target.value })}
                      className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-xs text-white focus:border-cyan-400 outline-none"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="rounded-xl border border-cyan-500/40 bg-cyan-500/20 px-5 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/30 transition mt-2"
                >
                  Save Profile Information
                </button>
              </form>
            </div>
          )}

          {activeTab === 'rules' && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">Match Criteria & Filters</h1>
                <p className="mt-1 text-xs text-slate-400">Control scraping thresholds and scheduling rules.</p>
              </div>

              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">Human-in-the-Loop Gate</p>
                    <p className="text-xs text-slate-400">Stop before final submission for human review</p>
                  </div>
                  <span className="font-mono text-xs text-cyan-400 font-semibold">Active & Mandatory</span>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
