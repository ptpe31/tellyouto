/** Pastels autorisés (bleu / vert / violet) — pas de rouge, orange ni rose. */
export function categoryPastelTabBackground(categoryId: string | null | undefined): string {
  const up = String(categoryId || '').trim().toUpperCase();
  const blue = new Set(['WORK', 'FINANCE', 'LEARN', 'TRAVEL', 'OTHER']);
  const green = new Set(['HOME', 'HEALTH', 'SHOP']);
  const violet = new Set(['PERSO', 'SOCIAL']);
  if (blue.has(up)) return '#D6E9FF';
  if (green.has(up)) return '#D7F5E8';
  if (violet.has(up)) return '#E8DCFF';
  return '#D6E9FF';
}
