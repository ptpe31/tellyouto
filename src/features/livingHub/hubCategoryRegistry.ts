/** Catégories IA natives — ordre d'affichage et emojis du hub email. */
export const HUB_CATEGORY_ORDER = [
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
