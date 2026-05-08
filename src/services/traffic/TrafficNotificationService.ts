import { Linking, Platform } from 'react-native';

import { getNotifications } from '../notifications';
import i18n from '../../locales/i18n';

export const SENTINEL_NOTIFICATION_CHANNEL_ID = 'sentinel_silent_updates';
export const SENTINEL_NOTIFICATION_CATEGORY_ID = 'sentinel_trip';
export const SENTINEL_ACTION_LAUNCH_ROUTE = 'sentinel_launch_route';

type SentinelPayload = {
  kind: 'sentinel_trip';
  tripTaskId: string;
  destination: string;
  lat?: number;
  lng?: number;
};

let listenerRegistered = false;
const coordsByTrip = new Map<string, { lat: number; lng: number }>();
const lastVersionByTrip = new Map<string, number>();

async function ensureSentinelChannel(): Promise<void> {
  const n = getNotifications();
  if (!n || Platform.OS !== 'android') return;
  await n.setNotificationChannelAsync(SENTINEL_NOTIFICATION_CHANNEL_ID, {
    name: 'Sentinel',
    importance: n.AndroidImportance.MIN,
    lockscreenVisibility: n.AndroidNotificationVisibility.PRIVATE,
    vibrationPattern: [0],
    showBadge: false,
    sound: null,
  });
}

async function ensureSentinelCategory(): Promise<void> {
  const n = getNotifications();
  if (!n) return;
  try {
    await n.setNotificationCategoryAsync(SENTINEL_NOTIFICATION_CATEGORY_ID, [
      {
        identifier: SENTINEL_ACTION_LAUNCH_ROUTE,
        buttonTitle: "Lancer l'itinéraire",
        options: { opensAppToForeground: true },
      },
    ]);
  } catch {
  }
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

async function openUniversalNavigation(destination: string, coords?: { lat: number; lng: number }): Promise<void> {
  const url = buildUniversalNavUrl(destination, coords);
  const supported = await Linking.canOpenURL(url);
  if (supported) {
    await Linking.openURL(url);
    return;
  }
  await Linking.openURL(
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`
  );
}

function ensureResponseListener(): void {
  if (listenerRegistered) return;
  const n = getNotifications();
  if (!n) return;
  listenerRegistered = true;
  n.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as SentinelPayload | undefined;
    if (data?.kind !== 'sentinel_trip') return;
    if (response.actionIdentifier !== SENTINEL_ACTION_LAUNCH_ROUTE) return;
    const destination = String(data.destination || '').trim();
    const lat = typeof data.lat === 'number' ? data.lat : NaN;
    const lng = typeof data.lng === 'number' ? data.lng : NaN;
    const coords = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
    void openUniversalNavigation(destination, coords);
  });
}

export class SentinelNotificationManager {
  async update(input: {
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
    const lastVersion = lastVersionByTrip.get(input.tripTaskId) ?? -1;
    if (safeVersion < lastVersion) return;
    lastVersionByTrip.set(input.tripTaskId, safeVersion);
    await ensureSentinelChannel();
    await ensureSentinelCategory();
    ensureResponseListener();
    const identifier = `sentinel_${input.tripTaskId}`;
    const lat = typeof input.lat === 'number' ? input.lat : NaN;
    const lng = typeof input.lng === 'number' ? input.lng : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      coordsByTrip.set(input.tripTaskId, { lat, lng });
    }
    const coords = coordsByTrip.get(input.tripTaskId);

    const payload: SentinelPayload = {
      kind: 'sentinel_trip',
      tripTaskId: input.tripTaskId,
      destination: input.destination,
      ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
    };
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
    await n.scheduleNotificationAsync({
      identifier,
      content: {
        title,
        body,
        data: payload,
        categoryIdentifier: SENTINEL_NOTIFICATION_CATEGORY_ID,
        sticky: true,
        autoDismiss: false,
        sound: false,
        priority: Platform.OS === 'android' ? n.AndroidNotificationPriority.MIN : undefined,
      },
      trigger: null,
    });
  }

  async cancel(tripTaskId: string): Promise<void> {
    const n = getNotifications();
    if (!n) return;
    const identifier = `sentinel_${tripTaskId}`;
    coordsByTrip.delete(tripTaskId);
    lastVersionByTrip.delete(tripTaskId);
    try {
      await n.dismissNotificationAsync(identifier);
    } catch {
    }
    try {
      await n.cancelScheduledNotificationAsync(identifier);
    } catch {
    }
  }
}
