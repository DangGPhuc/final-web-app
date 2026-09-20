#!/usr/bin/env node

/**
 * scripts/run-prisma-real-env.mjs
 *
 * Safe, explicit, zero-leak Prisma CLI runner for Phase 5 Real Environment operations.
 *
 * Enforces:
 * 1. Explicit loading of .env.local without relying on Prisma CLI auto-discovery.
 * 2. Fail-closed pre-validation: .env.local exists, DATABASE_URL is present, non-empty, and non-placeholder.
 * 3. Never leaks secrets: DATABASE_URL and credentials are NEVER printed or placed into command-line arguments.
 * 4. Whitelisted commands only: 'validate', 'generate', 'db push', 'studio'.
 * 5. Uses local installed Prisma dependency directly from node_modules.
 * 6. Propagates exit codes directly.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnvFile, validateDatabaseUrlForExecution } from './lib/local-env.mjs';

export const ALLOWED_PRISMA_COMMANDS = ['validate', 'generate', 'db push', 'studio'];

/**
 * Validates whether the supplied CLI arguments form an allowed Prisma operation.
 *
 * @param {string[]} args
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePrismaCommand(args) {
  if (!Array.isArray(args) || args.length === 0) {
    return {
      valid: false,
      error: 'No Prisma command specified. Allowed operations are: validate, generate, db push, studio.',
    };
  }

  const primary = args[0];

  if (primary === 'validate' || primary === 'generate' || primary === 'studio') {
    for (let i = 1; i < args.length; i++) {
      if (!args[i].startsWith('--')) {
        return {
          valid: false,
          error: `Unsupported argument "${args[i]}" for Prisma ${primary}. Only flags starting with "--" are allowed.`,
        };
      }
    }
    return { valid: true };
  }

  if (primary === 'db') {
    if (args[1] !== 'push') {
      return {
        valid: false,
        error: `Unsupported Prisma db subcommand "${args[1] || ''}". Only "db push" is permitted in Phase 5.`,
      };
    }
    for (let i = 2; i < args.length; i++) {
      if (!args[i].startsWith('--')) {
        return {
          valid: false,
          error: `Unsupported argument "${args[i]}" for Prisma db push. Only flags starting with "--" are allowed.`,
        };
      }
    }
    return { valid: true };
  }

  return {
    valid: false,
    error: `Unsupported Prisma command "${args.join(' ')}". Allowed operations are: validate, generate, db push, studio.`,
  };
}

/**
 * Executes a whitelisted Prisma command in the Phase-5 real local environment.
 *
 * @param {string[]} args CLI arguments passed to Prisma
 * @param {object} [options] Optional overrides for testing
 * @returns {Promise<{ exitCode: number, error?: string }>}
 */
export async function runPrismaRealEnv(args, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const envLocalPath = options.envLocalPath || path.join(rootDir, '.env.local');

  // 1. Whitelist command validation
  const cmdValidation = validatePrismaCommand(args);
  if (!cmdValidation.valid) {
    return { exitCode: 1, error: cmdValidation.error };
  }

  // 2. Fail closed if .env.local does not exist
  if (!fs.existsSync(envLocalPath)) {
    return {
      exitCode: 1,
      error: `.env.local file not found at ${envLocalPath}. Phase-5 local execution requires a configured .env.local file.`,
    };
  }

  // 3. Parse .env.local privately
  const localEnv = parseEnvFile(envLocalPath);

  // 4. Fail closed if DATABASE_URL is missing, empty, or placeholder
  const dbUrl = localEnv.DATABASE_URL;
  if (!dbUrl) {
    return {
      exitCode: 1,
      error: 'DATABASE_URL is missing in .env.local.',
    };
  }
  if (dbUrl.trim() === '') {
    return {
      exitCode: 1,
      error: 'DATABASE_URL in .env.local is empty.',
    };
  }

  const dbValidation = validateDatabaseUrlForExecution(dbUrl);
  if (!dbValidation.valid) {
    return {
      exitCode: 1,
      error: dbValidation.error,
    };
  }

  // 5. Verify local Prisma CLI binary in node_modules
  const defaultPrismaEntry = path.join(rootDir, 'node_modules', 'prisma', 'build', 'index.js');
  const prismaCliPath = options.prismaCliPath || defaultPrismaEntry;

  if (!options.skipCliCheck && !fs.existsSync(prismaCliPath)) {
    return {
      exitCode: 1,
      error: `Local Prisma CLI not found at ${prismaCliPath}. Ensure node_modules are installed.`,
    };
  }

  // Hook for mocking process execution in tests
  if (options.spawnFn) {
    return options.spawnFn({
      args,
      childEnv: { ...process.env, ...localEnv },
      prismaCliPath,
    });
  }

  // 6. Execute local Prisma CLI with merged environment (DATABASE_URL passed strictly in env, never in CLI args)
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [prismaCliPath, ...args], {
      cwd: rootDir,
      env: {
        ...process.env,
        ...localEnv,
      },
      stdio: options.stdio || 'inherit',
    });

    child.on('error', (err) => {
      resolve({
        exitCode: 1,
        error: `Failed to spawn Prisma CLI: ${err.message}`,
      });
    });

    child.on('close', (code, signal) => {
      resolve({ exitCode: signal ? 1 : (code ?? 0) });
    });
  });
}

// Direct CLI invocation
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const args = process.argv.slice(2);
  runPrismaRealEnv(args)
    .then((result) => {
      if (result.error) {
        console.error(`[prisma-real-env] Error: ${result.error}`);
      }
      process.exit(result.exitCode ?? 0);
    })
    .catch((err) => {
      console.error(`[prisma-real-env] Unexpected error: ${err?.message || err}`);
      process.exit(1);
    });
}
