import { doc, getDoc, setDoc } from 'firebase/firestore';

import { ensureFirebaseAnonymousAuth, getFirebaseAuth, getFirestoreDb } from './firebase';
import { getOrCreateDeviceId } from './syncService';
import { sanitizeFirestoreMap } from './firestoreSanitize';

/** Quota d’intentions via bots — valeur par défaut côté app et Cloud Function. */
export const DEFAULT_INTENTIONS_QUOTA = 50;

/** Valeur Firestore sûre pour « pas de fenêtre sans pub » (évite invalid-argument). */
export const AD_FREE_UNTIL_MS_FIRESTORE_DEFAULT = 0;

export type DeviceProfileFields = {
  first_name?: string;
  intentions_quota?: number;
  locale?: string;
  messenger_reminders_enabled?: boolean;
  messenger_reminder_lead_minutes?: number;
  /** Stocké sur `users/{uid}` — plus sur `devices` (portabilité). */
  ad_free_until_ms?: number;
  is_pro_user?: boolean;
  last_messenger_channel?: string | null;
  last_messenger_user_id?: string | null;
  profile_updated_at?: number;
};

/** Droits premium / sans pub — document `users/{firebaseAuthUid}`. */
export type UserEntitlementFields = {
  ad_free_until_ms: number;
  is_pro_user: boolean;
  profile_updated_at?: number;
};

/** Fenêtre calculée côté app pour la Cloud Function `scheduleProactiveReminders`. */
export type RailReminderWindowPayload = {
  intentionId: string;
  title: string;
  urgent: boolean;
  slotStartUtcMs: number;
  remindAtUtcMs: number;
  leadMin: number;
};

