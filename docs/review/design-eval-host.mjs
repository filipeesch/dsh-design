/** Stage an immutable tarball into a fresh DSH web profile using existing dependencies. */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, cp, mkdir, open, readFile, readdir, realpath, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'

const env = { ...process.env }
const {
  DESIGN_EVAL_ROOT,
  DESIGN_EVAL_SOURCE,
  DESIGN_EVAL_LANE,
  DESIGN_EVAL_BUNDLE,
  DESIGN_EVAL_PORT,
  DSH_REVIEW_CLI,
  DESIGN_EVAL_ROUTE_PATCH,
  DESIGN_EVAL_STATUS,
  DESIGN_EVAL_REPLACEMENT,
} = env
assert.ok(DSH_REVIEW_CLI && DESIGN_EVAL_ROOT && DESIGN_EVAL_BUNDLE)
const root = await realpath(DESIGN_EVAL_ROOT)
const repo = await realpath(resolve(import.meta.dirname, '../..'))
assert.ok(relative(repo, root).startsWith('..' + '/'), 'Evaluation directory must be outside the worktree')
assert.equal((await stat(root)).mode & 0o077, 0, 'Evaluation directory must be private (0700)')
assert.deepEqual(await readdir(root), [], 'Use a new scratch directory for every attempt')
assert.match(DESIGN_EVAL_PORT, /^\d{4,5}$/)
assert.ok(Number(DESIGN_EVAL_PORT) >= 1024 && Number(DESIGN_EVAL_PORT) <= 65535 && DESIGN_EVAL_PORT !== '3080')
assert.match(DESIGN_EVAL_SOURCE, /^[a-f0-9]{40}$/)
assert.ok(['baseline', 'candidate'].includes(DESIGN_EVAL_LANE))
const catalogue = JSON.parse(await readFile(new URL('./design-eval-catalogue.json', import.meta.url)))
if (DESIGN_EVAL_LANE === 'baseline') assert.equal(DESIGN_EVAL_SOURCE, catalogue.baseline)
assert.ok(!DESIGN_EVAL_ROUTE_PATCH || (env.DESIGN_EVAL_PROVIDER && env.DESIGN_EVAL_MODEL))
const cli = await realpath(DSH_REVIEW_CLI)
const tarball = await realpath(DESIGN_EVAL_BUNDLE)
const routePatch = DESIGN_EVAL_ROUTE_PATCH && (await realpath(DESIGN_EVAL_ROUTE_PATCH))
if (routePatch)
  assert.ok(relative(repo, routePatch).startsWith('..' + '/'), 'Keep the route overlay outside the worktree')
