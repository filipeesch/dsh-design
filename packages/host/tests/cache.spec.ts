import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cacheAreaDirectory, revalidateCacheArea } from '../src/cache.ts'

const projects: string[] = []
async function directory() {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'dsh-design-cache-')))
  projects.push(folder)
  return folder
}
afterEach(async () => {
  await Promise.all(projects.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

describe('confined design cache', () => {
  it('creates the screenshot area without migrating or removing historic exports', async () => {
    const folder = await directory()
    const legacy = join(folder, '.cache', 'handoff', 'old-package')
    await mkdir(legacy, { recursive: true })
    await writeFile(join(legacy, 'manifest.json'), '{"legacy":true}')
    const area = await cacheAreaDirectory(folder, 'screenshots')
    expect(area).toBe(join(folder, '.cache', 'screenshots'))
    await expect(revalidateCacheArea(folder, 'screenshots', area)).resolves.toBe(area)
    await expect(readFile(join(legacy, 'manifest.json'), 'utf8')).resolves.toBe('{"legacy":true}')
  })

  it('rejects traversal and substituted directories before writing', async () => {
    const folder = await directory()
    const outside = await directory()
    await expect(cacheAreaDirectory(folder, '../outside')).rejects.toMatchObject({ code: 'invalid-area' })
    const area = await cacheAreaDirectory(folder, 'screenshots')
    await rename(join(folder, '.cache'), join(folder, 'previous-cache'))
    await symlink(outside, join(folder, '.cache'))
    await expect(revalidateCacheArea(folder, 'screenshots', area)).rejects.toMatchObject({ code: 'unsafe-cache' })
    await expect(cacheAreaDirectory(folder, 'screenshots')).rejects.toMatchObject({ code: 'unsafe-cache' })
    await expect(readdir(outside)).resolves.toEqual([])
  })
})
