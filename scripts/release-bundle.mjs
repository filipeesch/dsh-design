import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import semver from 'semver'

const cwd = resolve(import.meta.dirname, '..')
const manifestPath = resolve(cwd, 'packages/bundle/package.json')
const bundle = 'dsh-design-bundle.tgz'
const checksum = bundle + '.sha256'
const files = [bundle, checksum]
const dist = (name) => resolve(cwd, 'dist', name)
const sha256 = (name) =>
  createHash('sha256')
    .update(readFileSync(dist(name)))
    .digest('hex')
const stable = (version) => /^\d+\.\d+\.\d+$/.test(version) && semver.valid(version)
const tagVersion = (tag) => stable(tag.replace(/^v/, ''))
const run = (cmd, ...args) => execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim()
const show = (cmd, ...args) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })
const checksumLine = () => sha256(bundle) + '  ' + bundle + '\n'

function validateBundle(version) {
  assert(stable(version), 'Expected a stable version (X.Y.Z)')
  const paths = run('tar', '-tzf', dist(bundle)).split('\n')
  assert.equal(new Set(paths).size, paths.length, 'Duplicate archive paths')
  for (const path of paths) {
    assert.match(path, /^package\/(?:lib\/[\w./-]+|package\.json|cordis\.patch\.yml|README\.md)$/)
    assert(!path.split('/').includes('..'), 'Unsafe archive path')
  }
  assert(
    run('tar', '-tvzf', dist(bundle))
      .split('\n')
      .every((entry) => /^[-d]/.test(entry)),
    'Unexpected archive type',
  )
  const extract = (path) => run('tar', '-xOzf', dist(bundle), 'package/' + path)
  const manifest = JSON.parse(extract('package.json'))
  assert.equal(manifest.name, '@filipeesch/dsh-design-bundle')
  assert.equal(manifest.version, version)
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
    assert(!Object.hasOwn(manifest.scripts ?? {}, hook), 'Unexpected lifecycle hook: ' + hook)
  }
  for (const path of [
    'cordis.patch.yml',
    'lib/index.js',
    'lib/host.js',
    'lib/preset.js',
    'lib/tools.js',
    'lib/client.js',
    'lib/client-plugin/index.js',
    'lib/client-plugin/client.js',
    'lib/client-plugin/package.json',
    'lib/assets/index.html',
    'lib/assets/app.js',
    'lib/assets/app.css',
    'lib/assets/fonts/Inter-OFL.txt',
  ]) {
    assert(paths.includes('package/' + path) && extract(path).length > 0, 'Missing or empty: ' + path)
  }
  for (const weight of [400, 600, 700]) {
    assert(paths.includes('package/lib/assets/fonts/inter-latin-' + weight + '-normal.woff2'))
  }
  assert.equal(readFileSync(dist(checksum), 'utf8'), checksumLine())
}

function pack(version) {
  assert(stable(version), 'Expected a stable version (X.Y.Z)')
  const original = readFileSync(manifestPath, 'utf8')
  const manifest = JSON.parse(original)
  try {
    manifest.version = version
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    show('pnpm', 'run', 'check')
    show(process.execPath, 'scripts/pack.mjs')
    renameSync(dist('filipeesch-dsh-design-bundle-' + version + '.tgz'), dist(bundle))
    writeFileSync(dist(checksum), checksumLine())
    validateBundle(version)
    console.log('Verified bundle and checksum for v' + version)
  } finally {
    writeFileSync(manifestPath, original)
  }
}

