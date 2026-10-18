#!/usr/bin/env node
/* global process, console */

import { readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultConfigPath = resolve(projectRoot, 'svelte.config.js');
const staticConfigPath = resolve(projectRoot, 'svelte.config.static.js');

async function readConfigs() {
  const [original, staticConfig] = await Promise.all([
    readFile(defaultConfigPath, 'utf-8'),
    readFile(staticConfigPath, 'utf-8')
  ]);

  return { original, staticConfig };
}

async function restore(original) {
  await writeFile(defaultConfigPath, original, 'utf-8');
}

async function main() {
  const { original, staticConfig } = await readConfigs();

  try {
    await writeFile(defaultConfigPath, staticConfig, 'utf-8');
    execSync('pnpm exec vite build', {
      cwd: projectRoot,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' }
    });
    console.log('[build:static] Static build complete.');
  } finally {
    await restore(original);
  }
}

main().catch((error) => {
  console.error('[build:static] Build failed:', error);
  process.exit(1);
});
