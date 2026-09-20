import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  runPrismaRealEnv,
  validatePrismaCommand,
} from '../scripts/run-prisma-real-env.mjs';

describe('Phase 5 Real-Environment Prisma Runner', () => {
  describe('Command Whitelist Validation', () => {
    it('accepts supported Prisma commands: validate, generate, db push, studio', () => {
      expect(validatePrismaCommand(['validate']).valid).toBe(true);
      expect(validatePrismaCommand(['generate']).valid).toBe(true);
      expect(validatePrismaCommand(['db', 'push']).valid).toBe(true);
      expect(validatePrismaCommand(['db', 'push', '--accept-data-loss']).valid).toBe(true);
      expect(validatePrismaCommand(['studio']).valid).toBe(true);
    });

    it('rejects unsupported Prisma commands and destructive operations', () => {
      // Destructive / unwhitelisted operations
      expect(validatePrismaCommand(['db', 'drop']).valid).toBe(false);
      expect(validatePrismaCommand(['migrate', 'reset']).valid).toBe(false);
      expect(validatePrismaCommand(['migrate', 'dev']).valid).toBe(false);
      expect(validatePrismaCommand(['format']).valid).toBe(false);
      expect(validatePrismaCommand(['sh']).valid).toBe(false);
      expect(validatePrismaCommand([]).valid).toBe(false);

      // Error message gives clear guidance without leaking
      const res = validatePrismaCommand(['db', 'drop']);
      expect(res.error).toContain('Only "db push" is permitted');
    });
  });

  describe('Fail-Closed Environment & Secret Validation', () => {
    it('fails closed when .env.local does not exist', async () => {
      const nonExistentPath = path.join(os.tmpdir(), `non_existent_env_${Date.now()}`);
      const result = await runPrismaRealEnv(['validate'], {
        envLocalPath: nonExistentPath,
        skipCliCheck: true,
      });

      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('.env.local file not found');
    });

    it('fails closed when DATABASE_URL is missing in .env.local', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-test-'));
      const envPath = path.join(tempDir, '.env.local');
      fs.writeFileSync(envPath, 'POSTGRES_USER=fintrack\nPOSTGRES_DB=personal_finance\n');

      try {
        const result = await runPrismaRealEnv(['validate'], {
          envLocalPath: envPath,
          skipCliCheck: true,
        });

        expect(result.exitCode).toBe(1);
        expect(result.error).toContain('DATABASE_URL is missing');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('fails closed when DATABASE_URL is empty', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-test-'));
      const envPath = path.join(tempDir, '.env.local');
      fs.writeFileSync(envPath, 'DATABASE_URL="   "\n');

      try {
        const result = await runPrismaRealEnv(['validate'], {
          envLocalPath: envPath,
          skipCliCheck: true,
        });

        expect(result.exitCode).toBe(1);
        expect(result.error).toContain('DATABASE_URL in .env.local is empty');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('fails closed when DATABASE_URL contains placeholder values', async () => {
      const placeholders = [
        'postgresql://fintrack:<same_local_random_password>@127.0.0.1:5432/personal_finance',
        'postgresql://user:password@localhost:5432/db',
        'postgresql://fintrack:replace_with_password@127.0.0.1:5432/personal_finance',
        'postgresql://fintrack:<your_generated_postgres_password>@127.0.0.1:5432/personal_finance',
      ];

      for (const ph of placeholders) {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-test-'));
        const envPath = path.join(tempDir, '.env.local');
        fs.writeFileSync(envPath, `DATABASE_URL="${ph}"\n`);

        try {
          const result = await runPrismaRealEnv(['validate'], {
            envLocalPath: envPath,
            skipCliCheck: true,
          });

          expect(result.exitCode).toBe(1);
          expect(result.error).toContain('placeholder');
          // Crucial: placeholder or password string must NEVER be echoed in the error
          expect(result.error).not.toContain(ph);
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });

    it('successfully executes mock spawn with non-leaking diagnostics for valid configuration', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-test-'));
      const envPath = path.join(tempDir, '.env.local');
      const realSecretPassword = 'super_random_hex_secret_password_123456';
      fs.writeFileSync(
        envPath,
        `POSTGRES_USER=fintrack\n` +
        `POSTGRES_PASSWORD=${realSecretPassword}\n` +
        `DATABASE_URL=postgresql://fintrack:${realSecretPassword}@127.0.0.1:5432/personal_finance\n`
      );

      const spawnMock = vi.fn().mockReturnValue({ exitCode: 0 });

      try {
        const result = await runPrismaRealEnv(['db', 'push'], {
          envLocalPath: envPath,
          skipCliCheck: true,
          spawnFn: spawnMock,
        });

        expect(result.exitCode).toBe(0);
        expect(spawnMock).toHaveBeenCalledTimes(1);

        const callArg = spawnMock.mock.calls[0][0];
        // 1. Arguments passed to Prisma must NOT contain DATABASE_URL or password
        expect(callArg.args).toEqual(['db', 'push']);
        for (const arg of callArg.args) {
          expect(arg).not.toContain(realSecretPassword);
          expect(arg).not.toContain('DATABASE_URL');
        }

        // 2. Child process environment receives DATABASE_URL privately
        expect(callArg.childEnv.DATABASE_URL).toBe(
          `postgresql://fintrack:${realSecretPassword}@127.0.0.1:5432/personal_finance`
        );

        // 3. Any potential error property is undefined and never contains secret
        expect(result.error).toBeUndefined();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('ensures no secret value ever appears in runner diagnostics', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-test-'));
      const envPath = path.join(tempDir, '.env.local');
      const sensitivePassword = 'ultra_secret_db_password_never_to_be_printed';
      // Deliberately malformed URL protocol to trigger an error
      fs.writeFileSync(
        envPath,
        `DATABASE_URL=redis://fintrack:${sensitivePassword}@127.0.0.1:5432/personal_finance\n`
      );

      try {
        const result = await runPrismaRealEnv(['validate'], {
          envLocalPath: envPath,
          skipCliCheck: true,
        });

        expect(result.exitCode).toBe(1);
        expect(result.error).toBeDefined();
        expect(result.error).not.toContain(sensitivePassword);
        expect(result.error).not.toContain('redis://');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
