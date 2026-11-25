import { build } from 'esbuild'
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = (name) => resolve(root, 'packages', name)
const coreEntry = resolve(pkg('core'), 'src/index.ts')
const browserEntry = resolve(pkg('core'), 'src/browser.ts')
const kitEntry = resolve(pkg('kit'), 'src/index.ts')
const kitMetaEntry = resolve(pkg('kit'), 'src/meta.ts')

const aliases = {
  '@filipeesch/dsh-design-core': coreEntry,
  '@filipeesch/dsh-design-kit/meta': kitMetaEntry,
  '@filipeesch/dsh-design-kit': kitEntry,
}

const nodeShared = {
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  external: ['@deepseek-ai/*', 'playwright-core'],
  alias: aliases,
  sourcemap: true,
  logLevel: 'warning',
}

async function copyDir(source, target) {
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    await cp(resolve(source, entry.name), resolve(target, entry.name), { recursive: true })
  }
}

async function out(path, contents) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
}

async function buildCore() {
  await build({ ...nodeShared, entryPoints: [coreEntry], outfile: resolve(pkg('core'), 'lib/index.js') })
}

async function buildKit() {
  await build({
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['react', 'react-dom'],
    alias: { ...aliases, '@filipeesch/dsh-design-core': browserEntry },
    sourcemap: true,
    logLevel: 'warning',
    entryPoints: [kitEntry],
    outfile: resolve(pkg('kit'), 'lib/index.js'),
  })
  await build({
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node24',
    external: ['@deepseek-ai/*'],
    alias: aliases,
    sourcemap: true,
    logLevel: 'warning',
    entryPoints: [kitMetaEntry],
    outfile: resolve(pkg('kit'), 'lib/meta.js'),
  })
}

async function buildRenderer() {
  const dist = resolve(pkg('renderer'), 'dist')
  await rm(dist, { recursive: true, force: true })
  await mkdir(dist, { recursive: true })
  await build({
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    alias: { ...aliases, '@filipeesch/dsh-design-core': browserEntry },
    external: ['*.woff2'],
    sourcemap: false,
    logLevel: 'warning',
    jsx: 'automatic',
    entryPoints: [resolve(pkg('renderer'), 'src/main.tsx')],
    outfile: resolve(dist, 'app.js'),
    loader: { '.css': 'css' },
  })
  await build({
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    entryPoints: [resolve(pkg('renderer'), 'src/styles.css')],
    external: ['*.woff2'],
    outfile: resolve(dist, 'app.css'),
    logLevel: 'warning',
  })
  await cp(resolve(pkg('renderer'), 'index.html'), resolve(dist, 'index.html'))
  const fontPackage = resolve(root, 'node_modules/@fontsource/inter/files')
  await mkdir(resolve(dist, 'fonts'), { recursive: true })
  for (const font of ['inter-latin-400-normal.woff2', 'inter-latin-600-normal.woff2', 'inter-latin-700-normal.woff2']) {
    await cp(resolve(fontPackage, font), resolve(dist, 'fonts', font))
  }
  await cp(resolve(root, 'node_modules/@fontsource/inter/LICENSE'), resolve(dist, 'fonts/Inter-OFL.txt'))
}

async function buildHost() {
  await build({
    ...nodeShared,
    entryPoints: [resolve(pkg('host'), 'src/index.ts')],
    outfile: resolve(pkg('host'), 'lib/index.js'),
  })
  await build({
    ...nodeShared,
    entryPoints: [resolve(pkg('host'), 'src/tools.ts')],
    outfile: resolve(pkg('host'), 'lib/tools.js'),
  })
}

async function buildPreset() {
  await build({
    ...nodeShared,
    entryPoints: [resolve(pkg('preset'), 'src/index.ts')],
    outfile: resolve(pkg('preset'), 'lib/index.js'),
  })
}

async function buildClient() {
  await build({
    ...nodeShared,
    entryPoints: [resolve(pkg('client'), 'src/index.ts')],
    outfile: resolve(pkg('client'), 'lib/index.js'),
  })
  await buildClientBundle(resolve(pkg('client'), 'lib/client.js'), '@filipeesch/dsh-design-client')
}

async function buildClientBundle(outfile, id) {
  const result = await build({
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    external: ['react', 'react-dom', '@deepseek-ai/*'],
    jsx: 'automatic',
    entryPoints: [resolve(pkg('client'), 'src/client.tsx')],
    logLevel: 'warning',
  })
  const body = result.outputFiles?.[0]?.text ?? ''
  const wrapper =
    'window.__ModuleLoader__.load({id:' +
    JSON.stringify(id) +
    ',factory:function(require){var module={exports:{}};var exports=module.exports;\n' +
    body +
    '\nreturn module.exports;}});\n'
  await out(outfile, wrapper)
}

async function buildBundle() {
  const lib = resolve(pkg('bundle'), 'lib')
  await rm(lib, { recursive: true, force: true })
  await build({ ...nodeShared, entryPoints: [resolve(pkg('host'), 'src/index.ts')], outfile: resolve(lib, 'host.js') })
  await build({ ...nodeShared, entryPoints: [resolve(pkg('host'), 'src/tools.ts')], outfile: resolve(lib, 'tools.js') })
  await build({
    ...nodeShared,
    entryPoints: [resolve(pkg('preset'), 'src/index.ts')],
    outfile: resolve(lib, 'preset.js'),
  })
  await build({
    ...nodeShared,
    entryPoints: [resolve(pkg('bundle'), 'src/index.ts')],
    outfile: resolve(lib, 'index.js'),
  })
  await buildClientBundle(resolve(lib, 'client.js'), '@filipeesch/dsh-design-bundle')
  // The embedded client package: a distinct manifest so the client-module scan
  // treats this row as the package's browser contribution.
  const clientDir = resolve(lib, 'client-plugin')
  await out(resolve(clientDir, 'index.js'), 'export function apply() {}\n')
  await buildClientBundle(resolve(clientDir, 'client.js'), '@filipeesch/dsh-design-client')
  await out(
    resolve(clientDir, 'package.json'),
    JSON.stringify(
      {
        name: '@filipeesch/dsh-design-client',
        version: '0.1.0',
        private: true,
        type: 'module',
        main: './index.js',
        exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' },
        dsh: { client: { platform: 'web' } },
      },
      null,
      2,
    ) + '\n',
  )
  await copyDir(resolve(pkg('renderer'), 'dist'), resolve(lib, 'assets'))
  await copyDir(resolve(pkg('renderer'), 'dist'), resolve(pkg('host'), 'lib/assets'))
}

const selection = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : 'all'
const plan = {
  core: [buildCore],
  kit: [buildKit],
  renderer: [buildRenderer],
  host: [buildHost],
  preset: [buildPreset],
  client: [buildClient],
  bundle: [buildBundle],
  all: [buildCore, buildKit, buildRenderer, buildHost, buildPreset, buildClient, buildBundle],
}[selection]
if (plan === undefined) throw new Error('unknown build target: ' + String(selection))
for (const step of plan) {
  const started = Date.now()
  await step()
  console.log(step.name + ' done in ' + String(Date.now() - started) + 'ms')
}

console.log('build complete')
