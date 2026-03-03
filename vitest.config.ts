import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 3000,
    fileParallelism: false,
  }
})
