import { doc, getDoc, setDoc } from 'firebase/firestore';

import { withLocalDatabase } from '../api/localDb';
import { ensureFirebaseAnonymousAuth, getFirestoreDb } from '../api/firebase';
import { sanitizeFirestoreMap } from '../api/firestoreSanitize';
import { getOrCreateDeviceId } from '../api/syncService';
import { fetchInitialSentinelFreeQuota } from './sentinelRemoteConfig';

export type SentinelQuotaSnapshot = {
  balance: number;
  fetchedAtMs: number;
};

const TABLE = 'sentinel_quota_cache';
let initInFlight: Promise<void> | null = null;

async function ensureQuotaSchema(): Promise<void> {
  await withLocalDatabase(async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        device_id TEXT PRIMARY KEY NOT NULL,
        sentinel_trial_balance INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        synced_at_ms INTEGER
      );
    `);
  });
}

async function readLocal(deviceId: string): Promise<SentinelQuotaSnapshot | null> {
  await ensureQuotaSchema();
  return withLocalDatabase(async (db) => {
    const row = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT sentinel_trial_balance, updated_at_ms FROM ${TABLE} WHERE device_id = ?`,
      [deviceId]
    );
    if (!row) return null;
    const balance = Number(row.sentinel_trial_balance ?? 0);
    return {
      balance: Number.isFinite(balance) ? Math.max(0, Math.floor(balance)) : 0,
      fetchedAtMs: Number(row.updated_at_ms ?? 0) || 0,
    };
  });
}

async function writeLocal(deviceId: string, balance: number, syncedAtMs: number | null): Promise<void> {
  await ensureQuotaSchema();
  const now = Date.now();
  const b = Number.isFinite(balance) ? Math.max(0, Math.floor(balance)) : 0;
  await withLocalDatabase(async (db) => {
    await db.runAsync(
      `INSERT OR REPLACE INTO ${TABLE} (device_id, sentinel_trial_balance, updated_at_ms, synced_at_ms)
       VALUES (?, ?, ?, ?)`,
      [deviceId, b, now, syncedAtMs ?? null]
    );
  });
}

async function readRemote(deviceId: string): Promise<number | null> {
  const db = getFirestoreDb();
  if (!db) return null;
  await ensureFirebaseAnonymousAuth();
  const ref = doc(db, 'devices', deviceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data();
  const raw = data?.sentinel_trial_balance;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.max(0, Math.floor(raw));
}

async function writeRemote(deviceId: string, balance: number): Promise<void> {
  const db = getFirestoreDb();
  if (!db) return;
  await ensureFirebaseAnonymousAuth();
  const ref = doc(db, 'devices', deviceId);
  await setDoc(
    ref,
    sanitizeFirestoreMap({
      sentinel_trial_balance: Math.max(0, Math.floor(balance)),
      sentinel_trial_updated_at_ms: Date.now(),
    }),
    { merge: true }
  );
}

export async function ensureSentinelQuotaInitialized(): Promise<void> {
  if (initInFlight) return initInFlight;
  initInFlight = (async () => {
    const deviceId = await getOrCreateDeviceId();
    const local = await readLocal(deviceId);
    if (local) return;

    const defaultBalance = await fetchInitialSentinelFreeQuota();
    let balance = defaultBalance;
    try {
      const remote = await readRemote(deviceId);
      if (typeof remote === 'number') {
        balance = remote;
      } else {
        void writeRemote(deviceId, balance);
      }
    } catch {
      /* ignore */
    }
    await writeLocal(deviceId, balance, null);
  })().finally(() => {
    initInFlight = null;
  });
  return initInFlight;
}

export async function getSentinelQuotaSnapshotLocalOnly(): Promise<SentinelQuotaSnapshot> {
  const deviceId = await getOrCreateDeviceId();
  const local = await readLocal(deviceId);
  return local ?? { balance: 0, fetchedAtMs: 0 };
}

export async function hasSentinelQuota(params: { isProUser: boolean }): Promise<boolean> {
  if (params.isProUser) return true;
  const snap = await getSentinelQuotaSnapshotLocalOnly();
  return snap.balance > 0;
}

export async function consumeSentinelQuotaOnTripValidation(params: {
  isProUser: boolean;
}): Promise<{ mode: 'SENTINEL' | 'STATIC'; balanceAfter: number }> {
  await ensureSentinelQuotaInitialized();
  if (params.isProUser) {
    const snap = await getSentinelQuotaSnapshotLocalOnly();
    return { mode: 'SENTINEL', balanceAfter: snap.balance };
  }

  const deviceId = await getOrCreateDeviceId();
  const snap = await getSentinelQuotaSnapshotLocalOnly();
  if (snap.balance <= 0) return { mode: 'STATIC', balanceAfter: 0 };

  const next = Math.max(0, snap.balance - 1);
  await writeLocal(deviceId, next, null);
  void writeRemote(deviceId, next).then(async () => {
    await withLocalDatabase(async (db) => {
      await db.runAsync(`UPDATE ${TABLE} SET synced_at_ms = ? WHERE device_id = ?`, [Date.now(), deviceId]);
    });
  });
  return { mode: 'SENTINEL', balanceAfter: next };
}

