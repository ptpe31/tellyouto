import { withTrankilV2Database } from '../api/trankilV2Db';
import type { AddressSelection } from './addressResolver';

export type LocalPlaceRow = {
  id: string;
  name: string;
  formattedAddress: string;
  placeId: string | null;
  lat: number;
  lng: number;
  lastUsedAt: number;
  createdAt: number;
};

let schemaReady = false;

export async function ensureLocalPlacesSchema(): Promise<void> {
  if (schemaReady) return;
  await withTrankilV2Database(async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS local_places (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        formatted_address TEXT NOT NULL,
        place_id TEXT,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        last_used_at INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_local_places_name ON local_places (name);
      CREATE INDEX IF NOT EXISTS idx_local_places_formatted_address ON local_places (formatted_address);
      CREATE INDEX IF NOT EXISTS idx_local_places_last_used_at ON local_places (last_used_at DESC);
    `);

    await db.execAsync('BEGIN IMMEDIATE;');
    try {
      await db.execAsync(`
        INSERT OR IGNORE INTO local_places (id, name, formatted_address, place_id, lat, lng, last_used_at, created_at)
        SELECT
          'favorite:' || alias,
          alias,
          formatted_address,
          NULL,
          lat,
          lng,
          updated_at,
          updated_at
        FROM location_favorites
        WHERE alias IS NOT NULL AND TRIM(alias) != '';
      `);
      await db.execAsync('COMMIT;');
    } catch (err) {
      await db.execAsync('ROLLBACK;');
      throw err;
    }
  });
  schemaReady = true;
}

function rowToLocalPlace(row: Record<string, unknown>): LocalPlaceRow {
  return {
    id: String(row.id ?? '').trim(),
    name: String(row.name ?? '').trim(),
    formattedAddress: String(row.formatted_address ?? '').trim(),
    placeId: row.place_id != null ? String(row.place_id).trim() || null : null,
    lat: Number(row.lat ?? 0),
    lng: Number(row.lng ?? 0),
    lastUsedAt: Number(row.last_used_at ?? 0),
    createdAt: Number(row.created_at ?? 0),
  };
}

export async function searchLocalPlaces(query: string, limit = 10): Promise<LocalPlaceRow[]> {
  const q = String(query ?? '').trim();
  if (!q) return [];
  await ensureLocalPlacesSchema();
  const pattern = `%${q}%`;
  return withTrankilV2Database(async (db) => {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT id, name, formatted_address, place_id, lat, lng, last_used_at, created_at
       FROM local_places
       WHERE name LIKE ? COLLATE NOCASE OR formatted_address LIKE ? COLLATE NOCASE
       ORDER BY last_used_at DESC
       LIMIT ?`,
      [pattern, pattern, limit],
    );
    return rows.map(rowToLocalPlace).filter((r) => r.id && r.formattedAddress);
  });
}

export async function getLocalPlaceById(id: string): Promise<LocalPlaceRow | null> {
  const key = String(id ?? '').trim();
  if (!key) return null;
  await ensureLocalPlacesSchema();
  return withTrankilV2Database(async (db) => {
    const row = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT id, name, formatted_address, place_id, lat, lng, last_used_at, created_at
       FROM local_places WHERE id = ?`,
      [key],
    );
    return row ? rowToLocalPlace(row) : null;
  });
}

export async function upsertLocalPlace(input: {
  id?: string;
  name: string;
  formattedAddress: string;
  placeId?: string | null;
  lat: number;
  lng: number;
}): Promise<LocalPlaceRow> {
  const now = Date.now();
  const name = String(input.name ?? '').trim();
  const formattedAddress = String(input.formattedAddress ?? '').trim();
  const placeId = input.placeId != null ? String(input.placeId).trim() || null : null;
  const id =
    String(input.id ?? '').trim() ||
    (placeId ? `mapbox:${placeId}` : `local:${formattedAddress.toLowerCase().slice(0, 64)}`);

  await ensureLocalPlacesSchema();
  await withTrankilV2Database(async (db) => {
    await db.runAsync(
      `INSERT INTO local_places (id, name, formatted_address, place_id, lat, lng, last_used_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         formatted_address = excluded.formatted_address,
         place_id = excluded.place_id,
         lat = excluded.lat,
         lng = excluded.lng,
         last_used_at = excluded.last_used_at`,
      [id, name, formattedAddress, placeId, input.lat, input.lng, now, now],
    );
  });

  const row = await getLocalPlaceById(id);
  if (!row) throw new Error('localPlaces: upsert failed');
  return row;
}

export async function upsertLocalPlaceFromSelection(
  place: AddressSelection,
  nameHint?: string,
): Promise<LocalPlaceRow> {
  const name = String(nameHint ?? place.formattedAddress).trim() || place.formattedAddress;
  return upsertLocalPlace({
    id: place.placeId.startsWith('favorite:') ? place.placeId : undefined,
    name,
    formattedAddress: place.formattedAddress,
    placeId: place.placeId,
    lat: place.lat,
    lng: place.lng,
  });
}

export async function touchLocalPlaceLastUsed(id: string): Promise<void> {
  const key = String(id ?? '').trim();
  if (!key) return;
  await ensureLocalPlacesSchema();
  await withTrankilV2Database(async (db) => {
    await db.runAsync(`UPDATE local_places SET last_used_at = ? WHERE id = ?`, [Date.now(), key]);
  });
}

export async function purgeStaleLocalPlaces(months = 6): Promise<number> {
  await ensureLocalPlacesSchema();
  const cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
  return withTrankilV2Database(async (db) => {
    const result = await db.runAsync(
      `DELETE FROM local_places WHERE last_used_at > 0 AND last_used_at < ?`,
      [cutoff],
    );
    return result.changes ?? 0;
  });
}
