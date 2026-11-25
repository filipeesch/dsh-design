import { mkdir, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const destination = resolve(root, 'dist')
await rm(destination, { recursive: true, force: true })
await mkdir(destination, { recursive: true })
execFileSync('pnpm', ['--dir', resolve(root, 'packages/bundle'), 'pack', '--pack-destination', destination], {
  stdio: 'inherit',
})
console.log('Packed bundle into ' + destination)
