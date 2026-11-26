/**
 * JOBFOUNDS Production Node.js 22 Entry Point (Hostinger Unlimited)
 * -----------------------------------------------------------------
 * Executed directly by Hostinger (`Entry file: server.js`) or `npm start`.
 * - Uses precompiled `dist-server/server.mjs` when `npm run build` has already run.
 * - Automatically compiles `server.ts` -> `dist-server/server.mjs` via esbuild
 *   (and builds the React frontend `dist/` via Vite if missing) when Hostinger
 *   deploys with `Build command: none`.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.dirname(__filename);
const DIST_SERVER_DIR = path.join(PROJECT_ROOT, 'dist-server');
const COMPILED_SERVER_PATH = path.join(DIST_SERVER_DIR, 'server.mjs');
const DIST_INDEX_PATH = path.join(PROJECT_ROOT, 'dist', 'index.html');

process.env.JOBFOUNDS_PROJECT_ROOT = PROJECT_ROOT;
process.env.JOBFOUNDS_COMPILED_ENTRY = '1';

function getLatestServerSourceMtimeMs() {
  let latest = 0;
  try {
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

async function ensureServerBundle() {
  const needsBuild =
    !fs.existsSync(COMPILED_SERVER_PATH) ||
    fs.statSync(COMPILED_SERVER_PATH).mtimeMs < getLatestServerSourceMtimeMs();

  if (!needsBuild) return;

  fs.mkdirSync(DIST_SERVER_DIR, { recursive: true });
  const { build } = await import('esbuild');
  await build({
    entryPoints: [path.join(PROJECT_ROOT, 'server.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    target: 'node22',
    outfile: COMPILED_SERVER_PATH,
  });
}

async function ensureClientBundle() {
  if (fs.existsSync(DIST_INDEX_PATH)) return;

  try {
    console.log('[JOBFOUNDS] dist/index.html missing — building frontend bundle automatically...');
    const viteCliPath = path.join(PROJECT_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
    if (fs.existsSync(viteCliPath)) {
      execFileSync(process.execPath, [viteCliPath, 'build'], {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
        env: process.env,
      });
    } else {
      const { build } = await import('vite');
      await build({
        root: PROJECT_ROOT,
        logLevel: 'warn',
      });
    }
    console.log('[JOBFOUNDS] Frontend bundle built successfully.');
  } catch (err) {
    console.warn(
      '[JOBFOUNDS] Automatic frontend build skipped/failed (API server will still start):',
      err instanceof Error ? err.message : String(err)
    );
  }
}

async function bootstrap() {
  await ensureServerBundle();
  await ensureClientBundle();
  await import(pathToFileURL(COMPILED_SERVER_PATH).href);
}

bootstrap().catch((err) => {
  console.error('[JOBFOUNDS] Fatal error starting server.js:', err);
  process.exit(1);
});
