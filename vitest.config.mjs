import { defineConfig } from 'vitest/config';
import path from 'path';
import { parseEnvFile } from './scripts/lib/local-env.mjs';

// When running Vitest locally, if DATABASE_URL is not already exported into the shell,
// load from .env.local (and fallback .env) so local test execution works seamlessly.
if (!process.env.DATABASE_URL) {
  const root = import.meta.dirname;
  const envLocalPath = path.join(root, '.env.local');
  const envBasePath = path.join(root, '.env');
  const loaded = {
    ...parseEnvFile(envBasePath),
    ...parseEnvFile(envLocalPath),
  };
  for (const [k, v] of Object.entries(loaded)) {
    if (!process.env[k]) {
      process.env[k] = v;
    }
  }
}

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    fileParallelism: false,
  },
});
