#!/usr/bin/env node
/**
 * FinTrack Evidence Verification Manifest.
 *
 * Non-destructive audit script that computes and prints actual, verifiable evidence:
 * - Current full Git SHA
 * - Current Git branch
 * - Working tree status (clean/dirty)
 * - Tracked test files (git ls-files 'tests/*.test.ts')
 * - Tracked migration files (git ls-files 'db/migrations/*.sql')
 * - Package test scripts (package.json)
 * - Node and npm versions
 *
 * Invariant: Must NOT fabricate command results or file paths.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function runGit(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  } catch (err) {
    return `ERROR: ${err.message}`;
  }
}

console.log('============================================================');
console.log('FINTRACK VERIFICATION EVIDENCE MANIFEST');
console.log('============================================================\n');

// 1. Git Coordinates
const fullSha = runGit('git rev-parse HEAD');
const branch = runGit('git branch --show-current');
const porcelain = runGit('git status --porcelain');
const isClean = porcelain.length === 0;

console.log('--- 1. Git State ---');
console.log(`Current Full SHA : ${fullSha}`);
console.log(`Current Branch   : ${branch}`);
console.log(`Working Tree     : ${isClean ? 'CLEAN (0 uncommitted changes)' : 'DIRTY:\n' + porcelain}`);
console.log('');

// 2. Tracked Test Files
const testFilesRaw = runGit("git ls-files 'tests/*.test.ts'");
const testFiles = testFilesRaw ? testFilesRaw.split('\n').filter(Boolean) : [];

console.log(`--- 2. Tracked Test Files (${testFiles.length}) ---`);
for (const file of testFiles) {
  console.log(`  - ${file}`);
}
console.log('');

// 3. Tracked Migration Files
const migrationFilesRaw = runGit("git ls-files 'db/migrations/*.sql'");
const migrationFiles = migrationFilesRaw ? migrationFilesRaw.split('\n').filter(Boolean) : [];

console.log(`--- 3. Tracked Migration Files (${migrationFiles.length}) ---`);
for (const file of migrationFiles) {
  console.log(`  - ${file}`);
}
console.log('');

// 4. Package Test Scripts
const pkgJsonPath = path.join(ROOT_DIR, 'package.json');
const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));

console.log('--- 4. Package Test Scripts ---');
for (const [key, script] of Object.entries(pkg.scripts || {})) {
  if (key.includes('test') || key.includes('verify') || key.includes('typecheck')) {
    console.log(`  "${key}": "${script}"`);
  }
}
console.log('');

// 5. Runtime Versions
let npmVersion = 'unknown';
try {
  npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
} catch {}

console.log('--- 5. Runtime Environment ---');
console.log(`Node Version : ${process.version}`);
console.log(`npm Version  : ${npmVersion}`);
console.log('\n============================================================');
