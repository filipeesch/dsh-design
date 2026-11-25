import { defineConfig } from 'vitest/config'

const source = (path: string): string => new URL(path, import.meta.url).pathname

export default defineConfig({
  test: {
    include: ['packages/**/tests/**/*.spec.ts', 'packages/**/tests/**/*.spec.tsx'],
    environment: 'node',
    passWithNoTests: true,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@deepseek-ai/dsh-tools': source('./tests/shims/dsh-tools.ts'),
      '@deepseek-ai/dsh-llm': source('./tests/shims/dsh-llm.ts'),
      '@deepseek-ai/cordis': source('./tests/shims/cordis.ts'),
      '@filipeesch/dsh-design-core': source('./packages/core/src/index.ts'),
      '@filipeesch/dsh-design-kit/meta': source('./packages/kit/src/meta.ts'),
      '@filipeesch/dsh-design-kit': source('./packages/kit/src/index.ts'),
    },
  },
})