function release(command, version) {
  const { SOURCE_SHA: source, GITHUB_REPOSITORY: repo, GITHUB_OUTPUT: output, GH_TOKEN: token } = process.env
  assert(process.env.GITHUB_ACTIONS === 'true' && repo === 'filipeesch/dsh-design' && token)
  assert.match(source, /^[0-9a-f]{40}$/)
  assert.equal(run('git', 'rev-parse', 'HEAD'), source)
  const endpoint = 'repos/' + repo + '/releases'
  const api = (...args) => JSON.parse(run('gh', 'api', ...args))
  const tags = () =>
    new Map(
      run('git', 'ls-remote', '--tags', 'origin')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [sha, ref] = line.split('\t')
          return [ref.slice('refs/tags/'.length), sha]
        }),
    )
  const tagCommit = (refs, tag) => refs.get(tag + '^{}') ?? refs.get(tag)
  const marker = '<!-- dsh-design-source: ' + source + ' -->'
  const all = api(endpoint + '?per_page=100', '--paginate', '--slurp').flat()
  const refs = tags()
  const matches = all.filter(
    (item) =>
      !item.prerelease &&
      tagVersion(item.tag_name) &&
      (item.body?.includes(marker) || (!item.draft && tagCommit(refs, item.tag_name) === source)),
  )
  assert(matches.length <= 1, 'Multiple releases for source ' + source)
  const existing = matches[0]
  if (existing && !existing.draft) {
    assert.equal(tagCommit(refs, existing.tag_name), source)
    console.log(existing.tag_name + ' already published for ' + source)
    return
  }
  if (existing) {
    assert.equal(existing.target_commitish, source, 'Draft target does not match source')
    assert(!refs.has(existing.tag_name), 'Draft tag already exists; refusing to reuse it')
  }
  if (command === 'plan') {
    const base = JSON.parse(readFileSync(manifestPath, 'utf8')).version
    assert(stable(base), 'Bundle manifest must contain a stable version')
    const versions = [base, ...[...refs.keys(), ...all.map(({ tag_name }) => tag_name)].map(tagVersion).filter(Boolean)]
    const selected = existing ? tagVersion(existing.tag_name) : semver.inc(versions.sort(semver.rcompare)[0], 'patch')
    assert(stable(selected))
    console.log('Selected v' + selected + ' for ' + source)
    appendFileSync(output, 'version=' + selected + '\n')
    return
  }

  validateBundle(version)
  const tag = 'v' + version
  assert(!refs.has(tag), 'Tag already exists: ' + tag)
  assert(existing ? existing.tag_name === tag : !all.some((item) => item.tag_name === tag), 'Release tag collision')
  const draft =
    existing ??
    api(
      endpoint,
      '-f',
      'tag_name=' + tag,
      '-f',
      'target_commitish=' + source,
      '-f',
      'name=DSH Design ' + tag,
      '-F',
      'draft=true',
      '-F',
      'prerelease=false',
      '-f',
      'body=Built from ' +
        source +
        '.\n\n' +
        marker +
        '\n\nStable install URL: https://github.com/' +
        repo +
        '/releases/latest/download/' +
        bundle,
    )
  const releasePath = endpoint + '/' + draft.id
  const expected = new Map(
    files.map((name) => [
      name,
      {
        size: statSync(dist(name)).size,
        digest: 'sha256:' + sha256(name),
      },
    ]),
  )
  const verifyAssets = (assets) => {
    const names = new Set()
    for (const { name, size, digest, state } of assets) {
      const file = expected.get(name)
      assert(
        file && !names.has(name) && state === 'uploaded' && size === file.size && digest === file.digest,
        'Unexpected or conflicting draft asset: ' + name,
      )
      names.add(name)
    }
    return names
  }
  const uploaded = verifyAssets(draft.assets)
  const missing = files.filter((name) => !uploaded.has(name))
  if (missing.length) show('gh', 'release', 'upload', tag, '--repo', repo, ...missing.map(dist))
  const verified = api(releasePath)
  assert(verified.draft && !verified.prerelease && verified.tag_name === tag && verified.target_commitish === source)
  assert.equal(verifyAssets(verified.assets).size, files.length, 'Incomplete draft')

  // A delayed run may receive a higher version even though its source is older.
  const latest = all.some((item) => !item.draft && !item.prerelease) ? api(endpoint + '/latest').tag_name : undefined
  const currentTags = tags()
  assert(!currentTags.has(tag), 'Tag appeared before publication: ' + tag)
  let makeLatest = !latest
  if (latest) {
    const latestSource = tagCommit(currentTags, latest)
    assert(latestSource, 'Cannot resolve current latest tag: ' + latest)
    const { status } = api('repos/' + repo + '/compare/' + latestSource + '...' + source)
    makeLatest = status === 'ahead' && (!tagVersion(latest) || semver.gt(version, tagVersion(latest)))
  }
  const published = api(releasePath, '-X', 'PATCH', '-F', 'draft=false', '-f', 'make_latest=' + makeLatest)
  assert(!published.draft && !published.prerelease)
  assert.equal(tagCommit(tags(), tag), source, 'Published tag points to an unexpected source')
  console.log('Published ' + published.html_url + ' (latest=' + makeLatest + ')')
}

const [command, version] = process.argv.slice(2)
if (command === 'pack') pack(version)
else if (command === 'plan' || command === 'publish') release(command, version)
else throw new Error('Expected pack VERSION, plan or publish VERSION')
