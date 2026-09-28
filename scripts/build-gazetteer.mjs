/**
 * Builds the compact offline gazetteer shipped in resources/geo/.
 *
 * Source data: GeoNames (https://www.geonames.org/), licensed CC BY 4.0,
 * redistributed through the `all-the-cities` (cities with population >= 1000)
 * and `us-zips` (US ZIP centroids) npm packages. Run with:
 *
 *   node scripts/build-gazetteer.mjs
 *
 * The generated files are committed so the app works offline and packaging does
 * not depend on these dev-only packages.
 */
import { createRequire } from 'node:module'
import { gzipSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources', 'geo')
mkdirSync(outDir, { recursive: true })

const cities = require('all-the-cities')
const rows = []
for (const c of cities) {
  if (!c.population || c.population < 1000) continue
  const [lon, lat] = c.loc.coordinates
  rows.push([
    c.name,
    c.altName || '',
    c.country,
    c.adminCode || '',
    Math.round(lat * 1e4) / 1e4,
    Math.round(lon * 1e4) / 1e4,
    c.population
  ])
}
rows.sort((a, b) => b[6] - a[6])
const cityPayload = {
  version: 1,
  source: 'GeoNames cities (population >= 1000) via all-the-cities@3.1.0',
  license: 'CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/ — data © GeoNames',
  columns: ['name', 'altName', 'country', 'admin1', 'lat', 'lon', 'population'],
  rows
}
const cityBuf = gzipSync(Buffer.from(JSON.stringify(cityPayload)), { level: 9 })
writeFileSync(join(outDir, 'cities.json.gz'), cityBuf)

const zips = require('us-zips/object')
const zipRows = {}
for (const [zip, v] of Object.entries(zips.default || zips)) {
  zipRows[zip] = [Math.round(v.latitude * 1e4) / 1e4, Math.round(v.longitude * 1e4) / 1e4]
}
const zipPayload = {
  version: 1,
  source: 'US ZIP code centroids via us-zips@2022.9.1',
  license: 'MIT (package); centroids derived from public US Census ZCTA data',
  zips: zipRows
}
const zipBuf = gzipSync(Buffer.from(JSON.stringify(zipPayload)), { level: 9 })
writeFileSync(join(outDir, 'us-zips.json.gz'), zipBuf)

console.log(`cities: ${rows.length} rows, ${(cityBuf.length / 1024).toFixed(0)} KiB`)
console.log(`zips: ${Object.keys(zipRows).length} rows, ${(zipBuf.length / 1024).toFixed(0)} KiB`)
