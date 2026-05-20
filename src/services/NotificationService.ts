import { Platform } from 'react-native';

import { getAppPreference } from '../api/localDb';
import { getTrankilV2IntentionById } from '../api/trankilV2Db';
import i18n from '../locales/i18n';
import { formatCapsule, resolveCapsuleTimesFromTrip } from '../utils/formatDepartureCapsule';
import { hasElasticContractMetadata } from '../utils/tripElasticCapsuleModel';
import { getNotifications } from './notifications';

export { formatCapsule } from '../utils/formatDepartureCapsule';

export const DEPARTURE_STICKY_CHANNEL_ID = 'departure_contract_silent';
export const DEPARTURE_SIGNAL_CHANNEL_ID = 'departure_contract_signals';
export const DEPARTURE_SAFETY_REMINDER_PREF_KEY = 'departure_safety_reminder_offset_min';

const DEPARTURE_ID_PREFIX = 'departure_';

export type DepartureUserSettings = {
  /** Minutes avant la fin de fenêtre (Signal B). 0 = désactivé. */
  safetyReminderOffsetMin: number;
};

export type DepartureNotificationPayload = {
  kind: 'departure_contract_sticky' | 'departure_signal_a' | 'departure_signal_b';
  tripTaskId: string;
  destination: string;
};

type SyncDepartureInput = {
  tripTaskId: string;
  destination: string;
  trip: Record<string, unknown> | null;
  nowMs?: number;
  stateVersion?: number;
};

type NotificationsModule = NonNullable<ReturnType<typeof getNotifications>>;

let channelsReady = false;

/** Sur Android, associe la notif immédiate au canal suivi (évite le fallback expo HIGH). */
function androidSurveillanceTrigger(): { channelId: string } | null {
  if (Platform.OS !== 'android') return null;
  return { channelId: DEPARTURE_STICKY_CHANNEL_ID };
}

/** Contenu ongoing : non-dismissible au swipe (`sticky` → `setOngoing` natif). */
function buildOngoingSurveillanceContent(
  n: NotificationsModule,
  content: {
    title: string;
    body: string;
    data: DepartureNotificationPayload;
  },
) {
  return {
    title: content.title,
    body: content.body,
    data: content.data,
    sticky: true,
    autoDismiss: false,
    sound: false,
    ...(Platform.OS === 'android'
      ? { priority: n.AndroidNotificationPriority.LOW }
      : {}),
  };
}

function stickyIdentifier(tripTaskId: string): string {
  return `${DEPARTURE_ID_PREFIX}sticky_${tripTaskId}`;
}

function signalAIdentifier(tripTaskId: string): string {
  return `${DEPARTURE_ID_PREFIX}signal_a_${tripTaskId}`;
}

function signalBIdentifier(tripTaskId: string): string {
  return `${DEPARTURE_ID_PREFIX}signal_b_${tripTaskId}`;
}

function departureIdentifiersForTrip(tripTaskId: string): string[] {
  return [stickyIdentifier(tripTaskId), signalAIdentifier(tripTaskId), signalBIdentifier(tripTaskId)];
}

export async function loadDepartureUserSettings(): Promise<DepartureUserSettings> {
  const raw = await getAppPreference(DEPARTURE_SAFETY_REMINDER_PREF_KEY);
  if (raw == null || raw === '') {
    return { safetyReminderOffsetMin: 5 };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { safetyReminderOffsetMin: 0 };
  return { safetyReminderOffsetMin: Math.floor(n) };
}

async function ensureDepartureChannels(n: NotificationsModule): Promise<void> {
  if (channelsReady || Platform.OS !== 'android') {
    channelsReady = true;
    return;
  }
  await n.setNotificationChannelAsync(DEPARTURE_STICKY_CHANNEL_ID, {
    name: 'Contrat de départ (suivi)',
    importance: n.AndroidImportance.LOW,
    lockscreenVisibility: n.AndroidNotificationVisibility.PRIVATE,
    vibrationPattern: [0],
    showBadge: false,
    sound: null,
  });
  await n.setNotificationChannelAsync(DEPARTURE_SIGNAL_CHANNEL_ID, {
    name: 'Contrat de départ (signaux)',
    importance: n.AndroidImportance.HIGH,
    lockscreenVisibility: n.AndroidNotificationVisibility.PUBLIC,
    vibrationPattern: [0, 280, 120, 280],
    showBadge: true,
  });
  channelsReady = true;
}

async function cancelIdentifiers(n: NotificationsModule, ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await n.dismissNotificationAsync(id);
    } catch {
      /* déjà absent */
    }
    try {
      await n.cancelScheduledNotificationAsync(id);
    } catch {
      /* déjà absent */
    }
  }
}

/**
 * Annule toutes les notifications du Contrat de Départ pour un trajet, ou toutes si aucun id.
 * À appeler avant navigation GPS ou à l’arrivée à destination.
 */
