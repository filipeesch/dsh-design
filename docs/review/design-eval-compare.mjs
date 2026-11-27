/** Read-only metric comparison; never prints native transcripts or credential-bearing paths. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const [baselineDir, candidateDir] = process.argv.slice(2)
assert.ok(baselineDir && candidateDir, 'Usage: node design-eval-compare.mjs <baseline scratch> <candidate scratch>')
const input = await readFile(new URL('./design-eval-catalogue.json', import.meta.url))
const catalogue = JSON.parse(input)
const digest = (data) => createHash('sha256').update(data).digest('hex')
const baseline = await round(baselineDir)
const candidate = await round(candidateDir)
assert.equal(baseline.provenance.lane, 'baseline')
assert.equal(candidate.provenance.lane, 'candidate')
assert.equal(baseline.provenance.source, catalogue.baseline)
assert.equal(baseline.provenance.fixture, candidate.provenance.fixture)
assert.equal(baseline.provenance.playwrightCore, candidate.provenance.playwrightCore)
for (const [index, left] of baseline.cases.entries()) {
  const right = candidate.cases[index]
  if (left.seedSha256 && right.seedSha256) assert.equal(left.seedSha256, right.seedSha256, left.id + ': fixture drift')
}
assert.equal(baseline.provenance.hostCliSha256, candidate.provenance.hostCliSha256)
assert.deepEqual(baseline.provenance.route, candidate.provenance.route)
console.log(JSON.stringify({ baseline, candidate }, null, 2))

async function json(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

async function round(directory) {
  const provenance = await json(join(directory, 'provenance.json'))
  const cases = await Promise.all(
    catalogue.requests.map(async ({ id, text }) => {
      try {
        const started = await json(join(directory, 'evidence', id, 'started.json'))
        assert.equal(started.catalogueSha256, digest(input), id + ': catalogue drift')
        assert.equal(started.promptSha256, digest(text), id + ': prompt drift')
        const { status, reason, issue, roundTrips, tools, requestVerified, preview, changedSources, screenshots } =
          await json(join(directory, 'evidence', id, 'summary.json'))
        return {
          id,
          status,
          reason,
          issue,
          promptSha256: started.promptSha256,
          catalogueSha256: started.catalogueSha256,
          seedSha256: digest(JSON.stringify(started.seed)),
          roundTrips,
          tools,
          requestVerified,
          preview,
          changedSources,
          screenshots,
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        return { id, status: 'incomplete', reason: 'missing-summary' }
      }
    }),
  )
  return { provenance, cases }
}
