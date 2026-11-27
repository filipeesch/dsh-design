/** Confine generated files to plain directories in the design cache. */
import { lstat, mkdir, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

class DesignCacheError extends Error {
  constructor(
    readonly code: 'unsafe-cache' | 'invalid-area',
    message: string,
  ) {
    super(message)
    this.name = 'DesignCacheError'
  }
}

function assertArea(area: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(area)) {
    throw new DesignCacheError('invalid-area', 'Invalid design cache area "' + area + '".')
  }
}

/** Validate one cache component, creating it as a plain directory when absent. */
async function ensureCacheComponent(path: string, expected: string): Promise<string> {
  let info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (info === undefined) {
    try {
      await mkdir(path, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    info = await lstat(path)
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new DesignCacheError(
      'unsafe-cache',
      'The design cache component "' + path + '" must be a plain directory; refusing to write.',
    )
  }
  const real = await realpath(path)
  if (real !== expected) {
    throw new DesignCacheError(
      'unsafe-cache',
      'The design cache resolves outside its canonical location; refusing to write.',
    )
  }
  return real
}

/** Canonical area inside the ignored design cache. */
export async function cacheAreaDirectory(folder: string, area: string): Promise<string> {
  assertArea(area)
  const realFolder = await realpath(folder)
  const cache = resolve(realFolder, '.cache')
  await ensureCacheComponent(cache, cache)
  const directory = resolve(cache, area)
  await ensureCacheComponent(directory, directory)
  return directory
}

/** Revalidate a canonical cache area immediately before publication. */
export async function revalidateCacheArea(folder: string, area: string, directory: string): Promise<string> {
  assertArea(area)
  const realFolder = await realpath(folder)
  const expected = resolve(realFolder, '.cache', area)
  if (directory !== expected)
    throw new DesignCacheError('unsafe-cache', 'The cache path is not canonical; refusing to write.')
  const cacheInfo = await lstat(resolve(realFolder, '.cache')).catch(() => undefined)
  if (cacheInfo === undefined || cacheInfo.isSymbolicLink() || !cacheInfo.isDirectory())
    throw new DesignCacheError('unsafe-cache', 'The design cache is no longer a plain directory; refusing to write.')
  const info = await lstat(directory).catch(() => undefined)
  if (info === undefined || info.isSymbolicLink() || !info.isDirectory()) {
    throw new DesignCacheError('unsafe-cache', 'The cache area is no longer a plain directory; refusing to write.')
  }
  const real = await realpath(directory)
  if (real !== expected) {
    throw new DesignCacheError(
      'unsafe-cache',
      'The cache area resolves outside its canonical location; refusing to write.',
    )
  }
  return real
}
