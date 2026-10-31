import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 3000,
    fileParallelism: false,

    typecheck: {
      enabled: true,
      tsconfig: 'packages/live/tsconfig.json',
    },
  }
})
