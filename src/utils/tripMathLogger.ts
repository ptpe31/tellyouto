/** Raisons de sonde élastique tracées par [TRIP-MATH]. */
export type TripMathProbeReason = 'PROBE1_CONFIG' | 'PROBE1_RETRY' | 'PROBE2_TREND' | 'PROBE3_GONOGO';

/** Kill switch — passer à `false` pour couper tous les logs [TRIP-MATH]. */
export const ENABLE_TRIP_MATH_LOGS = true;

export type TripMathLogInput = {
  reason: TripMathProbeReason;
  alias: string;
  targetArrivalMs: number;
  /** Durée trajet API courante (minutes). */
  apiTrajetMin: number;
  /** Marge de sécurité appliquée (minutes). */
  bufferMin: number;
  windowStartMs: number;
  windowEndMs: number;
  /** Durée trajet du scan précédent (minutes) — PROBE2/3 uniquement. */
  previousTrajetMin?: number | null;
  /** Vitesse de croissance embouteillage (min/min) — PROBE2 uniquement. */
  congestionGrowthRateMinPerMin?: number | null;
  /** Durée projetée après tendance (minutes) — PROBE2 uniquement. */
  projectedTrajetMin?: number | null;
};

function fmtHm(ms: number): string {
  if (!Number.isFinite(ms)) return '--:--';
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatDelta(previousMin: number, currentMin: number): string {
  const delta = Math.round(currentMin - previousMin);
  if (delta === 0) return '±0m';
  return delta > 0 ? `+${delta}m` : `${delta}m`;
}

function formatGrowthRate(rateMinPerMin: number): string {
  const rounded = Math.round(rateMinPerMin * 10) / 10;
  if (rounded === 0) return '±0m/min';
  return rounded > 0 ? `+${rounded}m/min` : `${rounded}m/min`;
}

export function resolveTripMathAlias(
  tripMeta: Record<string, unknown> | null | undefined,
  fallbackDestination: string,
): string {
  const alias = tripMeta ? String(tripMeta.destination_name ?? '').trim() : '';
  const fb = String(fallbackDestination ?? '').trim();
  return alias || fb || '—';
}

/** Log observationnel du créneau élastique — aucun effet métier. */
export function logTripMath(input: TripMathLogInput): void {
  if (!ENABLE_TRIP_MATH_LOGS) return;

  const alias = input.alias || '—';
  const slot = `${fmtHm(input.windowStartMs)} - ${fmtHm(input.windowEndMs)}`;
  const arrival = fmtHm(input.targetArrivalMs);

  if (input.reason === 'PROBE1_CONFIG' || input.reason === 'PROBE1_RETRY') {
    const retryTag = input.reason === 'PROBE1_RETRY' ? ' (retry)' : '';
    console.log(
      `[TRIP-MATH] 🧮 [PROBE1] Calcul pour "${alias}"${retryTag} | Arrivée: ${arrival} | Trajet API: ${input.apiTrajetMin}m | Marge: +${input.bufferMin}m | Créneau Départ: ${slot}`,
    );
    return;
  }

  const delta =
    input.previousTrajetMin != null && Number.isFinite(input.previousTrajetMin)
      ? ` (${formatDelta(input.previousTrajetMin, input.apiTrajetMin)})`
      : '';

  if (input.reason === 'PROBE2_TREND') {
    const hasTrend =
      input.congestionGrowthRateMinPerMin != null &&
      Number.isFinite(input.congestionGrowthRateMinPerMin) &&
      input.projectedTrajetMin != null &&
      Number.isFinite(input.projectedTrajetMin);
    if (hasTrend) {
      console.log(
        `[TRIP-MATH] 🧮 [PROBE2] Ajustement "${alias}" | Trajet: ${input.apiTrajetMin}m${delta} | Vitesse Congestion: ${formatGrowthRate(input.congestionGrowthRateMinPerMin!)} | Projection finale: ${input.projectedTrajetMin}m | Nouveau Créneau: ${slot}`,
      );
      return;
    }
    console.log(
      `[TRIP-MATH] 🧮 [PROBE2] Ajustement "${alias}" | Trajet API: ${input.apiTrajetMin}m${delta} | Nouveau Créneau: ${slot}`,
    );
    return;
  }

  console.log(
    `[TRIP-MATH] 🧮 [PROBE3] Final "${alias}" | Arrivée: ${arrival} | Trajet API: ${input.apiTrajetMin}m${delta} | Créneau Départ: ${slot}`,
  );
}
