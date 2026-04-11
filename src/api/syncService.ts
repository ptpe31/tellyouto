import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { doc, setDoc } from 'firebase/firestore';

import { getFirestoreDb } from './firebase';
import {
  listUnsyncedIntentions,
  markIntentionSynced,
  type IntentionRow,
} from './localDb';

const DEVICE_ID_KEY = '@tellyouto/sync_device_id';

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

  const ref = doc(firestore, 'devices', deviceId, 'intentions', row.id);

  await setDoc(ref, {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    weights: row.weights,
    platform_type: row.platform_type,
    platform_user_id: row.platform_user_id,
    created_at: row.created_at,
    estimated_duration: row.estimated_duration,
    actual_duration: row.actual_duration,
    alarm_enabled: row.alarm_enabled,
    is_micro_habit: row.is_micro_habit,
    is_hard_constraint: row.is_hard_constraint,
    routine_id: row.routine_id,
    anchor_date_ymd: row.anchor_date_ymd,
    fixed_start_minutes: row.fixed_start_minutes,
    synced_client_at: Date.now(),
  });
}

/**
 * Envoie les intentions locales non synchronisées vers Firestore.
 */
export async function syncPendingIntentions(): Promise<void> {
  if (!getFirestoreDb()) return;

  const deviceId = await getOrCreateDeviceId();
  const pending = await listUnsyncedIntentions();

  for (const row of pending) {
    try {
      await pushIntentionToFirestore(deviceId, row);
      await markIntentionSynced(row.id);
    } catch {
      /* réseau ou règles Firestore — retry au prochain online */
    }
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
      (state.isInternetReachable === true ||
        state.isInternetReachable === null);
    if (online) {
      void syncPendingIntentions();
    }
  });

  void NetInfo.fetch().then((state) => {
    if (state.isConnected) {
      void syncPendingIntentions();
    }
  });

  return unsubscribe;
}
