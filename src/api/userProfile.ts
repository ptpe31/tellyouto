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
  /** Rappels proactifs messagerie (montre / téléphone) */
  messenger_reminders_enabled?: boolean;
  messenger_reminder_lead_minutes?: number;
  /** Fin du mode sans pub (offre Telegram, ms epoch UTC) */
  ad_free_until_ms?: number;
  /** Abonnement TellYouTo Pro (canaux premium + sans pub) */
  is_pro_user?: boolean;
  /** Dernier canal messager lié (webhook) */
  last_messenger_channel?: string | null;
  /** Identifiant utilisateur côté messagerie */
  last_messenger_user_id?: string | null;
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
    messenger_reminders_enabled:
      typeof d.messenger_reminders_enabled === 'boolean'
        ? d.messenger_reminders_enabled
        : undefined,
    messenger_reminder_lead_minutes:
      typeof d.messenger_reminder_lead_minutes === 'number'
        ? d.messenger_reminder_lead_minutes
        : undefined,
    ad_free_until_ms:
      typeof d.ad_free_until_ms === 'number' &&
      Number.isFinite(d.ad_free_until_ms)
        ? d.ad_free_until_ms
        : undefined,
    is_pro_user:
      typeof d.is_pro_user === 'boolean' ? d.is_pro_user : undefined,
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
  const deviceId = await getOrCreateDeviceId();
  const ref = doc(db, 'devices', deviceId);
  await setDoc(
    ref,
    {
      rail_reminder_windows: payload.windows,
      rail_reminders_updated_at: Date.now(),
      reminder_timezone: payload.reminder_timezone,
      messenger_reminders_enabled: payload.messenger_reminders_enabled,
      messenger_reminder_lead_minutes: payload.messenger_reminder_lead_minutes,
    },
    { merge: true },
  );
}
