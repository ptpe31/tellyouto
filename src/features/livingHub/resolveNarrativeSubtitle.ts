import type { TrankilV2TimelineItemRow } from '../../api';
import { resolveTripAlarmPlaceLabel } from '../../utils/tripElasticCapsuleModel';
import { isHubTripRow } from './hubCategoryRegistry';

function parseMetadataJson(raw: string | null | undefined): Record<string, unknown> | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function str(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/**
 * Sous-titre narratif (ligne 2) : alias lieu pour les trajets, lieu/contact contextuel sinon.
 * Priorité trajet : `destination_name` → `location_address`.
 */
export function resolveNarrativeSubtitle(row: TrankilV2TimelineItemRow): string | null {
  const meta = parseMetadataJson(row.metadata_json);
  const trip =
    meta?.trip && typeof meta.trip === 'object' && !Array.isArray(meta.trip)
      ? (meta.trip as Record<string, unknown>)
      : null;

  if (isHubTripRow(row)) {
    const place = resolveTripAlarmPlaceLabel(trip, row.display_title, '').trim();
    if (place) return place;
    const addr = str(trip, 'location_address') ?? str(meta, 'location_address');
    if (addr) return addr;
    return null;
  }

  const loc = str(meta, 'location_address');
  if (loc) return loc;
  const contact = str(meta, 'contact_name') ?? str(meta, 'contact');
  if (contact) return contact;
  return null;
}
