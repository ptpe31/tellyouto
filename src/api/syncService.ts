import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

import { DEBUG_LAST_TRANSIT_INTENTION_PURGE_MS } from '../config/transitPurgeKeys';
import { sanitizeFirestoreMap } from './firestoreSanitize';
import { ensureFirebaseAnonymousAuth, getFirestoreDb } from './firebase';
import {
  listUnsyncedIntentions,
  markIntentionSynced,
  type IntentionRow,
} from './localDb';

const DEVICE_ID_KEY = '@tellyouto/sync_device_id';
const SYNC_COOLDOWN_MS = 8_000;
let syncInFlight: Promise<{ ok: boolean; failedCount: number }> | null = null;
let lastSyncStartedAt = 0;

/** Fenêtre alignée sur la purge serveur (24h) si deleteDoc échoue après transit. */
export const TRANSIT_TTL_MS = 24 * 60 * 60 * 1000;

export async function getOrCreateDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

async function pushIntentionToFirestore(
  deviceId: string,
  row: IntentionRow,
): Promise<void> {
  const firestore = getFirestoreDb();
  if (!firestore) return;
  await ensureFirebaseAnonymousAuth();

  const ref = doc(firestore, 'devices', deviceId, 'intentions', row.id);
  const now = Date.now();

  const ttlAt = now + TRANSIT_TTL_MS;
  const payload = sanitizeFirestoreMap({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    weights: row.weights as unknown as Record<string, unknown>,
    platform_type: row.platform_type,
    platform_user_id: row.platform_user_id,
    created_at: row.created_at,
    estimated_duration: row.estimated_duration,
    actual_duration: row.actual_duration ?? null,
    alarm_enabled: row.alarm_enabled,
    is_flexible: row.is_flexible,
    is_micro_habit: row.is_micro_habit,
    is_hard_constraint: row.is_hard_constraint,
    routine_id: row.routine_id ?? null,
    anchor_date_ymd: row.anchor_date_ymd ?? null,
    fixed_start_minutes: row.fixed_start_minutes ?? null,
    recurrence_rrule: row.recurrence_rrule ?? null,
    synced_client_at: now,
    transit_expires_at: ttlAt,
    /** Champ Timestamp pour politique TTL Firestore (24h) — configurer dans la console GCP. */
    ttl_expires_at: Timestamp.fromMillis(ttlAt),
  } as Record<string, unknown>);
  await setDoc(ref, payload);
}

/**
 * Envoie les intentions locales non synchronisées vers Firestore.
 */
export async function syncPendingIntentions(): Promise<{ ok: boolean; failedCount: number }> {
  const now = Date.now();
  if (syncInFlight) return syncInFlight;
  if (now - lastSyncStartedAt < SYNC_COOLDOWN_MS) return { ok: true, failedCount: 0 };
  lastSyncStartedAt = now;
  const run = (async (): Promise<{ ok: boolean; failedCount: number }> => {
  const firestore = getFirestoreDb();
  if (!firestore) return { ok: false, failedCount: 1 };

  const deviceId = await getOrCreateDeviceId();
  const pending = await listUnsyncedIntentions();
  let failedCount = 0;

  for (const row of pending) {
    try {
      await pushIntentionToFirestore(deviceId, row);
      await markIntentionSynced(row.id);
      /** Rétention zéro : marquer comme traité puis supprimer la copie de transit sur Firestore. */
      const transitRef = doc(
        firestore,
        'devices',
        deviceId,
        'intentions',
        row.id,
      );
      try {
        await updateDoc(transitRef, {
          processed: true,
          processed_at: serverTimestamp(),
        });
      } catch {
        /* règles Firestore : on tente quand même deleteDoc */
      }
      try {
        await deleteDoc(transitRef);
        await AsyncStorage.setItem(
          DEBUG_LAST_TRANSIT_INTENTION_PURGE_MS,
          String(Date.now()),
        );
      } catch {
        /* purge différée via Cloud Function / TTL si réseau ou règles */
      }
    } catch {
      /* réseau ou règles Firestore — retry au prochain online */
      failedCount += 1;
    }
  }
  return { ok: failedCount === 0, failedCount };
  })();
  syncInFlight = run;
  try {
    return await run;
  } finally {
    syncInFlight = null;
  }
}

/**
 * Écoute la connectivité et lance la synchro lorsque le réseau revient.
 * Retourne une fonction de désinscription.
 */
export function startConnectivitySyncListener(): () => void {
  const unsubscribe = NetInfo.addEventListener((state) => {
    const online =
      state.isConnected === true &&
      state.isInternetReachable === true;
    if (online) {
      void syncPendingIntentions();
    }
  });

  void NetInfo.fetch().then((state) => {
    if (state.isConnected === true && state.isInternetReachable === true) {
      void syncPendingIntentions();
    }
  });

  return unsubscribe;
}
