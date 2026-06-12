import { patchMetadata, updateTrankilV2IntentionLocationAddress } from '../../api/trankilV2Db';
import type { AddressSelection } from '../addressResolver';
import { getTripMetaFromRoot } from '../../utils/tripTimelineCard';
import { upsertLocalPlaceFromSelection } from '../localPlaces';
import { upsertLocationFavorite } from './locationFavorites';

function safeParseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  } catch {
    return null;
  }
}

function str(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function touchValidateTrip(root: Record<string, unknown>, patchTrip: Record<string, unknown>): Record<string, unknown> {
  const tMeta = getTripMetaFromRoot(root);
  if (tMeta && tMeta.validatedAtMs) return patchTrip;
  return { ...patchTrip, validatedAtMs: Date.now() };
}

function mergeMetadataTripJson(root: Record<string, unknown>, tripPatch: Record<string, unknown>): string {
  const trip = getTripMetaFromRoot(root) ?? {};
  return JSON.stringify({ ...root, trip: { ...trip, ...tripPatch } });
}

export async function persistTripArrivalAddress(input: {
  intentionId: string;
  metadataJson: string | null | undefined;
  place: AddressSelection;
}): Promise<{ metadata_json: string }> {
  const root = safeParseJsonObject(input.metadataJson) ?? {};
  const tripMeta = getTripMetaFromRoot(root) ?? {};
  const tripPatch = touchValidateTrip(root, {
    location_address: input.place.formattedAddress,
    location_place_id: input.place.placeId,
    location_lat: input.place.lat,
    location_lng: input.place.lng,
    location_source: input.place.placeId.startsWith('favorite:') ? 'local' : 'mapbox',
  });

  await updateTrankilV2IntentionLocationAddress(
    input.intentionId,
    { location_address: input.place.formattedAddress },
    { silent: true },
  );
  await patchMetadata(input.intentionId, { trip: tripPatch }, { silent: true });

  try {
    await upsertLocalPlaceFromSelection(input.place, str(tripMeta, 'destination_name') ?? undefined);
  } catch {
    /* silent — no UI */
  }

  const alias = str(tripMeta, 'destination_name');
  if (alias) {
    try {
      await upsertLocationFavorite({
        alias,
        formattedAddress: input.place.formattedAddress,
        lat: input.place.lat,
        lng: input.place.lng,
      });
    } catch {
      /* silent — no UI */
    }
  }

  return { metadata_json: mergeMetadataTripJson(root, tripPatch) };
}

export async function persistTripOriginAddress(input: {
  intentionId: string;
  metadataJson: string | null | undefined;
  place: AddressSelection;
}): Promise<{ metadata_json: string }> {
  const root = safeParseJsonObject(input.metadataJson) ?? {};
  const tripPatch = touchValidateTrip(root, {
    origin_address: input.place.formattedAddress,
    origin_place_id: input.place.placeId,
    origin_lat: input.place.lat,
    origin_lng: input.place.lng,
  });

  await patchMetadata(input.intentionId, { trip: tripPatch }, { silent: true });

  return { metadata_json: mergeMetadataTripJson(root, tripPatch) };
}
