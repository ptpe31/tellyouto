import { doc, getDoc, setDoc } from 'firebase/firestore';

import { getFirestoreDb } from './firebase';
import { getOrCreateDeviceId } from './syncService';

/** Quota d’intentions via bots — valeur par défaut côté app et Cloud Function. */
export const DEFAULT_INTENTIONS_QUOTA = 50;

export type DeviceProfileFields = {
  first_name?: string;
  intentions_quota?: number;
  /** Langue préférée pour les réponses bot (ex. fr, en) */
  locale?: string;
  profile_updated_at?: number;
};

/**
 * Fusionne le profil appareil sur `devices/{deviceId}` (même doc que les métadonnées sync).
 */
export async function pushDeviceProfileToFirestore(
  fields: DeviceProfileFields,
): Promise<void> {
  const db = getFirestoreDb();
  if (!db) return;
  const deviceId = await getOrCreateDeviceId();
  const ref = doc(db, 'devices', deviceId);
  await setDoc(
    ref,
    {
      ...fields,
      profile_updated_at: Date.now(),
    },
    { merge: true },
  );
}

export async function fetchDeviceProfileFromFirestore(): Promise<DeviceProfileFields | null> {
  const db = getFirestoreDb();
  if (!db) return null;
  const deviceId = await getOrCreateDeviceId();
  const ref = doc(db, 'devices', deviceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    first_name:
      typeof d.first_name === 'string' ? d.first_name : undefined,
    intentions_quota:
      typeof d.intentions_quota === 'number' ? d.intentions_quota : undefined,
    locale: typeof d.locale === 'string' ? d.locale : undefined,
  };
}
