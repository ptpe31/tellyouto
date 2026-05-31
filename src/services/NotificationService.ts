/**
 * Point d'entrée unique pour toutes les notifications liées aux trajets
 * (Sentinel V4, Contrat de départ, signaux Go/No-Go).
 *
 * Aucun autre module métier ne doit appeler expo-notifications pour ces cas —
 * déléguer via ce fichier.
 */
import { Linking, Platform } from 'react-native';

import { getAppPreference } from '../api/localDb';
import { getTrankilV2IntentionById } from '../api/trankilV2Db';
import i18n from '../locales/i18n';
import { formatCapsule, resolveCapsuleTimesFromTrip } from '../utils/formatDepartureCapsule';
import { hasElasticContractMetadata } from '../utils/tripElasticCapsuleModel';
import { getNotifications } from './notifications';

export { formatCapsule } from '../utils/formatDepartureCapsule';

/** Canal Android « Zen » : suivi persistant silencieux (importance LOW, ongoing). */
export const DEPARTURE_STICKY_CHANNEL_ID = 'departure_contract_silent';
/** Canal signaux de départ (son, HIGH). */
export const DEPARTURE_SIGNAL_CHANNEL_ID = 'departure_contract_signals';
export const DEPARTURE_SAFETY_REMINDER_PREF_KEY = 'departure_safety_reminder_offset_min';

/** Catégorie iOS/Android — action « Lancer l'itinéraire » (compat Sentinel). */
export const TRIP_NOTIFICATION_CATEGORY_ID = 'sentinel_trip';
export const TRIP_ACTION_LAUNCH_ROUTE = 'sentinel_launch_route';

/** @deprecated Utiliser {@link DEPARTURE_STICKY_CHANNEL_ID} — conservé pour imports legacy. */
export const SENTINEL_NOTIFICATION_CHANNEL_ID = DEPARTURE_STICKY_CHANNEL_ID;
/** @deprecated Utiliser {@link TRIP_NOTIFICATION_CATEGORY_ID}. */
export const SENTINEL_NOTIFICATION_CATEGORY_ID = TRIP_NOTIFICATION_CATEGORY_ID;
/** @deprecated Utiliser {@link TRIP_ACTION_LAUNCH_ROUTE}. */
export const SENTINEL_ACTION_LAUNCH_ROUTE = TRIP_ACTION_LAUNCH_ROUTE;

const DEPARTURE_ID_PREFIX = 'departure_';
const LEGACY_SENTINEL_STICKY_PREFIX = 'sentinel_';

export type DepartureUserSettings = {
  /** Minutes avant la fin de fenêtre (Signal B). 0 = désactivé. */
  safetyReminderOffsetMin: number;
};

export type TripNotificationPayload = {
  kind:
    | 'departure_contract_sticky'
    | 'departure_signal_a'
    | 'departure_signal_b'
    | 'sentinel_trip'
    | 'trip_gonogo'
    | 'trip_probe_unavail'
    | 'trip_promise_drift';
  tripTaskId: string;
  destination: string;
  lat?: number;
  lng?: number;
};

/** @deprecated Alias — {@link TripNotificationPayload}. */
export type DepartureNotificationPayload = Extract<
  TripNotificationPayload,
  { kind: 'departure_contract_sticky' | 'departure_signal_a' | 'departure_signal_b' }
>;

type SyncDepartureInput = {
  tripTaskId: string;
  destination: string;
  trip: Record<string, unknown> | null;
  nowMs?: number;
  stateVersion?: number;
};

type NotificationsModule = NonNullable<ReturnType<typeof getNotifications>>;

let channelsReady = false;
let tripResponseListenerRegistered = false;
const coordsByTrip = new Map<string, { lat: number; lng: number }>();
const lastStickyVersionByTrip = new Map<string, number>();

/** ID canonique — notification persistante (système Zen). */
export function departureStickyIdentifier(tripTaskId: string): string {
  return `${DEPARTURE_ID_PREFIX}sticky_${tripTaskId}`;
}

