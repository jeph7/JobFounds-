/**
 * JOBFOUNDS Production Node.js 22 Entry Point (Hostinger Unlimited)
 * -----------------------------------------------------------------
 * Executed directly by Hostinger (`Entry file: server.js`) or `npm start`.
 * - Automatically detects when GitHub pulls newer server (`server*.ts`) or
 *   frontend (`src/`, `index.html`, `vite.config.ts`) files than the compiled
 *   `dist-server/server.mjs` or `dist/index.html` bundles.
 * - Compiles in-process via esbuild & Vite (no child-process fork limits on
 *   Hostinger/CloudLinux Passenger) so live deployments on jobfounds.com ALWAYS
 *   serve the latest frontend and backend code.
 */
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
      if (/^server[A-Za-z0-9_-]*\.ts$/.test(name) || name === 'package.json') {
        const mtime = fs.statSync(path.join(PROJECT_ROOT, name)).mtimeMs;
        if (mtime > latest) latest = mtime;
      }
    }
  } catch {
    // ignore scan errors
  }
  return latest;
}

function getLatestMtimeRecursive(dirPath, maxDepth = 6) {
  let latest = 0;
  if (maxDepth < 0 || !fs.existsSync(dirPath)) return 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const sub = getLatestMtimeRecursive(fullPath, maxDepth - 1);
        if (sub > latest) latest = sub;
      } else if (entry.isFile()) {
        const mtime = fs.statSync(fullPath).mtimeMs;
        if (mtime > latest) latest = mtime;
      }
    }
  } catch {
    // ignore scan errors
  }
  return latest;
}

function getLatestClientSourceMtimeMs() {
  let latest = getLatestMtimeRecursive(path.join(PROJECT_ROOT, 'src'));
  for (const file of ['index.html', 'vite.config.ts', 'package.json']) {
    const full = path.join(PROJECT_ROOT, file);
    try {
      if (fs.existsSync(full)) {
        const mtime = fs.statSync(full).mtimeMs;
        if (mtime > latest) latest = mtime;
      }
    } catch {
      // ignore
    }
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
  const distExists = fs.existsSync(DIST_INDEX_PATH);
  const distMtime = distExists ? fs.statSync(DIST_INDEX_PATH).mtimeMs : 0;
  const latestSrcMtime = getLatestClientSourceMtimeMs();
  const needsBuild = !distExists || distMtime + 1500 < latestSrcMtime;

  if (!needsBuild) return;

  try {
    console.log(
      distExists
        ? '[JOBFOUNDS] Newer frontend source files detected — rebuilding dist/ automatically...'
        : '[JOBFOUNDS] dist/index.html missing — building frontend bundle automatically...'
    );
    const { build } = await import('vite');
    await build({
      root: PROJECT_ROOT,
      mode: 'production',
      logLevel: 'warn',
    });
    delete process.env.JOBFOUNDS_CLIENT_BUILD_ERROR;
    console.log('[JOBFOUNDS] Frontend bundle built successfully.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.env.JOBFOUNDS_CLIENT_BUILD_ERROR = msg.slice(0, 300);
    console.warn(
      '[JOBFOUNDS] Automatic frontend build skipped/failed (API server will still start):',
      msg
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
