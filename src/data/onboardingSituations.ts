import type { SpectrumWeights } from '../context/UserSpectrumContext';

/** Delta appliqué au spectre courant lors du choix d’une réponse */
export type WeightDelta = Partial<SpectrumWeights>;

export type OnboardingSituationId = 's1' | 's2' | 's3' | 's4' | 's5';

export type OnboardingSituation = {
  id: OnboardingSituationId;
  /** 4 réponses — indices 0..3, clés i18n : onboarding.situations.{id}.a0 … a3 */
  deltas: [WeightDelta, WeightDelta, WeightDelta, WeightDelta];
};

/**
 * 5 situations quotidiennes — chaque réponse ajuste Structure, Momentum, Zen, Stats.
 * Les poids finaux sont normalisés (somme = 1) après les 5 choix.
 */
export const ONBOARDING_SITUATIONS: OnboardingSituation[] = [
  {
    id: 's1',
    deltas: [
      { structure: 0.08, momentum: -0.02, zen: -0.02, stats: 0.02 },
      { structure: -0.03, momentum: 0.1, zen: -0.03, stats: 0.02 },
      { structure: -0.04, momentum: -0.02, zen: 0.1, stats: -0.02 },
      { structure: -0.02, momentum: 0.02, zen: -0.02, stats: 0.08 },
    ],
  },
  {
    id: 's2',
    deltas: [
      { structure: 0.06, momentum: 0.04, zen: -0.05, stats: 0.02 },
      { structure: -0.02, momentum: 0.1, zen: 0.02, stats: -0.04 },
      { structure: 0.04, momentum: -0.04, zen: 0.08, stats: -0.02 },
      { structure: 0.02, momentum: 0.02, zen: 0.02, stats: 0.06 },
    ],
  },
  {
    id: 's3',
    deltas: [
      { structure: 0.05, momentum: 0.05, zen: -0.04, stats: 0.02 },
      { structure: -0.03, momentum: -0.02, zen: 0.12, stats: -0.03 },
      { structure: 0.06, momentum: 0.06, zen: -0.02, stats: 0.02 },
      { structure: -0.02, momentum: 0.04, zen: 0.04, stats: 0.06 },
    ],
  },
  {
    id: 's4',
    deltas: [
      { structure: 0.12, momentum: 0.04, zen: -0.04, stats: 0.04 },
      { structure: -0.02, momentum: 0.12, zen: -0.04, stats: 0.02 },
      { structure: 0.04, momentum: -0.02, zen: 0.08, stats: 0.02 },
      { structure: 0.04, momentum: 0.02, zen: -0.02, stats: 0.1 },
    ],
  },
  {
    id: 's5',
    deltas: [
      { structure: 0.06, momentum: 0.02, zen: 0.02, stats: 0.04 },
      { structure: -0.02, momentum: 0.08, zen: 0.04, stats: 0.02 },
      { structure: 0.04, momentum: -0.02, zen: 0.1, stats: -0.02 },
      { structure: 0.02, momentum: 0.02, zen: -0.02, stats: 0.08 },
    ],
  },
];

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function applyDelta(
  current: SpectrumWeights,
  delta: WeightDelta,
): SpectrumWeights {
  return {
    structure: clamp01(
      current.structure + (delta.structure ?? 0),
    ),
    momentum: clamp01(
      current.momentum + (delta.momentum ?? 0),
    ),
    zen: clamp01(current.zen + (delta.zen ?? 0)),
    stats: clamp01(current.stats + (delta.stats ?? 0)),
  };
}

/** Normalise pour que la somme des 4 poids = 1 (spectre cohérent) */
export function normalizeSpectrumWeights(w: SpectrumWeights): SpectrumWeights {
  const sum =
    w.structure + w.momentum + w.zen + w.stats;
  if (sum <= 0) {
    return {
      structure: 0.25,
      momentum: 0.25,
      zen: 0.25,
      stats: 0.25,
    };
  }
  return {
    structure: w.structure / sum,
    momentum: w.momentum / sum,
    zen: w.zen / sum,
    stats: w.stats / sum,
  };
}

export function initialOnboardingWeights(): SpectrumWeights {
  return {
    structure: 0.25,
    momentum: 0.25,
    zen: 0.25,
    stats: 0.25,
  };
}
