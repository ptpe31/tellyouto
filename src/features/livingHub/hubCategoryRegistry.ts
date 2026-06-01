import type { TrankilV2TimelineItemRow } from '../../api';

/** Catégories IA natives — ordre d'affichage et emojis du hub email. */
export const HUB_CATEGORY_ORDER = [
  /** Bloc virtuel Living Hub : tous les TRIP (court-circuit category_id Pass 1). */
  'TRIPS_HUB',
  'HOME',
  'WORK',
  'HEALTH',
  'PERSO',
  'SHOP',
  'FINANCE',
  'TRAVEL',
  'SOCIAL',
  'LEARN',
  'OTHER',
] as const;

export type HubCategoryId = (typeof HUB_CATEGORY_ORDER)[number];

export const HUB_CATEGORY_EMOJI: Record<HubCategoryId, string> = {
  TRIPS_HUB: '🏁',
  HOME: '🏠',
  WORK: '💼',
  HEALTH: '🩺',
  PERSO: '👤',
  SHOP: '🛒',
  FINANCE: '💰',
  TRAVEL: '✈️',
  SOCIAL: '👥',
  LEARN: '📚',
  OTHER: '⚡',
};

function safeParseTripMeta(raw: string | null | undefined): Record<string, unknown> | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const meta = v as Record<string, unknown>;
    const trip = meta.trip;
    if (!trip || typeof trip !== 'object' || Array.isArray(trip)) return null;
    return trip as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Ligne logistique TRIP (type ou bloc `metadata_json.trip`). */
export function isHubTripRow(row: TrankilV2TimelineItemRow): boolean {
  if (String(row.type ?? '').trim().toUpperCase() === 'TRIP') return true;
  return Boolean(safeParseTripMeta(row.metadata_json));
}

/**
 * Catégorie hub email : TRIP → `TRIPS_HUB` (priorité affichage), sinon Pass 1 `category_id`.
 * Projection UI uniquement — ne modifie pas SQLite.
 */
export function resolveHubBlockCategoryId(row: TrankilV2TimelineItemRow): HubCategoryId {
  if (isHubTripRow(row)) return 'TRIPS_HUB';
  return normalizeHubCategoryId(row.category_id);
}

export function normalizeHubCategoryId(raw: unknown): HubCategoryId {
  const up = String(raw ?? '').trim().toUpperCase();
  if (!up) return 'PERSO';
  if (up === 'FAMILLE') return 'HOME';
  if (up === 'PRO') return 'WORK';
  if ((HUB_CATEGORY_ORDER as readonly string[]).includes(up)) return up as HubCategoryId;
  return 'PERSO';
}

export function hubCategorySortIndex(categoryId: HubCategoryId): number {
  const idx = HUB_CATEGORY_ORDER.indexOf(categoryId);
  return idx >= 0 ? idx : HUB_CATEGORY_ORDER.length;
}

export function hubCategoryEmoji(categoryId: HubCategoryId): string {
  return HUB_CATEGORY_EMOJI[categoryId] ?? HUB_CATEGORY_EMOJI.OTHER;
}

/** Libellé hub / modale catégorie (TRIPS_HUB → i18n dédié, pas `category.VOYAGE`). */
export function hubCategoryDisplayTitle(
  categoryId: HubCategoryId,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (categoryId === 'TRIPS_HUB') {
    return t('timeline.smartClusters.tripsTitle');
  }
  return t(`category.${categoryId}`, { defaultValue: categoryId });
}
