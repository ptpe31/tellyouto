import { randomUUID } from 'expo-crypto';

import { getOrCreateViaUserId, withViaDb } from '../db/Schema';

export async function ensureViaSentinelSchema(): Promise<void> {
  await withViaDb(async () => undefined);
}

export async function upsertViaSentinelTrip(input: {
  tripId: string;
  destination: string;
  arrivalAtMs: number;
  status: string;
  sentinelMode: 'SENTINEL' | 'STATIC';
  lastTrafficDurationSec: number;
  internalScanCount: number;
  nextCheckAtMs: number | null;
  gatePromptedAtMs: number | null;
  lastErrorAtMs: number | null;
  tOptimisteMs: number | null;
  tPessimisteMs: number | null;
  vigilanceStatus: string | null;
  lat?: number;
  lng?: number;
  placeId?: string | null;
}): Promise<void> {
  const userId = await getOrCreateViaUserId();
  const now = Date.now();
  const destination = String(input.destination ?? '').trim();
  const placeId = input.placeId ? String(input.placeId).trim() : '';

  await withViaDb(async (db) => {
    const found = placeId
      ? await db.getFirstAsync<Record<string, unknown>>(
          `SELECT id FROM via_locations WHERE user_id = ? AND place_id = ? LIMIT 1`,
          [userId, placeId]
        )
      : await db.getFirstAsync<Record<string, unknown>>(
          `SELECT id FROM via_locations WHERE user_id = ? AND formatted_address = ? LIMIT 1`,
          [userId, destination]
        );
    const locationId = found?.id ? String(found.id) : randomUUID();

    await db.runAsync(
      `INSERT OR REPLACE INTO via_locations (
        id, user_id, alias, formatted_address, place_id, lat, lng, created_at_ms, updated_at_ms, is_synced
      ) VALUES (
        ?, ?, NULL, ?, ?, ?, ?, COALESCE((SELECT created_at_ms FROM via_locations WHERE id = ?), ?), ?, 0
      )`,
      [
        locationId,
        userId,
        destination,
        placeId || null,
        typeof input.lat === 'number' ? input.lat : null,
        typeof input.lng === 'number' ? input.lng : null,
        locationId,
        now,
        now,
      ]
    );

    await db.runAsync(
      `INSERT OR REPLACE INTO via_sentinel_trips (
        id, user_id, location_id, target_arrival_ms, status, sentinel_mode,
        last_traffic_duration_sec, internal_scan_count, next_check_at_ms, gate_prompted_at_ms, last_error_at_ms,
        t_optimiste_ms, t_pessimiste_ms, vigilance_status, created_at_ms, updated_at_ms, is_synced
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, COALESCE((SELECT created_at_ms FROM via_sentinel_trips WHERE id = ?), ?), ?, 0
      )`,
      [
        input.tripId,
        userId,
        locationId,
        Math.max(0, Number(input.arrivalAtMs) || 0),
        String(input.status ?? 'ACTIVE'),
        input.sentinelMode,
        Math.max(0, Number(input.lastTrafficDurationSec) || 0),
        Math.max(0, Number(input.internalScanCount) || 0),
        input.nextCheckAtMs == null ? null : Number(input.nextCheckAtMs),
        input.gatePromptedAtMs == null ? null : Number(input.gatePromptedAtMs),
        input.lastErrorAtMs == null ? null : Number(input.lastErrorAtMs),
        input.tOptimisteMs == null ? null : Number(input.tOptimisteMs),
        input.tPessimisteMs == null ? null : Number(input.tPessimisteMs),
        input.vigilanceStatus == null ? null : String(input.vigilanceStatus),
        input.tripId,
        now,
        now,
      ]
    );
  });
}

