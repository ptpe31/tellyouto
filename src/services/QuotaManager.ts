import { doc, getDoc, setDoc } from 'firebase/firestore';

import { ensureFirebaseAnonymousAuth, getFirestoreDb } from '../api/firebase';
import { sanitizeFirestoreMap } from '../api/firestoreSanitize';
import { getOrCreateDeviceId } from '../api/syncService';
import { withViaDb, getOrCreateViaUserId } from './db/Schema';
import { fetchInitialSentinelFreeQuota } from './sentinelRemoteConfig';

export type SentinelQuotaSnapshot = {
  balance: number;
  fetchedAtMs: number;
};

let initInFlight: Promise<void> | null = null;

async function readLocal(userId: string): Promise<SentinelQuotaSnapshot | null> {
  return withViaDb(async (db) => {
    const row = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT sentinel_trial_balance, updated_at_ms FROM user_profile WHERE user_id = ?`,
      [userId]
    );
    if (!row) return null;
    const balance = Number(row.sentinel_trial_balance ?? 0);
    return {
      balance: Number.isFinite(balance) ? Math.max(0, Math.floor(balance)) : 0,
      fetchedAtMs: Number(row.updated_at_ms ?? 0) || 0,
    };
  });
}

async function writeLocal(userId: string, balance: number): Promise<void> {
  const now = Date.now();
  const b = Number.isFinite(balance) ? Math.max(0, Math.floor(balance)) : 0;
  await withViaDb(async (db) => {
    const existing = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT user_id FROM user_profile WHERE user_id = ?`,
      [userId]
    );
    if (!existing) {
      await db.runAsync(
        `INSERT INTO user_profile (user_id, is_pro_user, sentinel_trial_balance, created_at_ms, updated_at_ms, is_synced)
         VALUES (?, 0, ?, ?, ?, 0)`,
        [userId, b, now, now]
      );
      return;
    }
    await db.runAsync(
      `UPDATE user_profile
         SET sentinel_trial_balance = ?,
             updated_at_ms = ?,
             is_synced = 0
       WHERE user_id = ?`,
      [b, now, userId]
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
    const userId = await getOrCreateViaUserId();
    const local = await readLocal(userId);
    if (local) return;

    const defaultBalance = await fetchInitialSentinelFreeQuota();
    let balance = defaultBalance;
    try {
      const deviceId = await getOrCreateDeviceId();
      const remote = await readRemote(deviceId);
      if (typeof remote === 'number') {
        balance = remote;
      } else {
        void writeRemote(deviceId, balance);
      }
    } catch {
      /* ignore */
    }
    await writeLocal(userId, balance);
  })().finally(() => {
    initInFlight = null;
  });
  return initInFlight;
}

export async function getSentinelQuotaSnapshotLocalOnly(): Promise<SentinelQuotaSnapshot> {
  const userId = await getOrCreateViaUserId();
  const local = await readLocal(userId);
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
  const userId = await getOrCreateViaUserId();
  const snap = await getSentinelQuotaSnapshotLocalOnly();
  if (snap.balance <= 0) return { mode: 'STATIC', balanceAfter: 0 };

  const next = Math.max(0, snap.balance - 1);
  await writeLocal(userId, next);
  void writeRemote(deviceId, next);
  return { mode: 'SENTINEL', balanceAfter: next };
}
