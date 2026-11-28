/**
 * JOBFOUNDS Post-Install Production Build Hook
 * --------------------------------------------
 * Ensures that when Hostinger pulls new commits from GitHub and runs `npm install`,
 * both the React frontend (`dist/`) and the Node.js 22 server bundle (`dist-server/`)
 * are freshly compiled during the deployment phase — even if Hostinger's Build command
 * is left empty.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..');

async function main() {
  if (process.env.JOBFOUNDS_SKIP_POSTINSTALL_BUILD === '1') {
    return;
  }

  const serverEntry = path.join(PROJECT_ROOT, 'server.ts');
  const clientEntry = path.join(PROJECT_ROOT, 'index.html');
  if (!fs.existsSync(serverEntry) || !fs.existsSync(clientEntry)) {
    return;
  }

  // 1. Build server + cron worker bundles via esbuild
  try {
    const { build: esbuild } = await import('esbuild');
    const distServerDir = path.join(PROJECT_ROOT, 'dist-server');
    fs.mkdirSync(distServerDir, { recursive: true });
    await esbuild({
      entryPoints: [serverEntry],
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      target: 'node22',
      outfile: path.join(distServerDir, 'server.mjs'),
    });
    const cronEntry = path.join(PROJECT_ROOT, 'scripts', 'cron-worker.ts');
    if (fs.existsSync(cronEntry)) {
      await esbuild({
        entryPoints: [cronEntry],
        bundle: true,
        platform: 'node',
        format: 'esm',
        packages: 'external',
        target: 'node22',
        outfile: path.join(distServerDir, 'cron-worker.mjs'),
      });
    }
    console.log('[JOBFOUNDS postinstall] Server bundles compiled cleanly.');
  } catch (err) {
    console.warn(
      '[JOBFOUNDS postinstall] Server bundle build skipped:',
      err instanceof Error ? err.message : String(err)
    );
  }

  // 2. Build React frontend via Vite in-process (avoids child-process limits on shared hosting)
  try {
    const { build: viteBuild } = await import('vite');
    await viteBuild({
      root: PROJECT_ROOT,
      mode: 'production',
      logLevel: 'warn',
    });
    console.log('[JOBFOUNDS postinstall] Frontend dist/ compiled cleanly.');
  } catch (err) {
    console.warn(
      '[JOBFOUNDS postinstall] Frontend build skipped:',
      err instanceof Error ? err.message : String(err)
    );
  }
}

main().catch((err) => {
  console.warn(
    '[JOBFOUNDS postinstall] Non-fatal error:',
    err instanceof Error ? err.message : String(err)
  );
});
