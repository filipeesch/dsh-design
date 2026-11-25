import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { PackageError, publishPackage, sealManifest, verifyPackage } from '../src/cache.ts'

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cache-'))
  const design = join(root, 'design')
  await mkdir(design, { recursive: true })
  await writeFile(join(design, 'design.json'), '{}')
  return design
}

async function packageFiles(design: string, files: Record<string, string> = { 'README.md': 'hello\n' }) {
  const manifest = sealManifest({ format: 'dsh-design-test/v1' }, files)
  return { manifest, files, id: manifest.id, design }
}

describe('confined content-addressed cache', () => {
  it('publishes, verifies, and reuses one package', async () => {
    const design = await project()
    const sealed = await packageFiles(design)
    const first = await publishPackage({ folder: design, area: 'handoff', ...sealed })
    expect(first.reused).toBe(false)
    expect(first.path).toMatch(/[a-f0-9]{64}$/)
    const manifest = await verifyPackage(first.path)
    expect(manifest.format).toBe('dsh-design-test/v1')
    expect(manifest.files).toHaveLength(1)
    expect(await readFile(join(first.path, 'README.md'), 'utf8')).toBe('hello\n')
    const second = await publishPackage({ folder: design, area: 'handoff', ...sealed })
    expect(second.reused).toBe(true)
    expect(second.path).toBe(first.path)
  })

  it('refuses to reuse a package whose file no longer matches its manifest', async () => {
    const design = await project()
    const sealed = await packageFiles(design)
    const published = await publishPackage({ folder: design, area: 'handoff', ...sealed })
    await writeFile(join(published.path, 'README.md'), 'tampered\n')
    await expect(publishPackage({ folder: design, area: 'handoff', ...sealed })).rejects.toMatchObject({
      code: 'package-invalid',
    })
  })

  it('refuses a partial target with no completed manifest', async () => {
    const design = await project()
    const sealed = await packageFiles(design)
    const published = await publishPackage({ folder: design, area: 'handoff', ...sealed })
    await import('node:fs/promises').then((fs) => fs.rm(join(published.path, 'manifest.json')))
    await expect(publishPackage({ folder: design, area: 'handoff', ...sealed })).rejects.toMatchObject({
      code: 'package-invalid',
    })
  })

  it('removes staging when a publication fails before rename', async () => {
    const design = await project()
    const sealed = await packageFiles(design, { a: 'x', 'a/b': 'y' })
    await expect(publishPackage({ folder: design, area: 'capture', ...sealed })).rejects.toThrow()
    await expect(readdir(join(design, '.cache', 'capture'))).resolves.toEqual(['.staging'])
    await expect(readdir(join(design, '.cache', 'capture', '.staging'))).resolves.toEqual([])
  })

  it('cancels before publication and late during staging without exposing a package', async () => {
    const design = await project()
    const sealed = await packageFiles(design, { 'a.txt': 'a', 'b.txt': 'b' })
    const already = new AbortController()
    already.abort()
    await expect(
      publishPackage({ folder: design, area: 'capture', ...sealed, signal: already.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' })
    await expect(readdir(join(design, '.cache', 'capture'))).rejects.toThrow()

    const late = new AbortController()
    const files = {}
    Object.defineProperty(files, 'a.txt', { enumerable: true, get: () => Buffer.from('a') })
    Object.defineProperty(files, 'b.txt', {
      enumerable: true,
      get: () => {
        late.abort()
        return Buffer.from('b')
      },
    })
    await expect(
      publishPackage({ folder: design, area: 'capture', ...sealed, files, signal: late.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' })
    await expect(readdir(join(design, '.cache', 'capture'))).resolves.toEqual(['.staging'])
    await expect(readdir(join(design, '.cache', 'capture', '.staging'))).resolves.toEqual([])
  })

  it('publishes one verified package when two writers race for the same id', async () => {
    const design = await project()
    const sealed = await packageFiles(design, { 'README.md': 'race\n' })
    const results = await Promise.all([
      publishPackage({ folder: design, area: 'handoff', ...sealed }),
      publishPackage({ folder: design, area: 'handoff', ...sealed }),
    ])
    expect(results[0]!.path).toBe(results[1]!.path)
    expect(results.filter((result) => !result.reused)).toHaveLength(1)
    const manifest = await verifyPackage(results[0]!.path)
    expect(manifest.id).toBe(sealed.id)
    expect(await readFile(join(results[0]!.path, 'README.md'), 'utf8')).toBe('race\n')
  })

  it('refuses unsafe paths and symlinked cache components', async () => {
    const design = await project()
    for (const path of ['../escape', '/absolute', 'a//b', 'a/../b']) {
      expect(() => sealManifest({ format: 'dsh-design-test/v1' }, { [path]: 'x' })).toThrow(PackageError)
    }
    const outside = await mkdtemp(join(tmpdir(), 'dsh-cache-outside-'))
    await mkdir(join(design, '.cache'), { recursive: true })
    await symlink(outside, join(design, '.cache', 'capture'))
    const sealed = await packageFiles(design)
    await expect(publishPackage({ folder: design, area: 'capture', ...sealed })).rejects.toMatchObject({
      code: 'unsafe-cache',
    })
    await expect(readdir(outside)).resolves.toEqual([])
  })
})
