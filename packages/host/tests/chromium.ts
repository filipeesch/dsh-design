import { access, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export async function findChromium(): Promise<string | undefined> {
  if (process.env.DSH_DESIGN_CHROMIUM_PATH !== undefined) return process.env.DSH_DESIGN_CHROMIUM_PATH
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH !== undefined) return process.env.PLAYWRIGHT_CHROMIUM_PATH
  const roots = [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')]
  const candidates = [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-linux/chrome',
    'chrome-linux64/chrome',
  ]
  for (const root of roots) {
    let entries: string[]
    try {
      entries = await readdir(root)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.startsWith('chromium-')) continue
      for (const candidate of candidates) {
        const path = join(root, entry, candidate)
        try {
          await access(path)
          return path
        } catch {
          // Try the next layout.
        }
      }
    }
  }
  return undefined
}
