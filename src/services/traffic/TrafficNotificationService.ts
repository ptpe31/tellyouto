import { Platform } from 'react-native';

import { getNotifications } from '../notifications';

export const SENTINEL_NOTIFICATION_CHANNEL_ID = 'sentinel_silent_updates';

type SentinelPayload = {
  kind: 'sentinel_trip';
  tripTaskId: string;
  destination: string;
};

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

export class SentinelNotificationManager {
  async update(input: {
    tripTaskId: string;
    destination: string;
    targetArrivalMs: number;
    nowMs: number;
    tOptimisteMs: number;
    vigilanceStatus: string;
    trafficLabel?: string;
  }): Promise<void> {
    const n = getNotifications();
    if (!n) return;
    await ensureSentinelChannel();

    const existing = await this.findPresentedNotificationId(input.tripTaskId);
    if (existing) {
      try {
        await n.dismissNotificationAsync(existing);
      } catch {
      }
    }

    const payload: SentinelPayload = {
      kind: 'sentinel_trip',
      tripTaskId: input.tripTaskId,
      destination: input.destination,
    };
    const title = `Vers : ${input.destination} • Arrivée ${fmtHm(input.targetArrivalMs)}`;
    const gauge = buildNewtonGauge({
      nowMs: input.nowMs,
      tOptimisteMs: input.tOptimisteMs,
      arrivalMs: input.targetArrivalMs,
    });
    const line3 = `${input.trafficLabel ?? input.vigilanceStatus} • Mis à jour à ${fmtHm(input.nowMs)}`;
    await n.scheduleNotificationAsync({
      content: {
        title,
        body: `${gauge}\n${line3}`,
        data: payload,
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
    try {
      const existing = await this.findPresentedNotificationId(tripTaskId);
      if (existing) await n.dismissNotificationAsync(existing);
    } catch {
    }
  }

  private async findPresentedNotificationId(tripTaskId: string): Promise<string | null> {
    const n = getNotifications();
    if (!n) return null;
    const presented = await n.getPresentedNotificationsAsync();
    const match = presented.find((p) => {
      const d = p.request.content.data as SentinelPayload | undefined;
      return d?.kind === 'sentinel_trip' && d.tripTaskId === tripTaskId;
    });
    return match?.request.identifier ?? null;
  }
}
