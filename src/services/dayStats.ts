import type { IntentionRow } from '../api/localDb';

export type SpectrumAxis = 'structure' | 'momentum' | 'zen' | 'stats';

/** Minutes attribuées à chaque axe du spectre (pondération des poids d’intention). */
export function distributeMinutesBySpectrum(
  rows: IntentionRow[],
): Record<SpectrumAxis, number> {
  const out: Record<SpectrumAxis, number> = {
    structure: 0,
    momentum: 0,
    zen: 0,
    stats: 0,
  };
  for (const row of rows) {
    const a = row.actual_duration ?? 0;
    if (a <= 0) continue;
    const w = row.weights;
    const sum = w.structure + w.momentum + w.zen + w.stats;
    const norm = sum > 0 ? sum : 4;
    out.structure += (a * w.structure) / norm;
    out.momentum += (a * w.momentum) / norm;
    out.zen += (a * w.zen) / norm;
    out.stats += (a * w.stats) / norm;
  }
  return out;
}

export function totalSpectrumMinutes(
  dist: Record<SpectrumAxis, number>,
): number {
  return (
    dist.structure + dist.momentum + dist.zen + dist.stats
  );
}

/** Pourcentages 0–100 pour affichage (somme ≈ 100). */
export function spectrumPercentages(
  dist: Record<SpectrumAxis, number>,
): Record<SpectrumAxis, number> {
  const t = totalSpectrumMinutes(dist);
  if (t <= 0) {
    return { structure: 0, momentum: 0, zen: 0, stats: 0 };
  }
  const pct = (n: number) => Math.round((100 * n) / t);
  return {
    structure: pct(dist.structure),
    momentum: pct(dist.momentum),
    zen: pct(dist.zen),
    stats: pct(dist.stats),
  };
}

export function dominantAxis(
  dist: Record<SpectrumAxis, number>,
): SpectrumAxis | null {
  const t = totalSpectrumMinutes(dist);
  if (t <= 0) return null;
  const axes: SpectrumAxis[] = [
    'structure',
    'momentum',
    'zen',
    'stats',
  ];
  return axes.reduce((best, k) =>
    dist[k] > dist[best] ? k : best,
  );
}

/**
 * Score de clarté 0–1 : doucement maximal quand le temps réel est proche de l’estimé.
 * (Courbe bienveillante, pas une note scolaire.)
 */
export function computeClarityScore01(rows: IntentionRow[]): number {
  if (rows.length === 0) return 0;
  let acc = 0;
  for (const row of rows) {
    const est = Math.max(1, row.estimated_duration);
    const act = Math.max(0, row.actual_duration ?? 0);
    if (act <= 0) continue;
    const ratio = act / est;
    const deviationOctaves = Math.abs(Math.log2(ratio + 1e-9));
    acc += Math.exp(-deviationOctaves * 0.42);
  }
  return acc / rows.length;
}

export function clarityPercent(rows: IntentionRow[]): number {
  return Math.round(computeClarityScore01(rows) * 100);
}