function stripUndefined<T extends Record<string, unknown>>(o: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Retire les champs d’entitlement du payload appareil (réservés à `users/{uid}`). */
function deviceProfilePayloadWithoutEntitlements(
  fields: DeviceProfileFields,
): Record<string, unknown> {
  const {
    ad_free_until_ms: _a,
    is_pro_user: _p,
    profile_updated_at: _pu,
    ...rest
  } = fields;
  return stripUndefined(rest as Record<string, unknown>);
}

/**
 * Profil technique + miroir messager sur `devices/{deviceId}`.
 * N’écrit pas `ad_free_until_ms` ni `is_pro_user` ici — utiliser `pushUserEntitlementsToFirestore`.
 * Ajoute `firebase_uid` pour que les Cloud Functions résolvent `users/{uid}`.
 */
export async function pushDeviceProfileToFirestore(
  fields: DeviceProfileFields,
): Promise<void> {
  const db = getFirestoreDb();
  if (!db) {
    if (__DEV__) {
      console.warn(
        '[TellYouTo] pushDeviceProfileToFirestore : Firestore indisponible (getFirestoreDb null) — config Firebase ou .env',
      );
    }
    return;
  }
  await ensureFirebaseAnonymousAuth();
  const auth = getFirebaseAuth();
  const uid = auth?.currentUser?.uid ?? null;
  const deviceId = await getOrCreateDeviceId();
  if (__DEV__) {
    console.log(
      `[TellYouTo] pushDeviceProfileToFirestore → devices/${deviceId} (merge profil technique)`,
    );
  }
  const ref = doc(db, 'devices', deviceId);
  const raw = {
    ...deviceProfilePayloadWithoutEntitlements(fields),
    firebase_uid: uid,
    profile_updated_at: Date.now(),
  };
  await setDoc(ref, sanitizeFirestoreMap(raw), { merge: true });
}

/**
 * Droits premium / sans pub sur `users/{firebaseAuthUid}` (portable entre appareils).
 * `ad_free_until_ms` est toujours un nombre (0 = aucune fenêtre active côté Firestore).
 */
export async function pushUserEntitlementsToFirestore(
  fields: Partial<Pick<DeviceProfileFields, 'ad_free_until_ms' | 'is_pro_user'>>,
): Promise<void> {
  const db = getFirestoreDb();
  if (!db) return;
  await ensureFirebaseAnonymousAuth();
  const auth = getFirebaseAuth();
  const uid = auth?.currentUser?.uid;
  if (!uid) return;
  const ref = doc(db, 'users', uid);
  const raw: Record<string, unknown> = { profile_updated_at: Date.now() };
  if ('ad_free_until_ms' in fields) {
    const adRaw = fields.ad_free_until_ms;
    raw.ad_free_until_ms =
      typeof adRaw === 'number' && Number.isFinite(adRaw)
        ? adRaw
        : AD_FREE_UNTIL_MS_FIRESTORE_DEFAULT;
  }
  if ('is_pro_user' in fields) {
    raw.is_pro_user = fields.is_pro_user === true;
  }
  if (Object.keys(raw).length <= 1) return;
  await setDoc(ref, sanitizeFirestoreMap(raw), { merge: true });
}

export async function fetchUserEntitlementsFromFirestore(): Promise<
  Pick<DeviceProfileFields, 'ad_free_until_ms' | 'is_pro_user'> | null
> {
  const db = getFirestoreDb();
  if (!db) return null;
  await ensureFirebaseAnonymousAuth();
  const auth = getFirebaseAuth();
  const uid = auth?.currentUser?.uid;
  if (!uid) return null;
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const d = snap.data();
  const ad = d.ad_free_until_ms;
  const adN =
    typeof ad === 'number' && Number.isFinite(ad)
      ? ad
      : AD_FREE_UNTIL_MS_FIRESTORE_DEFAULT;
  return {
    ad_free_until_ms: adN,
    is_pro_user: d.is_pro_user === true,
  };
}

export async function fetchDeviceProfileFromFirestore(): Promise<DeviceProfileFields | null> {
  const db = getFirestoreDb();
  if (!db) return null;
  await ensureFirebaseAnonymousAuth();
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
    messenger_reminders_enabled:
      typeof d.messenger_reminders_enabled === 'boolean'
        ? d.messenger_reminders_enabled
        : undefined,
    messenger_reminder_lead_minutes:
      typeof d.messenger_reminder_lead_minutes === 'number'
        ? d.messenger_reminder_lead_minutes
        : undefined,
    last_messenger_channel:
      typeof d.last_messenger_channel === 'string'
        ? d.last_messenger_channel
        : d.last_messenger_channel === null
          ? null
          : undefined,
    last_messenger_user_id:
      typeof d.last_messenger_user_id === 'string'
        ? d.last_messenger_user_id
        : d.last_messenger_user_id === null
          ? null
          : undefined,
  };
}

/** Profil device + entitlements `users` (priorité cloud pour Premium / sans pub). */
export async function fetchMergedRemoteProfile(): Promise<DeviceProfileFields | null> {
  const [device, ent] = await Promise.all([
    fetchDeviceProfileFromFirestore(),
    fetchUserEntitlementsFromFirestore(),
  ]);
  if (!device && !ent) return null;
  return {
    ...(device ?? {}),
    ...(ent ?? {}),
  };
}

/**
 * Pousse les créneaux de rappel (UTC) + métadonnées pour le scheduler Firebase.
 */
export async function pushRailReminderWindowsToFirestore(payload: {
  windows: RailReminderWindowPayload[];
  reminder_timezone: string;
  messenger_reminders_enabled: boolean;
  messenger_reminder_lead_minutes: number;
}): Promise<void> {
  const db = getFirestoreDb();
  if (!db) return;
  await ensureFirebaseAnonymousAuth();
  const auth = getFirebaseAuth();
  const deviceId = await getOrCreateDeviceId();
  const ref = doc(db, 'devices', deviceId);
  const raw = {
    rail_reminder_windows: payload.windows,
    rail_reminders_updated_at: Date.now(),
    reminder_timezone: payload.reminder_timezone,
    messenger_reminders_enabled: payload.messenger_reminders_enabled,
    messenger_reminder_lead_minutes: payload.messenger_reminder_lead_minutes,
    firebase_uid: auth?.currentUser?.uid ?? null,
  };
  await setDoc(ref, sanitizeFirestoreMap(raw as Record<string, unknown>), { merge: true });
}
