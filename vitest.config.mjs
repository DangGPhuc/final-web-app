import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      'server-only': 'server-only/empty.js',
    },
  },
  test: {
    environment: 'node',
  },
});
