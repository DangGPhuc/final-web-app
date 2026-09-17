import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      'server-only': path.resolve(import.meta.dirname, './tests/mocks/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    fileParallelism: false,
  },
});
