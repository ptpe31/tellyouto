import { doc, getDoc, setDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { IS_LOCAL_MODE } from '../config/appConfig';
import { ensureFirebaseAnonymousAuth, getFirestoreDb } from '../api/firebase';
import { sanitizeFirestoreMap } from '../api/firestoreSanitize';
import { getOrCreateDeviceId } from '../api/syncService';
import { fetchInitialSentinelFreeQuota } from './sentinelRemoteConfig';

export type SentinelQuotaSnapshot = {
  balance: number;
  fetchedAtMs: number;
};

let initInFlight: Promise<void> | null = null;

type LocalQuotaCache = {
  balance: number;
  updatedAtMs: number;
  syncedAtMs: number | null;
};

function storageKey(deviceId: string): string {
  return `@tellyouto/sentinel_quota_cache/${deviceId}`;
}

async function readLocal(deviceId: string): Promise<SentinelQuotaSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(deviceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalQuotaCache>;
    const balance = Number(parsed.balance ?? 0);
    const updatedAtMs = Number(parsed.updatedAtMs ?? 0);
    if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return null;
    return {
      balance: Number.isFinite(balance) ? Math.max(0, Math.floor(balance)) : 0,
      fetchedAtMs: updatedAtMs,
    };
  } catch {
    return null;
  }
}

async function writeLocal(deviceId: string, balance: number, syncedAtMs: number | null): Promise<void> {
  const now = Date.now();
  const b = Number.isFinite(balance) ? Math.max(0, Math.floor(balance)) : 0;
  const payload: LocalQuotaCache = { balance: b, updatedAtMs: now, syncedAtMs };
  await AsyncStorage.setItem(storageKey(deviceId), JSON.stringify(payload));
}

async function readRemote(deviceId: string): Promise<number | null> {
  if (IS_LOCAL_MODE) return null;
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
  if (IS_LOCAL_MODE) return;
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
    try {
      const raw = await AsyncStorage.getItem(storageKey(deviceId));
      const parsed = raw ? (JSON.parse(raw) as Partial<LocalQuotaCache>) : {};
      const payload: LocalQuotaCache = {
        balance: next,
        updatedAtMs: Number(parsed.updatedAtMs ?? Date.now()) || Date.now(),
        syncedAtMs: Date.now(),
      };
      await AsyncStorage.setItem(storageKey(deviceId), JSON.stringify(payload));
    } catch {
    }
  });
  return { mode: 'SENTINEL', balanceAfter: next };
}
