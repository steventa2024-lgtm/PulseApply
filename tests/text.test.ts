import { describe, expect, it } from 'vitest'
import { htmlToText, looksLikeHtml } from '../src/main/services/jobs/normalization/text'
import { makeServices } from './helpers'

describe('job descriptions never show raw HTML', () => {
  const cases: [string, string][] = [
    [
      '<p>Pick &amp; pack orders</p><ul><li>RF scanner</li></ul>',
      'Pick & pack orders\n\n• RF scanner'
    ],
    ['&lt;p&gt;Load trucks&lt;/p&gt;&lt;br/&gt;Forklift', 'Load trucks\n\nForklift'],
    ['&amp;lt;strong&amp;gt;Night shift&amp;lt;/strong&amp;gt;', 'Night shift'],
    ['<div>&lt;p&gt;Nested &amp;amp; escaped&lt;/p&gt;</div>', 'Nested & escaped'],
    ['<p style="color:red">Pay: $20&nbsp;/hr</p><script>alert(1)</script>', 'Pay: $20 /hr'],
    ['Lift up to 50 lbs; temperatures < 40°F', 'Lift up to 50 lbs; temperatures < 40°F']
  ]
  it.each(cases)('%s', (input, expected) => {
    const out = htmlToText(input)
    expect(out).toBe(expected)
    expect(looksLikeHtml(out)).toBe(false)
  })

  it('repairs descriptions stored by earlier versions at startup', async () => {
    const { svc, dir } = await makeServices()
    svc.store.db.run(
      "INSERT INTO jobs (id, canonical_key, data, title, company, source, discovered_at, last_seen_at, verification_status) VALUES ('j1', 'k', ?, 'T', 'C', 's', 'n', 'n', 'SOURCE_CONFIRMED')",
      [
        JSON.stringify({
          id: 'j1',
          description: '&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt;&lt;/p&gt;'
        })
      ]
    )
    await svc.shutdown()
    const { svc: again } = await makeServices({ userDataDir: dir })
    const row = again.store.db.get<{ data: string }>("SELECT data FROM jobs WHERE id = 'j1'")!
    expect(JSON.parse(row.data).description).toBe('Hello world')
    await again.shutdown()
  })
})