export async function clearAllDepartureNotifications(tripTaskId?: string): Promise<void> {
  const n = getNotifications();
  if (!n) return;

  if (tripTaskId) {
    await cancelIdentifiers(n, departureIdentifiersForTrip(tripTaskId));
    return;
  }

  try {
    const scheduled = await n.getAllScheduledNotificationsAsync();
    for (const req of scheduled) {
      const id = req.identifier ?? '';
      if (id.startsWith(DEPARTURE_ID_PREFIX)) {
        try {
          await n.cancelScheduledNotificationAsync(id);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* module indisponible */
  }

  try {
    const presented = await n.getPresentedNotificationsAsync();
    for (const req of presented) {
      const id = req.request.identifier ?? '';
      if (id.startsWith(DEPARTURE_ID_PREFIX)) {
        try {
          await n.dismissNotificationAsync(id);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

async function scheduleDateNotification(
  n: NotificationsModule,
  args: {
    identifier: string;
    title: string;
    body: string;
    whenMs: number;
    payload: DepartureNotificationPayload;
    playSound: boolean;
    timeSensitive: boolean;
  },
): Promise<void> {
  const when = new Date(args.whenMs);
  if (!Number.isFinite(when.getTime()) || when.getTime() <= Date.now() + 500) return;

  await ensureDepartureChannels(n);

  const channelId = args.playSound ? DEPARTURE_SIGNAL_CHANNEL_ID : DEPARTURE_STICKY_CHANNEL_ID;

  await n.scheduleNotificationAsync({
    identifier: args.identifier,
    content: {
      title: args.title,
      body: args.body,
      data: args.payload,
      sound: args.playSound,
      sticky: false,
      autoDismiss: true,
      ...(Platform.OS === 'android'
        ? {
            priority: args.playSound
              ? n.AndroidNotificationPriority.HIGH
              : n.AndroidNotificationPriority.LOW,
          }
        : args.timeSensitive
          ? { interruptionLevel: 'timeSensitive' as const }
          : {}),
    },
    trigger: {
      type: n.SchedulableTriggerInputTypes.DATE,
      date: when,
      ...(Platform.OS === 'android' ? { channelId } : {}),
    },
  });
}

/**
 * Met à jour la notification persistante (silencieuse) et replanifie les signaux A/B.
 * Une seule notification sticky par trajet — pas de duplication.
 */
export async function syncDepartureContractNotifications(input: SyncDepartureInput): Promise<void> {
  const n = getNotifications();
  if (!n) return;

  const trip = input.trip;
  if (!trip || !hasElasticContractMetadata(trip)) {
    await clearAllDepartureNotifications(input.tripTaskId);
    return;
  }

  const times = resolveCapsuleTimesFromTrip(trip);
  if (!times) {
    await clearAllDepartureNotifications(input.tripTaskId);
    return;
  }

  const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now();
  const { startMs, endMs, ratioD } = times;
  const capsule = formatCapsule({ startMs, endMs, nowMs, ratioD, isLate: nowMs > endMs });
  const destination = String(input.destination || '').trim() || i18n.t('timeline.untitled');
  const userSettings = await loadDepartureUserSettings();

  await ensureDepartureChannels(n);

  const stickyId = stickyIdentifier(input.tripTaskId);
  const payloadBase: DepartureNotificationPayload = {
    kind: 'departure_contract_sticky',
    tripTaskId: input.tripTaskId,
    destination,
  };

  await n.scheduleNotificationAsync({
    identifier: stickyId,
    content: buildOngoingSurveillanceContent(n, {
      title: i18n.t('departureContract.notifTitle', { destination }),
      body: capsule,
      data: { ...payloadBase, kind: 'departure_contract_sticky' },
    }),
    trigger: androidSurveillanceTrigger() ?? null,
  });

  await cancelIdentifiers(n, [signalAIdentifier(input.tripTaskId), signalBIdentifier(input.tripTaskId)]);

  await scheduleDateNotification(n, {
    identifier: signalAIdentifier(input.tripTaskId),
    title: i18n.t('sentinel.topDepartTitle'),
    body: i18n.t('sentinel.topDepartBody', { destination }),
    whenMs: startMs,
    payload: { kind: 'departure_signal_a', tripTaskId: input.tripTaskId, destination },
    playSound: true,
    timeSensitive: true,
  });

  const offsetMin = userSettings.safetyReminderOffsetMin;
  if (offsetMin > 0) {
    const reminderMs = endMs - offsetMin * 60_000;
    await scheduleDateNotification(n, {
      identifier: signalBIdentifier(input.tripTaskId),
      title: i18n.t('departureContract.signalBTitle'),
      body: i18n.t('departureContract.signalBBody', {
        destination,
        minutes: offsetMin,
        capsule,
      }),
      whenMs: reminderMs,
      payload: { kind: 'departure_signal_b', tripTaskId: input.tripTaskId, destination },
      playSound: false,
      timeSensitive: false,
    });
  }
}

/** Synchronise les notifications si l’intention a la surveillance « partir » active. */
export async function syncDepartureContractForIntention(
  intentionId: string,
  input: {
    destination: string;
    trip: Record<string, unknown> | null;
    nowMs?: number;
    stateVersion?: number;
  },
): Promise<void> {
  const row = await getTrankilV2IntentionById(intentionId);
  if (!row || Number(row.remind_to_leave) !== 1) {
    await clearAllDepartureNotifications(intentionId);
    return;
  }
  await syncDepartureContractNotifications({
    tripTaskId: intentionId,
    destination: input.destination,
    trip: input.trip,
    nowMs: input.nowMs,
    stateVersion: input.stateVersion,
  });
}
