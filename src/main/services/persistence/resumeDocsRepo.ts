import type {
  ResumeDocument,
  ResumeDocumentSummary,
  ResumeVersionInfo
} from '../../../shared/resume'
import type { AppDb } from './database'
import { json } from './database'

const MAX_VERSIONS = 50

/** Resume documents edited in the Resume Helper, with a version history per document. */
export class ResumeDocsRepo {
  constructor(private readonly db: AppDb) {}

  list(): ResumeDocumentSummary[] {
    return this.db
      .all<{ data: string; resume_id: string | null; is_master: number; version: number }>(
        'SELECT data, resume_id, is_master, version FROM resume_documents ORDER BY updated_at DESC'
      )
      .map((r) => {
        const d = json<ResumeDocument>(r.data, {} as ResumeDocument)
        return {
          id: d.id,
          name: d.name,
          template: d.template,
          version: r.version,
          isMaster: !!r.is_master,
          origin: d.origin,
          updatedAt: d.updatedAt,
          resumeId: r.resume_id ?? undefined
        }
      })
  }

  get(id: string): ResumeDocument | undefined {
    const r = this.db.get<{ data: string; is_master: number; version: number }>(
      'SELECT data, is_master, version FROM resume_documents WHERE id = ?',
      [id]
    )
    if (!r) return undefined
    const d = json<ResumeDocument>(r.data, {} as ResumeDocument)
    return { ...d, isMaster: !!r.is_master, version: r.version }
  }

  /** Saves a new version (the previous content stays in the history). */
  save(doc: ResumeDocument, note?: string): ResumeDocument {
    const now = new Date().toISOString()
    return this.db.transaction(() => {
      const prev = this.db.get<{ version: number; is_master: number }>(
        'SELECT version, is_master FROM resume_documents WHERE id = ?',
        [doc.id]
      )
      const version = (prev?.version ?? 0) + 1
      const saved: ResumeDocument = {
        ...doc,
        version,
        isMaster: !!prev?.is_master,
        createdAt: doc.createdAt || now,
        updatedAt: now
      }
      const data = JSON.stringify(saved)
      if (prev) {
        this.db.run(
          'UPDATE resume_documents SET name = ?, data = ?, version = ?, updated_at = ? WHERE id = ?',
          [saved.name, data, version, now, doc.id]
        )
      } else {
        this.db.run(
          'INSERT INTO resume_documents (id, name, data, version, is_master, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
          [doc.id, saved.name, data, version, saved.createdAt, now]
        )
      }
      this.db.run(
        'INSERT INTO resume_document_versions (document_id, version, data, note, created_at) VALUES (?, ?, ?, ?, ?)',
        [doc.id, version, data, note ?? null, now]
      )
      this.db.run('DELETE FROM resume_document_versions WHERE document_id = ? AND version <= ?', [
        doc.id,
        version - MAX_VERSIONS
      ])
      return saved
    })
  }

  versions(id: string): ResumeVersionInfo[] {
    return this.db
      .all<{ version: number; note: string | null; created_at: string }>(
        'SELECT version, note, created_at FROM resume_document_versions WHERE document_id = ? ORDER BY version DESC',
        [id]
      )
      .map((r) => ({ version: r.version, note: r.note ?? undefined, createdAt: r.created_at }))
  }

  version(id: string, version: number): ResumeDocument | undefined {
    const r = this.db.get<{ data: string }>(
      'SELECT data FROM resume_document_versions WHERE document_id = ? AND version = ?',
      [id, version]
    )
    return r ? json<ResumeDocument>(r.data, {} as ResumeDocument) : undefined
  }

  delete(id: string): void {
    this.db.run('DELETE FROM resume_documents WHERE id = ?', [id])
  }

  setMaster(id: string, resumeId: string): void {
    this.db.transaction(() => {
      this.db.run('UPDATE resume_documents SET is_master = 0')
      this.db.run('UPDATE resume_documents SET is_master = 1, resume_id = ? WHERE id = ?', [
        resumeId,
        id
      ])
    })
  }

  master(): ResumeDocument | undefined {
    const r = this.db.get<{ id: string }>('SELECT id FROM resume_documents WHERE is_master = 1')
    return r ? this.get(r.id) : undefined
  }
}
