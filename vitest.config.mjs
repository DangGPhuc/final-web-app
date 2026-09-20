import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    fileParallelism: false,
    globalSetup: ['./scripts/lib/vitest-global-setup.mjs'],
    setupFiles: ['./scripts/lib/vitest-setup.mjs'],
  },
});
