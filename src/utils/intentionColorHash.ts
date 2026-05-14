/**
 * Pastels type « Apple » (8 teintes), déterministes par titre — **sans** rouge ni rose.
 * Utilisé pour le mixeur d’intentions (DealerBoard + feuille Talk).
 */
const INTENTION_PASTEL_PALETTE = [
  '#A8D4F0', // ciel
  '#B8E8D4', // menthe
  '#C5DDF5', // bleu pervenche
  '#FFF2B8', // citron doux
  '#B8E8F0', // cyan glace
  '#D2E8C4', // sauge
  '#D4D8FA', // lavande (froid)
  '#C4EDE4', // lagon
] as const;

/** DJB2 sur le titre normalisé → index stable dans la palette. */
export function getIntentionColor(title: string): string {
  const s = String(title ?? '').trim().toLowerCase();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) + h + s.charCodeAt(i);
    h |= 0;
  }
  const idx = Math.abs(h) % INTENTION_PASTEL_PALETTE.length;
  return INTENTION_PASTEL_PALETTE[idx]!;
}
