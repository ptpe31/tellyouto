import * as FileSystem from 'expo-file-system/legacy';
import { withLocalDatabase } from './localDb';

export type AudioJobRow = {
  id: string;
  transcript: string;
  title: string;
  audio_path: string;
  created_at: number;
  attempts: number;
  locked_until: number;
  last_error: string | null;
};

const DIR = `${FileSystem.documentDirectory}phoenix_audio_jobs`;
const LOCK_MS = 2 * 60 * 1000;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;

function newId(): string {
  return `phoenix_job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureTable(): Promise<void> {
  await withLocalDatabase(async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS phoenix_audio_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        transcript TEXT NOT NULL,
        title TEXT NOT NULL,
        audio_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_phoenix_audio_jobs_lock
        ON phoenix_audio_jobs (locked_until, created_at ASC);
    `);
  });
}

async function ensureDir(): Promise<void> {
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

async function safeDelete(path: string): Promise<void> {
  const p = path.trim();
  if (!p) return;
  try {
    await FileSystem.deleteAsync(p, { idempotent: true });
  } catch {
    return;
  }
}

export async function enqueueAudioJob(params: {
  transcript: string;
  title: string;
  audioUri: string;
}): Promise<{ jobId: string; storedPath: string }> {
  await ensureTable();
  await ensureDir();
  const jobId = newId();
  const storedPath = `${DIR}/${jobId}.m4a`;
  await FileSystem.copyAsync({ from: params.audioUri, to: storedPath });
  if (params.audioUri !== storedPath) {
    await safeDelete(params.audioUri);
  }
  const now = Date.now();
  try {
    await withLocalDatabase(async (db) => {
      await db.runAsync(
        `INSERT INTO phoenix_audio_jobs (id, transcript, title, audio_path, created_at, attempts, locked_until, last_error)
         VALUES (?, ?, ?, ?, ?, 0, 0, NULL)`,
        [jobId, params.transcript, params.title, storedPath, now],
      );
    });
  } catch (e) {
    await safeDelete(storedPath);
    throw e;
  }
  return { jobId, storedPath };
}

export async function claimNextAudioJob(): Promise<AudioJobRow | null> {
  await ensureTable();
  const now = Date.now();
  return withLocalDatabase(async (db) => {
    const row = await db.getFirstAsync<AudioJobRow>(
      `SELECT * FROM phoenix_audio_jobs
       WHERE locked_until <= ?
       ORDER BY created_at ASC
       LIMIT 1`,
      [now],
    );
    if (!row) return null;
    const lockedUntil = now + LOCK_MS;
    await db.runAsync(`UPDATE phoenix_audio_jobs SET locked_until = ? WHERE id = ?`, [lockedUntil, row.id]);
    const refreshed = await db.getFirstAsync<AudioJobRow>(
      `SELECT * FROM phoenix_audio_jobs WHERE id = ? LIMIT 1`,
      [row.id],
    );
    return refreshed ?? null;
  });
}

export async function markAudioJobDone(jobId: string): Promise<void> {
  await ensureTable();
  const row = await withLocalDatabase(async (db) => {
    return (await db.getFirstAsync<AudioJobRow>(
      `SELECT * FROM phoenix_audio_jobs WHERE id = ? LIMIT 1`,
      [jobId],
    )) ?? null;
  });
  if (!row) return;
  await safeDelete(row.audio_path);
  await withLocalDatabase(async (db) => {
    await db.runAsync(`DELETE FROM phoenix_audio_jobs WHERE id = ?`, [jobId]);
  });
}

export async function failAudioJob(jobId: string, errorCode: string): Promise<void> {
  await ensureTable();
  const now = Date.now();
  await withLocalDatabase(async (db) => {
    const row =
      (await db.getFirstAsync<AudioJobRow>(
        `SELECT * FROM phoenix_audio_jobs WHERE id = ? LIMIT 1`,
        [jobId],
      )) ?? null;
    if (!row) return;
    const attempts = Math.min(32, Math.max(0, row.attempts + 1));
    const exp = Math.min(16, attempts);
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exp);
    const jitter = 0.85 + Math.random() * 0.3;
    const nextLock = now + Math.max(250, Math.round(delay * jitter));
    await db.runAsync(
      `UPDATE phoenix_audio_jobs
       SET attempts = ?, locked_until = ?, last_error = ?
       WHERE id = ?`,
      [attempts, nextLock, errorCode.slice(0, 120), jobId],
    );
  });
}

export async function pruneBrokenJobs(): Promise<number> {
  await ensureTable();
  const rows = await withLocalDatabase(async (db) => {
    return await db.getAllAsync<{ id: string; audio_path: string }>(
      `SELECT id, audio_path FROM phoenix_audio_jobs`,
    );
  });
  let removed = 0;
  for (const r of rows) {
    const path = r.audio_path?.trim() ?? '';
    if (!path) continue;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) {
      removed += 1;
      await withLocalDatabase(async (db) => {
        await db.runAsync(`DELETE FROM phoenix_audio_jobs WHERE id = ?`, [r.id]);
      });
    }
  }
  return removed;
}
