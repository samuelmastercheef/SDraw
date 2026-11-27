import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@core': resolve('src/core') } },
  test: { include: ['src/core/**/*.test.ts', 'src/main/**/*.test.ts'] }
})
