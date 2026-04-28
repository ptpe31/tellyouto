import { withTrankilV2Database } from '../../api/trankilV2Db';
import type { OneTapUniversalResult } from '../oneTapUniversalCapture';

export type LocationFavoriteRow = {
  alias: string;
  formattedAddress: string;
  lat: number;
  lng: number;
};

export async function ensureLocationFavoritesSchema(): Promise<void> {
  await withTrankilV2Database(async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS location_favorites (
        alias TEXT PRIMARY KEY NOT NULL,
        formatted_address TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL
      );
    `);
  });
}

export async function upsertLocationFavorite(input: LocationFavoriteRow): Promise<void> {
  await ensureLocationFavoritesSchema();
  await withTrankilV2Database(async (db) => {
    await db.runAsync(
      `INSERT OR REPLACE INTO location_favorites (alias, formatted_address, lat, lng)
       VALUES (?, ?, ?, ?)`,
      [input.alias.trim(), input.formattedAddress.trim(), input.lat, input.lng]
    );
  });
}

export async function getLocationFavoriteByAlias(alias: string): Promise<LocationFavoriteRow | null> {
  const key = String(alias || '').trim();
  if (!key) return null;
  await ensureLocationFavoritesSchema();
  return withTrankilV2Database(async (db) => {
    const row = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT alias, formatted_address, lat, lng FROM location_favorites WHERE LOWER(alias) = LOWER(?)`,
      [key]
    );
    if (!row) return null;
    return {
      alias: String(row.alias ?? '').trim(),
      formattedAddress: String(row.formatted_address ?? '').trim(),
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
      location_place_id: `favorite:${favorite.alias}`,
      location_source: 'favorite',
    },
  };
}
