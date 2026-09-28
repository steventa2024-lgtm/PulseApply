import { describe, expect, it } from 'vitest'
import type { NormalizedJob, WorkMode } from '../src/shared/types'
import { Gazetteer } from '../src/main/services/jobs/geo/gazetteer'
import {
  evaluateGeo,
  GeoService,
  parseRemoteEligibility
} from '../src/main/services/jobs/geo/geoService'
import { buildIntent } from '../src/main/services/jobs/search/intent'
import { normalizeDraft } from '../src/main/services/jobs/normalization/normalize'
import { RESOURCES } from './helpers'

const gaz = new Gazetteer(RESOURCES)
const geo = new GeoService(gaz, null, null, () => false)

function job(
  locationText: string,
  workModes?: WorkMode[],
  remoteEligibilityText?: string
): NormalizedJob {
  const r = normalizeDraft(
    {
      sourceJobId: locationText,
      sourceUrl: 'https://example.com/j/1',
      title: 'Warehouse Associate',
      company: 'X',
      descriptionText: 'Pick and pack.',
      locationText,
      workModes,
      remoteEligibilityText,
      employerDirect: false
    },
    { providerId: 't', providerName: 'T', geo }
  )
  return r.job!
}

function intent(location: string, radius: number, modes?: WorkMode[]): SearchIntent {
  const i = buildIntent({
    query: 'warehouse',
    location,
    radius,
    radiusUnit: 'mi',
    workModes: modes
  })
  i.location = gaz.resolve(location)
  return i
}

describe('gazetteer', () => {
  it('resolves ambiguous state/country codes sensibly', () => {
    expect(gaz.resolve('Los Angeles, CA')).toMatchObject({
      city: 'Los Angeles',
      country: 'US',
      region: 'CA'
    })
    expect(gaz.resolve('Berlin, DE')).toMatchObject({ city: 'Berlin', country: 'DE' })
    expect(gaz.resolve('Newark, DE')).toMatchObject({ city: 'Newark', country: 'US', region: 'DE' })
    expect(gaz.resolve('Toronto, ON, Canada')).toMatchObject({ city: 'Toronto', country: 'CA' })
    expect(gaz.resolve('90712')).toMatchObject({ country: 'US', precision: 'postal' })
    expect(gaz.resolve('Germany')).toMatchObject({ country: 'DE', precision: 'country' })
    expect(gaz.resolve('Multiple Locations').precision).toBe('none')
  })
})

describe('geographic filtering', () => {
  const la = intent('Los Angeles, CA', 20)

  it('excludes unrelated European on-site jobs from a Los Angeles search', () => {
    const g = evaluateGeo(job('Berlin, Germany'), la)
    expect(g.include).toBe(false)
    expect(g.exclusion).toBe('outside_radius')
  })

  it('evaluates nearby cities by distance', () => {
    const carson = evaluateGeo(job('Carson, CA'), la)
    expect(carson).toMatchObject({ include: true, eligibility: 'within_radius' })
    expect(carson.distance).toBeGreaterThan(10)
    expect(carson.distance).toBeLessThan(16)
    const riverside = evaluateGeo(job('Riverside, CA'), la)
    expect(riverside).toMatchObject({ include: false, eligibility: 'outside_radius' })
  })

  it('marks unresolvable locations as unknown, never local', () => {
    const g = evaluateGeo(job('Various locations'), la)
    expect(g.eligibility).toBe('unknown')
  })

  it('excludes remote-only jobs from an on-site search', () => {
    const g = evaluateGeo(job('Remote - US', ['remote'], 'USA'), la)
    expect(g).toMatchObject({ include: false, exclusion: 'remote_not_requested' })
  })

  it('applies remote eligibility by country and region', () => {
    const us = intent('United States', 0, ['remote'])
    expect(evaluateGeo(job('Remote', ['remote'], 'USA Only'), us)).toMatchObject({
      include: true,
      eligibility: 'remote_eligible'
    })
    expect(evaluateGeo(job('Remote', ['remote'], 'Europe'), us)).toMatchObject({
      include: false,
      eligibility: 'remote_ineligible'
    })
    expect(evaluateGeo(job('Remote', ['remote'], 'Anywhere in the World'), us)).toMatchObject({
      include: true,
      eligibility: 'remote_eligible'
    })
    const unspecified = evaluateGeo(job('Remote', ['remote']), us)
    expect(unspecified.eligibility).toBe('remote_unspecified')
    const de = intent('Germany', 0, ['remote'])
    expect(evaluateGeo(job('Remote', ['remote'], 'EMEA'), de)).toMatchObject({ include: true })
    expect(evaluateGeo(job('Remote', ['remote'], 'US, Canada'), de)).toMatchObject({
      include: false
    })
  })

  it('country-level searches match on country', () => {
    const de = intent('Germany', 0)
    expect(evaluateGeo(job('Munich, Germany'), de)).toMatchObject({
      include: true,
      eligibility: 'in_country'
    })
    expect(evaluateGeo(job('Austin, TX'), de)).toMatchObject({
      include: false,
      eligibility: 'outside_country'
    })
  })

  it('parses remote eligibility statements', () => {
    expect(parseRemoteEligibility('USA Only')).toMatchObject({
      kind: 'countries',
      countries: ['US']
    })
    expect(parseRemoteEligibility('Worldwide')).toMatchObject({ kind: 'worldwide' })
    expect(parseRemoteEligibility('')).toMatchObject({ kind: 'unspecified' })
    expect(parseRemoteEligibility('LATAM')).toMatchObject({ kind: 'regions', regions: ['latam'] })
  })
})