const profileName = 'design-eval-' + DESIGN_EVAL_LANE
const statusMode = DESIGN_EVAL_STATUS
assert.ok(statusMode === undefined || ['swap', 'mixed'].includes(statusMode))
assert.equal(
  Boolean(statusMode),
  Boolean(DESIGN_EVAL_REPLACEMENT),
  'Status regression requires a second packed release',
)
if (statusMode) {
  assert.equal(DESIGN_EVAL_LANE, 'candidate')
  assert.ok(!routePatch && !env.DESIGN_EVAL_NO_CHROMIUM && !env.DESIGN_EVAL_CHECK_TIMEOUT)
  // Start a fresh host with no model route, copied auth, or inherited credential variables.
  const keep = new Set(['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'SYSTEMROOT'])
  for (const key of Object.keys(env)) if (!keep.has(key)) delete env[key]
  Object.assign(env, {
    HOME: join(root, 'home'),
    DESIGN_EVAL_STATUS: statusMode,
    DESIGN_EVAL_SOURCE,
    DESIGN_EVAL_LANE,
    DSH_DESIGN_CHROMIUM_PATH: join(root, 'no-chromium-installed-for-this-probe'),
  })
}
for (const key of ['DSH_PROFILE', 'DSH_PROFILE_DIR', 'DSH_HOME']) delete env[key]
env.DSH_HOME = join(root, 'home')
env.DESIGN_EVAL_ROOT = root
env.DESIGN_EVAL_BUNDLE = tarball
process.umask(0o077)
function run(program, args, cwd = repo) {
  return execFileSync(program, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 })
}

const archive = join(root, 'fixture.tar')
await writeFile(archive, run('git', ['archive', catalogue.baseline, catalogue.seed]))
await run('tar', ['-xf', archive, '-C', root])
const seed = join(root, catalogue.seed)
for (const dir of ['dispatch', ...(routePatch ? catalogue.requests.map(({ id }) => join('workspaces', id)) : [])]) {
  await mkdir(join(root, dir), { recursive: true })
  await cp(seed, join(root, dir, 'design'), { recursive: true })
}
run(process.execPath, [cli, '--profile', profileName, '--from-default-profile', 'web', '--dump-config'], root)
const profile = join(root, 'home', 'profiles', profileName)
const pkg = join(profile, 'node_modules', '@filipeesch', 'dsh-design-bundle')
async function unpack(archive, destination) {
  for (const entry of run('tar', ['-tzf', archive]).toString().trim().split('\n')) {
    assert.match(entry, /^package\/[\w./-]*$/)
    assert.ok(!entry.split('/').includes('..'))
  }
  for (const entry of run('tar', ['-tvzf', archive]).toString().trim().split('\n')) assert.match(entry, /^[-d]/)
  await mkdir(destination, { recursive: true })
  run('tar', ['-xzf', archive, '--strip-components', '1', '-C', destination])
}
await unpack(tarball, pkg)
const bundle = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'))
assert.equal(bundle.name, '@filipeesch/dsh-design-bundle')
assert.equal(bundle.dsh?.bundle?.patch, './cordis.patch.yml')
const manifestPath = join(profile, 'package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
manifest.dsh.profile.bundles.push(bundle.name)
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
const pw = createRequire(import.meta.url).resolve('playwright-core/package.json')
await symlink(dirname(pw), join(profile, 'node_modules', 'playwright-core'), 'dir')
const dshScope = createRequire(cli).resolve('@deepseek-ai/dsh-llm/package.json', { paths: [dirname(cli)] })
// Resolve the host peer package through the CLI's existing @deepseek-ai scope, not the shared GUI profile.
const cliModules = join(dirname(cli), '..', 'node_modules', '@deepseek-ai')
assert.ok(dshScope && (await stat(cliModules)).isDirectory())
await symlink(cliModules, join(profile, 'node_modules', '@deepseek-ai'), 'dir')
const provenance = {
  lane: DESIGN_EVAL_LANE,
  source: DESIGN_EVAL_SOURCE,
  bundleVersion: bundle.version,
  bundleSha256: digest(await readFile(tarball)),
  hostCliSha256: digest(await readFile(cli)),
  playwrightCore: JSON.parse(await readFile(pw, 'utf8')).version,
  fixture: catalogue.baseline + ':' + catalogue.seed,
  route: routePatch ? { provider: env.DESIGN_EVAL_PROVIDER, model: env.DESIGN_EVAL_MODEL } : undefined,
}
if (statusMode) {
  const replacement = await realpath(DESIGN_EVAL_REPLACEMENT)
  const staged = join(root, 'replacement')
  await unpack(replacement, staged)
  provenance.statusMode = statusMode
  provenance.original = await inspectPackedBuild(pkg)
  provenance.replacement = { ...(await inspectPackedBuild(staged)), sha256: digest(await readFile(replacement)) }
  assert.notEqual(provenance.replacement.sha256, provenance.bundleSha256)
  assert.notEqual(provenance.replacement.version, bundle.version)
  assert.notEqual(provenance.replacement.host.id, provenance.original.host.id)
  assert.notEqual(provenance.replacement.tools.id, provenance.original.tools.id)
  if (statusMode === 'mixed') {
    // Model the other upgrade edge: original host, genuinely different tools loaded from disk.
    const toolsPath = join(pkg, 'lib/tools.js')
    await copyFile(join(staged, 'lib/tools.js'), toolsPath)
    assert.equal(digest(await readFile(toolsPath)), provenance.replacement.tools.sha256)
  }
}
await writeFile(join(root, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n')
const entries = [['design-installed-dispatch', 'design-installed-dispatch.mjs']]
if (routePatch) entries.push(['design-eval-sessions', 'design-eval-sessions.mjs'])
const reviewPatch = join(root, 'review.yml')
const patches = [{ insert: entries.map(([id, name]) => ({ id, name: join(import.meta.dirname, name) })) }]
if (env.DESIGN_EVAL_CHECK_TIMEOUT === '1') {
  assert.equal(routePatch, undefined, 'Use the short browser budget only in the deterministic lane')
  patches.push({ id: 'design-host', config: { browserTimeoutMs: 1 } })
}
await writeFile(reviewPatch, JSON.stringify(patches))
const log = await open(join(root, 'host.log'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
const host = spawn(
  process.execPath,
  [
    cli,
    '--profile',
    profileName,
    ...(routePatch ? ['--patch', routePatch] : []),
    '--patch',
    reviewPatch,
    '--port',
    DESIGN_EVAL_PORT,
    '--no-open',
  ],
  { env, cwd: root, stdio: ['ignore', log.fd, log.fd] },
)
console.log('Starting isolated Design host on port ' + DESIGN_EVAL_PORT + '; private evidence: ' + root)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => host.kill('SIGTERM'))
await new Promise((done, failed) => {
  host.once('error', failed)
  host.once('close', (code) => {
    process.exitCode = code ?? 1
    done()
  })
}).finally(() => log.close())

// Inspect data only; don't import either packed plugin before the native host loads it.
async function inspectPackedBuild(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  assert.equal(manifest.name, bundle.name)
  assert.equal(manifest.dsh?.bundle?.patch, bundle.dsh.bundle.patch)
  const output = { version: manifest.version }
  for (const module of ['host', 'tools']) {
    const bytes = await readFile(join(directory, 'lib', module + '.js'))
    const build = /define_DSH_DESIGN_BUILD_default = \{ id: "([a-f0-9]{16})", version: "([^"]+)" \}/.exec(String(bytes))
    assert.ok(build, 'Could not read the embedded packed build for ' + module)
    assert.equal(build[2], manifest.version)
    output[module] = { id: build[1], version: build[2], sha256: digest(bytes) }
  }
  return output
}

function digest(data) {
  return createHash('sha256').update(data).digest('hex')
}
