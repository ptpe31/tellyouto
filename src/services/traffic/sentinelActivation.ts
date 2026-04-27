import { randomUUID } from 'expo-crypto';

import { computeNewtonWindow } from './TrafficEngine';
import { SentinelNotificationManager } from './TrafficNotificationService';
import i18n from '../../locales/i18n';
import { getOrCreateViaUserId, withViaDb } from '../db/Schema';

export async function activateSentinelTrip(input: {
  tripTaskId: string;
  formattedAddress: string;
  targetArrivalMs: number;
  initialDurationSec?: number;
  lat?: number;
  lng?: number;
  sentinelMode?: 'SENTINEL' | 'STATIC';
  placeId?: string | null;
}): Promise<{ tOptimisteMs: number; tPessimisteMs: number }> {
  const nowMs = Date.now();
  const durationSec = Math.max(0, Number(input.initialDurationSec ?? 25 * 60) || 0);
  const { tOptimisteMs, tPessimisteMs } = computeNewtonWindow(input.targetArrivalMs, durationSec);
  const sentinelMode = input.sentinelMode ?? 'SENTINEL';
  const vigilanceStatus =
    nowMs >= input.targetArrivalMs
      ? 'FINISHED'
      : nowMs >= tPessimisteMs
        ? 'VIGILANCE_RED'
        : nowMs >= tOptimisteMs
          ? 'VIGILANCE_ORANGE'
          : 'VIGILANCE_BLUE';

  const userId = await getOrCreateViaUserId();
  await withViaDb(async (db) => {
    const formattedAddress = input.formattedAddress.trim();
    const placeId = input.placeId ? String(input.placeId).trim() : '';
    const lookup = placeId
      ? await db.getFirstAsync<Record<string, unknown>>(
          `SELECT id FROM via_locations WHERE user_id = ? AND place_id = ? LIMIT 1`,
          [userId, placeId]
        )
      : await db.getFirstAsync<Record<string, unknown>>(
          `SELECT id FROM via_locations WHERE user_id = ? AND formatted_address = ? LIMIT 1`,
          [userId, formattedAddress]
        );
    const id = lookup?.id ? String(lookup.id) : randomUUID();
    await db.runAsync(
      `INSERT OR REPLACE INTO via_locations (
        id, user_id, alias, formatted_address, place_id, lat, lng, created_at_ms, updated_at_ms, is_synced
      ) VALUES (
        ?, ?, NULL, ?, ?, ?, ?, COALESCE((SELECT created_at_ms FROM via_locations WHERE id = ?), ?), ?, 0
      )`,
      [
        id,
        userId,
        formattedAddress,
        placeId || null,
        typeof input.lat === 'number' ? input.lat : null,
        typeof input.lng === 'number' ? input.lng : null,
        id,
        nowMs,
        nowMs,
      ]
    );
    await db.runAsync(
      `INSERT OR REPLACE INTO via_sentinel_trips (
        id, user_id, location_id, target_arrival_ms, status, sentinel_mode,
        last_traffic_duration_sec, internal_scan_count, next_check_at_ms, gate_prompted_at_ms, last_error_at_ms,
        t_optimiste_ms, t_pessimiste_ms, vigilance_status, created_at_ms, updated_at_ms, is_synced
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?, ?, ?, ?, ?, 0
      )`,
      [
        input.tripTaskId,
        userId,
        id,
        input.targetArrivalMs,
        vigilanceStatus === 'FINISHED' ? 'DONE' : 'ACTIVE',
        sentinelMode,
        durationSec,
        tOptimisteMs,
        tPessimisteMs,
        vigilanceStatus,
        nowMs,
        nowMs,
      ]
    );
    return;
  });

  const manager = new SentinelNotificationManager();
  if (vigilanceStatus === 'FINISHED') {
    await manager.cancel(input.tripTaskId);
  } else {
    const trafficLabel =
      sentinelMode === 'STATIC'
        ? i18n.t('sentinel.notifStatusStatic')
        : vigilanceStatus === 'VIGILANCE_BLUE'
          ? i18n.t('sentinel.notifStatusBlue')
          : vigilanceStatus === 'VIGILANCE_ORANGE'
            ? i18n.t('sentinel.notifStatusOrange')
            : vigilanceStatus === 'VIGILANCE_RED'
              ? i18n.t('sentinel.notifStatusRed')
              : String(vigilanceStatus);
    await manager.update({
      tripTaskId: input.tripTaskId,
      destination: input.formattedAddress.trim(),
      targetArrivalMs: input.targetArrivalMs,
      nowMs,
      tOptimisteMs,
      vigilanceStatus,
      lat: typeof input.lat === 'number' ? input.lat : undefined,
      lng: typeof input.lng === 'number' ? input.lng : undefined,
      staticDepartureAtMs: sentinelMode === 'STATIC' ? tPessimisteMs : undefined,
      trafficLabel,
    });
  }

  return { tOptimisteMs, tPessimisteMs };
}
