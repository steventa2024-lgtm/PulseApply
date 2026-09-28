import type { NormalizedJob, ResolvedPlace, ScoredJob } from '../../../shared/types'
import type { Store } from '../persistence/store'
import type { GeoService } from '../jobs/geo/geoService'
import { buildCandidateModel, type CandidateModel } from './candidateModel'
import { scoreMatch } from './matcher'
import { cosine, EmbeddingService, similarityScore } from './embeddings'

/** Scores jobs against the stored candidate profile. */
export class MatchingService {
  constructor(
    private readonly store: Store,
    private readonly geo: GeoService,
    readonly embeddings: EmbeddingService
  ) {}

  candidate(): CandidateModel {
    const profile = this.store.candidate.get()
    const resume = this.store.candidate.defaultResume()
    const text = resume ? this.store.candidate.resumeText(resume.id) : ''
    const locText = profile.preferences.location || profile.location.value
    let location: ResolvedPlace | undefined
    if (locText) {
      const r = this.geo.resolveOffline(locText)
      if (r.precision !== 'none') location = r
    }
    return buildCandidateModel(profile, text, location)
  }

  async scoreAll<T extends NormalizedJob & { geo?: ScoredJob['geo'] }>(
    jobs: T[],
    signal?: AbortSignal
  ): Promise<Map<string, ReturnType<typeof scoreMatch>>> {
    const cand = this.candidate()
    const out = new Map<string, ReturnType<typeof scoreMatch>>()
    if (cand.empty) return out
    const weights = this.store.settings.get().matching.weights
    // Deterministic pass first; semantic similarity is added for the top candidates only.
    for (const j of jobs) out.set(j.id, scoreMatch(j, cand, { geo: j.geo, weights }))
    const status = await this.embeddings.checkStatus()
    if (!status.active || !cand.embeddingText) return out
    const ranked = [...jobs]
      .sort((a, b) => (out.get(b.id)?.score ?? 0) - (out.get(a.id)?.score ?? 0))
      .slice(0, 150)
    const texts = [
      cand.embeddingText,
      ...ranked.map((j) => `${j.title}\n${j.company}\n${j.description.slice(0, 1500)}`)
    ]
    const vecs = await this.embeddings.embed(texts, signal)
    const cv = vecs[0]
    if (!cv) return out
    ranked.forEach((j, i) => {
      const v = vecs[i + 1]
      if (!v) return
      out.set(
        j.id,
        scoreMatch(j, cand, {
          geo: j.geo,
          weights,
          semantic: { similarity: similarityScore(cosine(cv, v)), model: status.model }
        })
      )
    })
    return out
  }
}
