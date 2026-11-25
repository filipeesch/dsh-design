/** Scaffold a new design project without overwriting existing files. */
import { lstat, mkdir, open as openFile, realpath, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { DEFAULT_BREAKPOINTS } from './config.ts'
import { DEFAULT_DESIGN_FOLDER, normalizeFolderName } from './project.ts'

/** Result of a scaffold attempt. */
export interface ScaffoldResult {
  readonly folder: string
  /** Files written by this call, relative to the working directory. */
  readonly created: readonly string[]
  /** Files that already existed and were left untouched. */
  readonly existing: readonly string[]
  /** True when the project already existed and nothing was written. */
  readonly alreadyExists: boolean
}

/** Handle shape needed to write one claimed file. */
export interface ScaffoldFileHandle {
  writeFile(content: string): Promise<void>
  close(): Promise<void>
}

/** Injectable file primitives for deterministic failure tests. */
export interface ScaffoldIO {
  open(path: string, flags: 'wx'): Promise<ScaffoldFileHandle>
  remove(path: string): Promise<void>
}

const nodeIO: ScaffoldIO = {
  open: (path, flags) => openFile(path, flags),
  remove: (path) => rm(path, { force: true }),
}

/** Default token set scaffolded into new projects. */
export const DEFAULT_TOKENS = {
  color: {
    blue: { '600': { $value: '#2563eb', $type: 'color' } },
    white: { $value: '#ffffff', $type: 'color' },
    'slate-50': { $value: '#f8fafc', $type: 'color' },
    'slate-200': { $value: '#e2e8f0', $type: 'color' },
    'slate-700': { $value: '#334155', $type: 'color' },
    action: { $value: '{color.blue.600}', $type: 'color' },
    surface: { $value: '{color.white}', $type: 'color' },
    canvas: { $value: '{color.slate-50}', $type: 'color' },
    border: { $value: '{color.slate-200}', $type: 'color' },
    text: { $value: '{color.slate-700}', $type: 'color' },
  },
  spacing: {
    xs: { $value: '4px', $type: 'dimension' },
    sm: { $value: '8px', $type: 'dimension' },
    md: { $value: '16px', $type: 'dimension' },
    lg: { $value: '24px', $type: 'dimension' },
    xl: { $value: '32px', $type: 'dimension' },
  },
  radius: {
    sm: { $value: '4px', $type: 'dimension' },
    md: { $value: '8px', $type: 'dimension' },
    pill: { $value: '999px', $type: 'dimension' },
  },
  font: {
    family: { $value: 'system-ui, -apple-system, "Segoe UI", sans-serif', $type: 'fontFamily' },
    size: {
      sm: { $value: '13px', $type: 'dimension' },
      md: { $value: '15px', $type: 'dimension' },
      lg: { $value: '20px', $type: 'dimension' },
      xl: { $value: '28px', $type: 'dimension' },
    },
    weight: {
      regular: { $value: 400, $type: 'fontWeight' },
      semibold: { $value: 600, $type: 'fontWeight' },
    },
  },
  shadow: {
    card: { $value: '0 1px 2px rgba(15, 23, 42, 0.08)', $type: 'shadow' },
  },
} as const

/** Sample screen written by the scaffold; it validates with zero diagnostics. */
export const SAMPLE_SCREEN = `<Screen id="home" title="Home">
  <Header title="Acme" />
  <Stack gap="spacing.md" padding="spacing.lg" background="color.canvas">
    <Text variant="heading">Welcome</Text>
    <Text color="color.text">Sketch your first screen by editing screens/home.dsx.</Text>
    <Button id="primary-action" variant="primary">Get started</Button>
  </Stack>
</Screen>
`

/**
 * Open a file exclusively, register ownership immediately, then write and
 * close it. A partial write is therefore always owned by the rollback scope.
 */
async function writeNew(path: string, content: string, io: ScaffoldIO, owned: string[]): Promise<boolean> {
  let handle: ScaffoldFileHandle
  try {
    handle = await io.open(path, 'wx')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
  owned.push(path)
  try {
    await handle.writeFile(content)
  } finally {
    await handle.close()
  }
  return true
}

/** Reject a path component that is a symlink or not a directory. */
async function inspectDirectory(path: string): Promise<'missing' | 'directory'> {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (info === undefined) return 'missing'
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('design folder path is not a plain directory: ' + path)
  }
  return 'directory'
}

/** Create one directory, tolerating a concurrent creator; never recurse. */
async function mkdirOnce(path: string): Promise<void> {
  try {
    await mkdir(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if ((await inspectDirectory(path)) !== 'directory') throw error
  }
}

/** Confirm a created directory still resolves inside the canonical cwd. */
async function canonicalChild(canonicalCwd: string, path: string): Promise<void> {
  const canonical = await realpath(path)
  if (canonical !== canonicalCwd && !canonical.startsWith(canonicalCwd + sep)) {
    throw new Error('design folder escapes the working directory: ' + path)
  }
}

/**
 * Scaffold a project under a working directory.
 *
 * Refusal is decided before side effects: the canonical cwd is resolved, the
 * folder is checked without following symlinks, and an existing config is
 * returned immediately. A new config is claimed with an exclusive create
 * before any other file, so concurrent calls cannot both scaffold.
 * @param cwd - session working directory.
 * @param options - folder name and the installed kit version to pin.
 */
export async function scaffoldProject(
  cwd: string,
  options: { folderName?: string; kitVersion: string; io?: ScaffoldIO },
): Promise<ScaffoldResult> {
  const io = options.io ?? nodeIO
  const folderName = normalizeFolderName(options.folderName ?? DEFAULT_DESIGN_FOLDER)
  const canonicalCwd = await realpath(cwd)
  const cwdInfo = await lstat(canonicalCwd)
  if (!cwdInfo.isDirectory()) throw new Error('working directory is not a directory: ' + cwd)
  const folder = resolve(canonicalCwd, folderName)
  const state = await inspectDirectory(folder)

  // Existing config refuses before creating or rewriting anything.
  const configPath = join(folder, 'design.json')
  const configInfo = await lstat(configPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (configInfo !== undefined) {
    if (configInfo.isSymbolicLink() || !configInfo.isFile()) {
      throw new Error('design.json is not a plain file: ' + configPath)
    }
    return {
      folder,
      created: [],
      existing: [folderName + '/design.json'],
      alreadyExists: true,
    }
  }

  if (state === 'missing') await mkdirOnce(folder)
  await canonicalChild(canonicalCwd, folder)

  // Reject an existing child conflict before claiming the project config.
  const screensDir = join(folder, 'screens')
  const screensState = await inspectDirectory(screensDir)

  const files: { path: string; content: string }[] = [
    {
      path: 'tokens.json',
      content: JSON.stringify(DEFAULT_TOKENS, null, 2) + '\n',
    },
    { path: 'screens/home.dsx', content: SAMPLE_SCREEN },
    { path: '.gitignore', content: '.cache/\n' },
  ]
  const created: string[] = []
  const existing: string[] = []
  const ownedPaths: string[] = []

  // Claim the config first; winning this exclusive create owns scaffolding.
  const configContent =
    JSON.stringify(
      {
        kitVersion: options.kitVersion,
        breakpoints: Object.fromEntries(DEFAULT_BREAKPOINTS.map(({ name, width }) => [name, width])),
        entry: 'home',
      },
      null,
      2,
    ) + '\n'
  try {
    const claimed = await writeNew(configPath, configContent, io, ownedPaths)
    if (!claimed) {
      return {
        folder,
        created: [],
        existing: [folderName + '/design.json'],
        alreadyExists: true,
      }
    }
    created.push(folderName + '/design.json')

    if (screensState === 'missing') await mkdirOnce(screensDir)
    await canonicalChild(canonicalCwd, screensDir)

    for (const file of files) {
      const path = join(folder, file.path)
      const written = await writeNew(path, file.content, io, ownedPaths)
      if (written) {
        created.push(folderName + '/' + file.path)
      } else {
        existing.push(folderName + '/' + file.path)
      }
    }
  } catch (error) {
    // Roll back only files this call created; pre-existing content stays.
    for (const path of ownedPaths.reverse()) await io.remove(path).catch(() => undefined)
    throw error
  }
  return { folder, created, existing, alreadyExists: false }
}
