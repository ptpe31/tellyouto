import { randomUUID } from 'expo-crypto';

import type { OneTapUniversalResult } from '../oneTapUniversalCapture';
import { getOrCreateViaUserId, withViaDb } from '../db/Schema';

export type LocationFavoriteRow = {
  alias: string;
  formattedAddress: string;
  placeId?: string | null;
  lat: number;
  lng: number;
};

export async function upsertLocationFavorite(input: LocationFavoriteRow): Promise<void> {
  const userId = await getOrCreateViaUserId();
  const now = Date.now();
  await withViaDb(async (db) => {
    const alias = input.alias.trim();
    const existing = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT id FROM via_locations WHERE user_id = ? AND LOWER(alias) = LOWER(?) LIMIT 1`,
      [userId, alias]
    );
    const id = existing?.id ? String(existing.id) : randomUUID();
    await db.runAsync(
      `INSERT OR REPLACE INTO via_locations (
        id, user_id, alias, formatted_address, place_id, lat, lng, created_at_ms, updated_at_ms, is_synced
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at_ms FROM via_locations WHERE id = ?), ?), ?, 0
      )`,
      [
        id,
        userId,
        alias,
        input.formattedAddress.trim(),
        input.placeId ?? null,
        input.lat,
        input.lng,
        id,
        now,
        now,
      ]
    );
  });
}

export async function getLocationFavoriteByAlias(alias: string): Promise<LocationFavoriteRow | null> {
  const key = String(alias || '').trim();
  if (!key) return null;
  const userId = await getOrCreateViaUserId();
  return withViaDb(async (db) => {
    const row = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT alias, formatted_address, place_id, lat, lng
         FROM via_locations
        WHERE user_id = ? AND LOWER(alias) = LOWER(?)
        LIMIT 1`,
      [userId, key]
    );
    if (!row) return null;
    return {
      alias: String(row.alias ?? '').trim(),
      formattedAddress: String(row.formatted_address ?? '').trim(),
      placeId: row.place_id == null ? null : String(row.place_id),
      lat: Number(row.lat ?? 0),
      lng: Number(row.lng ?? 0),
    };
  });
}

export async function hydrateOneTapDraftWithFavoriteAlias(
  draft: OneTapUniversalResult
): Promise<OneTapUniversalResult> {
  const data = draft.data as Record<string, unknown>;
  if (data.logisticsPotential !== true) return draft;
  const destinationName = String(data.destination_name ?? '').trim();
  const alreadyValidated =
    typeof data.location_lat === 'number' &&
    Number.isFinite(data.location_lat) &&
    typeof data.location_lng === 'number' &&
    Number.isFinite(data.location_lng) &&
    String(data.location_address ?? '').trim().length > 0;
  if (alreadyValidated) return draft;

  const favorite = await getLocationFavoriteByAlias(destinationName);
  if (!favorite) return draft;

  return {
    ...draft,
    data: {
      ...data,
      location_address: favorite.formattedAddress,
      location_lat: favorite.lat,
      location_lng: favorite.lng,
      location_place_id: favorite.placeId ?? `favorite:${favorite.alias}`,
      location_source: 'favorite',
    },
  };
}