/** ID canonique — signal de départ (TOP DEPART / Signal A). */
export function departureSignalAIdentifier(tripTaskId: string): string {
  return `${DEPARTURE_ID_PREFIX}signal_a_${tripTaskId}`;
}

export function departureSignalBIdentifier(tripTaskId: string): string {
  return `${DEPARTURE_ID_PREFIX}signal_b_${tripTaskId}`;
}

/** ID legacy Sentinel (sticky) — nettoyage uniquement. */
export function legacySentinelStickyIdentifier(tripTaskId: string): string {
  return `${LEGACY_SENTINEL_STICKY_PREFIX}${tripTaskId}`;
}

function departureIdentifiersForTrip(tripTaskId: string): string[] {
  return [
    departureStickyIdentifier(tripTaskId),
    departureSignalAIdentifier(tripTaskId),
    departureSignalBIdentifier(tripTaskId),
    legacySentinelStickyIdentifier(tripTaskId),
  ];
}

function fmtHm(ms: number): string {
  if (!Number.isFinite(Number(ms))) return '--:--';
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function buildNewtonGauge(params: {
  nowMs: number;
  tOptimisteMs: number;
  arrivalMs: number;
  size?: number;
}): string {
  const size = Math.max(7, Math.min(21, Math.floor(params.size ?? 11)));
  const bar = Array.from({ length: size }, () => '▬');
  const left = params.tOptimisteMs;
  const right = params.arrivalMs;
  const denom = Math.max(1, right - left);
  const x = Math.max(0, Math.min(1, (params.nowMs - left) / denom));
  const i = Math.max(0, Math.min(size - 1, Math.round(x * (size - 1))));
  bar[i] = '●';
  return `${fmtHm(left)} ${bar.join('')} ${fmtHm(right)}`;
}

function buildUniversalNavUrl(destination: string, coords?: { lat: number; lng: number }): string {
  const q = encodeURIComponent(destination);
  const lat = coords && Number.isFinite(coords.lat) ? coords.lat : 0;
  const lng = coords && Number.isFinite(coords.lng) ? coords.lng : 0;
  return Platform.OS === 'ios' ? `maps:${lat},${lng}?q=${q}` : `geo:${lat},${lng}?q=${q}`;
}

async function openUniversalNavigation(
  destination: string,
  coords?: { lat: number; lng: number },
): Promise<void> {
  const url = buildUniversalNavUrl(destination, coords);
  const supported = await Linking.canOpenURL(url);
  if (supported) {
    await Linking.openURL(url);
    return;
  }
  await Linking.openURL(
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`,
  );
}

/** Sur Android, associe la notif immédiate au canal suivi (évite le fallback expo HIGH). */
function androidSurveillanceTrigger(): { channelId: string } | null {
  if (Platform.OS !== 'android') return null;
  return { channelId: DEPARTURE_STICKY_CHANNEL_ID };
}

/**
 * Contenu ongoing « Zen » : non-dismissible au swipe (`sticky` → `setOngoing` natif),
 * canal LOW sur Android, pas de son.
 */
function buildOngoingSurveillanceContent(
  n: NotificationsModule,
  content: {
    title: string;
    body: string;
    data: TripNotificationPayload;
    categoryIdentifier?: string;
  },
) {
  return {
    title: content.title,
    body: content.body,
    data: content.data,
    ...(content.categoryIdentifier ? { categoryIdentifier: content.categoryIdentifier } : {}),
    sticky: true,
    autoDismiss: false,
    sound: false,
    ...(Platform.OS === 'android'
      ? { priority: n.AndroidNotificationPriority.LOW }
      : {}),
  };
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

async function ensureTripNotificationChannels(n: NotificationsModule): Promise<void> {
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

async function ensureTripNotificationCategory(n: NotificationsModule): Promise<void> {
  try {
    await n.setNotificationCategoryAsync(TRIP_NOTIFICATION_CATEGORY_ID, [
      {
        identifier: TRIP_ACTION_LAUNCH_ROUTE,
        buttonTitle: "Lancer l'itinéraire",
        options: { opensAppToForeground: true },
      },
    ]);
  } catch {
    /* plateforme sans catégories */
  }
}

/** Écoute unique : action itinéraire sur notifications trajet. */
export function registerTripNotificationResponseListener(): void {
  if (tripResponseListenerRegistered) return;
  const n = getNotifications();
  if (!n) return;
  tripResponseListenerRegistered = true;
  n.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as TripNotificationPayload | undefined;
    if (!data?.tripTaskId) return;
    if (response.actionIdentifier !== TRIP_ACTION_LAUNCH_ROUTE) return;
    const destination = String(data.destination || '').trim();
    const lat = typeof data.lat === 'number' ? data.lat : NaN;
    const lng = typeof data.lng === 'number' ? data.lng : NaN;
    const coords =
      Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : coordsByTrip.get(data.tripTaskId);
    void clearAllDepartureNotifications(data.tripTaskId);
    void openUniversalNavigation(destination, coords);
  });
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

function isLegacyTripNotificationId(id: string): boolean {
  return (
    id.startsWith(DEPARTURE_ID_PREFIX) ||
    id.startsWith(LEGACY_SENTINEL_STICKY_PREFIX) ||
    id.startsWith('sentinel_gonogo_') ||
    id.startsWith('sentinel_probe_unavail_')
  );
}

/**
 * Annule toutes les notifications trajet pour un trip, ou toutes si aucun id.
 * Inclut les IDs legacy `sentinel_{tripId}` pour éviter les fantômes.
 */
export async function clearAllDepartureNotifications(tripTaskId?: string): Promise<void> {
  const n = getNotifications();
  if (!n) return;

  if (tripTaskId) {
    coordsByTrip.delete(tripTaskId);
    lastStickyVersionByTrip.delete(tripTaskId);
    await cancelIdentifiers(n, departureIdentifiersForTrip(tripTaskId));
    return;
  }

  try {
    const scheduled = await n.getAllScheduledNotificationsAsync();
    for (const req of scheduled) {
      const id = req.identifier ?? '';
      if (isLegacyTripNotificationId(id)) {
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
      if (isLegacyTripNotificationId(id)) {
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
    payload: TripNotificationPayload;
    playSound: boolean;
    timeSensitive: boolean;
  },
): Promise<void> {
  const when = new Date(args.whenMs);
  if (!Number.isFinite(when.getTime()) || when.getTime() <= Date.now() + 500) return;

  await ensureTripNotificationChannels(n);

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

async function postImmediateTripNotification(
  n: NotificationsModule,
  args: {
    identifier: string;
    title: string;
    body: string;
    data: TripNotificationPayload;
    stickyZen: boolean;
    playSound: boolean;
    priorityHigh: boolean;
  },
): Promise<void> {
  await ensureTripNotificationChannels(n);
  await ensureTripNotificationCategory(n);
  registerTripNotificationResponseListener();

  if (args.stickyZen) {
    await n.scheduleNotificationAsync({
      identifier: args.identifier,
      content: buildOngoingSurveillanceContent(n, {
        title: args.title,
        body: args.body,
        data: args.data,
        categoryIdentifier: TRIP_NOTIFICATION_CATEGORY_ID,
      }),
      trigger: androidSurveillanceTrigger() ?? null,
    });
    return;
  }

  await n.scheduleNotificationAsync({
    identifier: args.identifier,
    content: {
      title: args.title,
      body: args.body,
      data: args.data,
      categoryIdentifier: TRIP_NOTIFICATION_CATEGORY_ID,
      sound: args.playSound,
      sticky: false,
      autoDismiss: true,
      ...(Platform.OS === 'android'
        ? {
            priority: args.priorityHigh
              ? n.AndroidNotificationPriority.HIGH
              : n.AndroidNotificationPriority.DEFAULT,
          }
        : {}),
    },
    trigger:
      Platform.OS === 'android' && args.priorityHigh
        ? { channelId: DEPARTURE_SIGNAL_CHANNEL_ID }
        : null,
  });
}

/**
 * Met à jour la notification persistante (silencieuse) et replanifie les signaux A/B.
 * Utilise `departure_sticky_{tripId}` et `departure_signal_a_{tripId}`.
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

  await ensureTripNotificationChannels(n);
  registerTripNotificationResponseListener();

  const stickyId = departureStickyIdentifier(input.tripTaskId);
  const payloadBase: TripNotificationPayload = {
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
      categoryIdentifier: TRIP_NOTIFICATION_CATEGORY_ID,
    }),
    trigger: androidSurveillanceTrigger() ?? null,
  });

  await cancelIdentifiers(n, [
    departureSignalAIdentifier(input.tripTaskId),
    departureSignalBIdentifier(input.tripTaskId),
    legacySentinelStickyIdentifier(input.tripTaskId),
  ]);

  await scheduleDateNotification(n, {
    identifier: departureSignalAIdentifier(input.tripTaskId),
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
      identifier: departureSignalBIdentifier(input.tripTaskId),
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

/** Mise à jour sticky Sentinel V4 — même ID que le contrat de départ (`departure_sticky_{tripId}`). */
export async function updateTripStickyFromSentinel(input: {
  tripTaskId: string;
  stateVersion: number;
  destination: string;
  targetArrivalMs: number;
  nowMs: number;
  tOptimisteMs: number;
  displayedWindowStartMs?: number;
  displayedWindowEndMs?: number;
  nextRealUpdateAtMs?: number | null;
  vigilanceStatus: string;
  trafficLabel?: string;
  lat?: number;
  lng?: number;
  staticDepartureAtMs?: number;
  modeSafety?: boolean;
}): Promise<void> {
  const n = getNotifications();
  if (!n) return;

  const safeVersion = Number.isFinite(Number(input.stateVersion)) ? Number(input.stateVersion) : 0;
  const lastVersion = lastStickyVersionByTrip.get(input.tripTaskId) ?? -1;
  if (safeVersion < lastVersion) return;
  lastStickyVersionByTrip.set(input.tripTaskId, safeVersion);

  const lat = typeof input.lat === 'number' ? input.lat : NaN;
  const lng = typeof input.lng === 'number' ? input.lng : NaN;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    coordsByTrip.set(input.tripTaskId, { lat, lng });
  }

  const destination = String(input.destination || '').trim() || i18n.t('timeline.untitled');
  const title = i18n.t('sentinel.notifTitle', {
    destination: input.destination,
    arrival: fmtHm(input.targetArrivalMs),
  });
  const statusLine = input.trafficLabel ?? input.vigilanceStatus;
  const updatedAt = i18n.t('sentinel.notifUpdatedAt', { time: fmtHm(input.nowMs) });
  const staticDepartureAtMs = Number.isFinite(Number(input.staticDepartureAtMs))
    ? Number(input.staticDepartureAtMs)
    : null;
  const displayedStartMs = Number.isFinite(Number(input.displayedWindowStartMs))
    ? Number(input.displayedWindowStartMs)
    : null;
  const displayedEndMs = Number.isFinite(Number(input.displayedWindowEndMs))
    ? Number(input.displayedWindowEndMs)
    : null;
  const nextRealUpdateAtMs = Number.isFinite(Number(input.nextRealUpdateAtMs))
    ? Number(input.nextRealUpdateAtMs)
    : null;
  const safetyLine = input.modeSafety === true ? i18n.t('sentinel.notifModeSafety') : null;
  const comfortLine =
    displayedStartMs !== null && displayedEndMs !== null
      ? i18n.t('sentinel.notifDepartureWindow', {
          start: fmtHm(displayedStartMs),
          end: fmtHm(displayedEndMs),
        })
      : null;
  const planLine =
    nextRealUpdateAtMs !== null
      ? i18n.t('sentinel.notifNextRealUpdateAt', { time: fmtHm(nextRealUpdateAtMs) })
      : null;
  const fallbackGauge = buildNewtonGauge({
    nowMs: input.nowMs,
    tOptimisteMs: input.tOptimisteMs,
    arrivalMs: input.targetArrivalMs,
  });
  const bodyParts = [
    staticDepartureAtMs !== null
      ? i18n.t('sentinel.notifDepartureAt', { time: fmtHm(staticDepartureAtMs) })
      : comfortLine ?? fallbackGauge,
    safetyLine ? `${safetyLine} • ${statusLine} • ${updatedAt}` : `${statusLine} • ${updatedAt}`,
    planLine,
  ].filter((x): x is string => Boolean(x));
  const body = bodyParts.join('\n');

  const coords = coordsByTrip.get(input.tripTaskId);
  const payload: TripNotificationPayload = {
    kind: 'sentinel_trip',
    tripTaskId: input.tripTaskId,
    destination,
    ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
  };

  await postImmediateTripNotification(n, {
    identifier: departureStickyIdentifier(input.tripTaskId),
    title,
    body,
    data: payload,
    stickyZen: true,
    playSound: false,
    priorityHigh: false,
  });
}

/** Dérive promesse PROBE2 — notification douce sans son (fenêtre recalculée). */
export async function sendTripPromiseDriftSoftNotification(input: {
  tripTaskId: string;
  destination: string;
  capsule: string;
}): Promise<void> {
  const n = getNotifications();
  if (!n) return;

  await postImmediateTripNotification(n, {
    identifier: `sentinel_promise_drift_${input.tripTaskId}_${Date.now()}`,
    title: i18n.t('sentinel.promiseDriftTitle', { destination: input.destination }),
    body: i18n.t('sentinel.promiseDriftBody', { capsule: input.capsule }),
    data: {
      kind: 'trip_promise_drift',
      tripTaskId: input.tripTaskId,
      destination: input.destination,
    },
    stickyZen: false,
    playSound: false,
    priorityHigh: false,
  });
}

/** Alerte Go/No-Go (sonde 3) — notification immédiate avec son. */
export async function sendTripGoNoGoNotification(input: {
  tripTaskId: string;
  destination: string;
  variant: 'smooth' | 'leave_now';
  departInMin: number;
  lat?: number;
  lng?: number;
}): Promise<void> {
  const n = getNotifications();
  if (!n) return;

  const title = i18n.t('sentinel.probe3Title', { destination: input.destination });
  const body =
    input.variant === 'smooth'
      ? i18n.t('sentinel.probe3Smooth', { minutes: Math.max(1, input.departInMin) })
      : i18n.t('sentinel.probe3LeaveNow');
  const payload: TripNotificationPayload = {
    kind: 'trip_gonogo',
    tripTaskId: input.tripTaskId,
    destination: input.destination,
    ...(Number.isFinite(input.lat) && Number.isFinite(input.lng)
      ? { lat: input.lat as number, lng: input.lng as number }
      : {}),
  };

  await postImmediateTripNotification(n, {
    identifier: `sentinel_gonogo_${input.tripTaskId}_${Date.now()}`,
    title,
    body,
    data: payload,
    stickyZen: false,
    playSound: true,
    priorityHigh: true,
  });
}

/** Estimation trafic indisponible (sonde 3). */
export async function sendTripProbeUnavailableNotification(input: {
  tripTaskId: string;
  destination: string;
}): Promise<void> {
  const n = getNotifications();
  if (!n) return;

  await postImmediateTripNotification(n, {
    identifier: `sentinel_probe_unavail_${input.tripTaskId}_${Date.now()}`,
    title: i18n.t('sentinel.probe3Title', { destination: input.destination }),
    body: i18n.t('sentinel.probe3Unavailable'),
    data: {
      kind: 'trip_probe_unavail',
      tripTaskId: input.tripTaskId,
      destination: input.destination,
    },
    stickyZen: false,
    playSound: true,
    priorityHigh: true,
  });
}

/** Annule sticky + signaux + legacy pour un trajet (alias explicite). */
export async function cancelTripNotifications(tripTaskId: string): Promise<void> {
  await clearAllDepartureNotifications(tripTaskId);
}
