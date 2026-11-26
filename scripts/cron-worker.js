/**
 * JOBFOUNDS Production Node.js 22 Cron Worker Entry Point (Hostinger Unlimited)
 * ----------------------------------------------------------------------------
 * Executed by `npm run cron:tick` (`node scripts/cron-worker.js`).
 * - Uses precompiled `dist-server/cron-worker.mjs` when `npm run build` has run.
 * - Automatically compiles `scripts/cron-worker.ts` via esbuild if missing or stale.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..');
const DIST_SERVER_DIR = path.join(PROJECT_ROOT, 'dist-server');
const COMPILED_CRON_PATH = path.join(DIST_SERVER_DIR, 'cron-worker.mjs');
const SOURCE_CRON_PATH = path.join(PROJECT_ROOT, 'scripts', 'cron-worker.ts');

process.env.JOBFOUNDS_PROJECT_ROOT = PROJECT_ROOT;

function getLatestCronSourceMtimeMs() {
  let latest = 0;
  try {
    if (fs.existsSync(SOURCE_CRON_PATH)) {
      latest = fs.statSync(SOURCE_CRON_PATH).mtimeMs;
    }
    const entries = fs.readdirSync(PROJECT_ROOT);
    for (const name of entries) {
      if (/^server[A-Za-z0-9_-]*\.ts$/.test(name)) {
        const mtime = fs.statSync(path.join(PROJECT_ROOT, name)).mtimeMs;
        if (mtime > latest) latest = mtime;
      }
    }
  } catch {
    // ignore scan errors
  }
  return latest;
}

async function ensureCronBundle() {
  const needsBuild =
    !fs.existsSync(COMPILED_CRON_PATH) ||
    fs.statSync(COMPILED_CRON_PATH).mtimeMs < getLatestCronSourceMtimeMs();

  if (!needsBuild) return;

  fs.mkdirSync(DIST_SERVER_DIR, { recursive: true });
  const { build } = await import('esbuild');
  await build({
    entryPoints: [SOURCE_CRON_PATH],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    target: 'node22',
    outfile: COMPILED_CRON_PATH,
  });
}

async function bootstrap() {
  await ensureCronBundle();
  await import(pathToFileURL(COMPILED_CRON_PATH).href);
}

bootstrap().catch((err) => {
  console.error('[JOBFOUNDS] Fatal error starting scripts/cron-worker.js:', err);
  process.exit(1);
});
