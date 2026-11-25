import { readdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'

const roots = ['packages', 'scripts', 'tests', 'openspec']
const extensions = new Set(['.ts', '.tsx', '.mjs', '.js', '.json', '.md', '.yml', '.yaml'])
const failures = []

async function walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === '.cache') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await walk(path)
    else if (extensions.has(extname(entry.name))) {
      const text = await readFile(path, 'utf8')
      if (text.length > 0 && !text.endsWith('\n')) failures.push(path)
    }
  }
}

for (const root of roots) await walk(root)
if (failures.length > 0) {
  console.error('Missing EOF newline:')
  for (const path of failures) console.error(`  ${path}`)
  process.exit(1)
}
console.log('All text files end with a newline.')
