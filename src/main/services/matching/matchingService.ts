import type { MatchResult, NormalizedJob, ResolvedPlace, ScoredJob } from '../../../shared/types'
import type { Store } from '../persistence/store'
import type { GeoService } from '../jobs/geo/geoService'
import { buildCandidateModel, type CandidateModel } from './candidateModel'
import { scoreEligibleJob } from '../eligibility/score'
import type { CriteriaContext } from '../eligibility/criteria'
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

  /**
   * Scores jobs that passed the hard filters for the given criteria. A
   * deterministic pass runs first; when local embeddings are active, semantic
   * similarity is added for the best-ranked jobs.
   */
  async scoreEligible(
    items: { job: NormalizedJob; geo: ScoredJob['geo'] }[],
    ctx: CriteriaContext,
    signal?: AbortSignal
  ): Promise<Map<string, MatchResult | undefined>> {
    const cand = this.candidate()
    const out = new Map<string, MatchResult | undefined>()
    if (cand.empty) return out
    const weights = this.store.settings.get().matching.weights
    for (const it of items)
      out.set(it.job.id, scoreEligibleJob(it.job, cand, ctx, { geo: it.geo, weights }))
    if (!items.length) return out
    const status = await this.embeddings.checkStatus()
    if (!status.active || !cand.embeddingText) return out
    const ranked = [...items]
      .sort((a, b) => (out.get(b.job.id)?.score ?? 0) - (out.get(a.job.id)?.score ?? 0))
      .slice(0, 150)
    const texts = [
      cand.embeddingText,
      ...ranked.map(
        (it) => `${it.job.title}\n${it.job.company}\n${it.job.description.slice(0, 1500)}`
      )
    ]
    const vecs = await this.embeddings.embed(texts, signal)
    const cv = vecs[0]
    if (!cv) return out
    ranked.forEach((it, i) => {
      const v = vecs[i + 1]
      if (!v) return
      out.set(
        it.job.id,
        scoreEligibleJob(it.job, cand, ctx, {
          geo: it.geo,
          weights,
          semantic: { similarity: similarityScore(cosine(cv, v)), model: status.model }
        })
      )
    })
    return out
  }
}
