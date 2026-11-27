/** Boot an installed copy of a bundle on an isolated, loopback DSH Web host. */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, open, readFile, readdir, realpath, stat, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { prepareFixture, verifyFixture } from './preview-transfer-fixture.mjs'

const root = await realpath(process.env.PREVIEW_TRANSFER_ROOT)
const cli = await realpath(process.env.DSH_REVIEW_CLI)
const supplied = await realpath(process.env.PREVIEW_TRANSFER_BUNDLE)
const port = Number(process.env.PREVIEW_TRANSFER_PORT)
const profileName = 'preview-transfer'
const keep = ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'SYSTEMROOT']
const env = Object.fromEntries(
  keep.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]),
)
Object.assign(env, { HOME: join(root, 'home'), DSH_HOME: join(root, 'home'), PREVIEW_TRANSFER_ROOT: root })
assert.ok(
  relative(await realpath(join(import.meta.dirname, '../..')), root).startsWith('../'),
  'Use scratch space outside the worktree',
)
assert.equal((await stat(root)).mode & 0o077, 0, 'Use a private scratch directory')
assert.deepEqual(await readdir(root), [], 'Use a fresh scratch directory')
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== 3080, 'Use a disposable port, never 3080')
process.umask(0o077)

function run(program, args) {
  return execFileSync(program, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 })
}
async function digest(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

await prepareFixture(root)
run(process.execPath, [cli, '--profile', profileName, '--from-default-profile', 'web', '--dump-config'])
const profile = join(env.DSH_HOME, 'profiles', profileName)
const pkg = join(profile, 'node_modules', '@filipeesch', 'dsh-design-bundle')
await mkdir(dirname(pkg), { recursive: true })
const fromDirectory = (await stat(supplied)).isDirectory()
if (fromDirectory) {
  // The installed baseline is copied, not loaded in-place or changed.
  await cp(supplied, pkg, { recursive: true })
} else {
  for (const entry of run('tar', ['-tzf', supplied]).toString().trim().split('\n')) {
    assert.match(entry, /^package\/[\w./-]*$/)
    assert.ok(!entry.split('/').includes('..'))
  }
  for (const entry of run('tar', ['-tvzf', supplied]).toString().trim().split('\n')) assert.match(entry, /^[-d]/)
  await mkdir(pkg)
  run('tar', ['-xzf', supplied, '--strip-components', '1', '-C', pkg])
}
const bundle = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'))
assert.equal(bundle.name, '@filipeesch/dsh-design-bundle')
assert.equal(bundle.dsh?.bundle?.patch, './cordis.patch.yml')
const manifestPath = join(profile, 'package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
manifest.dsh.profile.bundles.push(bundle.name)
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
const pw = createRequire(import.meta.url).resolve('playwright-core/package.json')
await symlink(dirname(pw), join(profile, 'node_modules', 'playwright-core'), 'dir')
await symlink(
  join(dirname(cli), '..', 'node_modules', '@deepseek-ai'),
  join(profile, 'node_modules', '@deepseek-ai'),
  'dir',
)
const host = join(pkg, 'lib', 'host.js')
const hostBuild = /define_DSH_DESIGN_BUILD_default = \{ id: "([a-f0-9]{16})"/.exec(await readFile(host, 'utf8'))?.[1]
const provenance = {
  fixture: await verifyFixture(root),
  bundle: {
    version: bundle.version,
    hostBuild,
    hostSha256: await digest(host),
    ...(fromDirectory
      ? { source: 'installed directory copy' }
      : { source: 'packed archive', archiveSha256: await digest(supplied) }),
  },
  hostCliSha256: await digest(cli),
  playwrightCore: JSON.parse(await readFile(pw, 'utf8')).version,
  port,
}
await writeFile(join(root, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n')
const patch = join(root, 'fixture.patch.yml')
await writeFile(
  patch,
  JSON.stringify([
    { insert: [{ id: 'preview-transfer-fixture', name: join(import.meta.dirname, 'preview-transfer-fixture.mjs') }] },
  ]),
)
const log = await open(join(root, 'host.log'), 'wx', 0o600)
const child = spawn(
  process.execPath,
  [cli, '--profile', profileName, '--patch', patch, '--host', '127.0.0.1', '--port', String(port), '--no-open'],
  {
    cwd: root,
    env,
    stdio: ['ignore', log.fd, log.fd],
  },
)
console.log('Disposable preview host on port ' + port + '; evidence: ' + root)
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill('SIGTERM'))
await new Promise((done, failed) => {
  child.once('error', failed)
  child.once('close', (code) => {
    process.exitCode = code ?? 1
    done()
  })
}).finally(() => log.close())
