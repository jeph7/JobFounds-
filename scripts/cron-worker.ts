import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {
  closeEngineDb,
  createEngineDbBackup,
  getEngineDb,
  listEngineDbBackups,
  resolveEngineDataDir,
} from '../serverEngineDb.ts';
import { runCronBatch } from '../serverWorkerEngine.ts';

/**
 * JOBFOUNDS Hostinger Unlimited Cron Worker
 * -----------------------------------------
 * Designed specifically for Hostinger Unlimited Cron Jobs (max 30 min per execution,
 * 2 CPU, 3 GB RAM, no permanent background daemon).
 *
 * Usage in Hostinger hPanel -> Cron Jobs (every 10 or 15 minutes):
 *   cd ~/domains/jobfounds.com/nodejs && node dist-server/cron-worker.mjs
 */

const STALE_LOCK_MS = 28 * 60_000; // Auto-recover stale lock if a previous cron hit Hostinger's 30-min cap

function acquireProcessLock(lockPath: string): boolean {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  if (fs.existsSync(lockPath)) {
    try {
      const stat = fs.statSync(lockPath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < STALE_LOCK_MS) {
        return false;
      }
      // Previous lock is stale (>28 min) — remove and resume cleanly
      fs.unlinkSync(lockPath);
    } catch {
      return false;
    }
  }
  try {
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
      { flag: 'wx', mode: 0o600 }
    );
    return true;
  } catch {
    return false;
  }
}

function releaseProcessLock(lockPath: string): void {
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // ignore cleanup errors
  }
}

async function main() {
  const dataDir = resolveEngineDataDir();
  const lockPath = path.join(dataDir, '.cron-worker.lock');

  if (!acquireProcessLock(lockPath)) {
    console.log(
      JSON.stringify({
        ok: true,
        skipped: true,
        reason: 'Another cron-worker execution is currently active.',
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  let exitCode = 0;
  try {
    getEngineDb();
    const maxJobs = Math.min(100, Math.max(1, Number(process.env.CRON_MAX_JOBS) || 25));
    // Hard ceiling of 24 minutes so Hostinger's 30-minute Cron kill limit is never hit
    const maxDurationMs = Math.min(
      24 * 60_000,
      Math.max(30_000, Number(process.env.CRON_MAX_DURATION_MS) || 20 * 60_000)
    );

    const summary = await runCronBatch({
      maxJobs,
      maxDurationMs,
      maxMemoryMb: 1800,
      trigger: 'hostinger_cli_cron',
    });

    // Automatic daily SQLite backup (keeps last 7 snapshots)
    let backupCreated: { filename: string; sizeBytes: number } | null = null;
    try {
      const backups = listEngineDbBackups();
      const latestMs = backups[0] ? Date.parse(backups[0].createdAt) : 0;
      if (!latestMs || Date.now() - latestMs >= 24 * 60 * 60_000) {
        const snap = createEngineDbBackup('cron_daily', 7);
        backupCreated = { filename: snap.filename, sizeBytes: snap.sizeBytes };
      }
    } catch {
      // Non-fatal; cron batch already completed
    }

    console.log(JSON.stringify({ ok: true, summary, backupCreated }));
  } catch (err) {
    exitCode = 1;
    console.error(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      })
    );
  } finally {
    closeEngineDb();
    releaseProcessLock(lockPath);
  }

  process.exit(exitCode);
}

main();
