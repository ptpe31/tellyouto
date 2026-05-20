/** Raisons de sonde élastique tracées par [TRIP-MATH]. */
export type TripMathProbeReason = 'PROBE1_CONFIG' | 'PROBE1_RETRY' | 'PROBE2_TREND' | 'PROBE3_GONOGO';

/** Kill switch — passer à `false` pour couper tous les logs [TRIP-MATH]. */
export const ENABLE_TRIP_MATH_LOGS = true;

export type TripMathLogInput = {
  reason: TripMathProbeReason;
  alias: string;
  targetArrivalMs: number;
  apiTrajetMin: number;
  bufferMin: number;
  windowStartMs: number;
  windowEndMs: number;
  previousTrajetMin?: number | null;
  ratioD?: number | null;
  alpha?: number | null;
  uiUpdate?: boolean;
  probe3Skipped?: boolean;
};

function fmtHm(ms: number): string {
  if (!Number.isFinite(Number(ms))) return '--:--';
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

function formatContractSuffix(input: TripMathLogInput): string {
  const parts: string[] = [];
  if (input.ratioD != null && Number.isFinite(input.ratioD)) {
    parts.push(`[Ratio_D: ${Math.round(input.ratioD * 100) / 100}]`);
  }
  if (input.alpha != null && Number.isFinite(input.alpha)) {
    parts.push(`[Alpha: ${input.alpha}]`);
  }
  if (input.uiUpdate != null) {
    parts.push(`[UI_UPDATE: ${input.uiUpdate}]`);
  }
  if (input.probe3Skipped === true) {
    parts.push('[PROBE3_SKIPPED: true]');
  }
  return parts.length > 0 ? ` | ${parts.join(' ')}` : '';
}

export function resolveTripMathAlias(
  tripMeta: Record<string, unknown> | null | undefined,
  fallbackDestination: string,
): string {
  const alias = tripMeta ? String(tripMeta.destination_name ?? '').trim() : '';
  const fb = String(fallbackDestination ?? '').trim();
  return alias || fb || '—';
}

function probeStageLabel(reason: TripMathProbeReason): string {
  if (reason === 'PROBE1_CONFIG' || reason === 'PROBE1_RETRY') return 'PROBE1';
  if (reason === 'PROBE2_TREND') return 'PROBE2';
  return 'PROBE3';
}

/** Log observationnel du créneau élastique — aucun effet métier. */
export function logTripMath(input: TripMathLogInput): void {
  if (!ENABLE_TRIP_MATH_LOGS) return;

  const alias = input.alias || '—';
  const slot = `${fmtHm(input.windowStartMs)} - ${fmtHm(input.windowEndMs)}`;
  const arrival = fmtHm(input.targetArrivalMs);
  const stage = probeStageLabel(input.reason);
  const contractSuffix = formatContractSuffix(input);

  const delta =
    input.previousTrajetMin != null && Number.isFinite(input.previousTrajetMin)
      ? ` (${formatDelta(input.previousTrajetMin, input.apiTrajetMin)})`
      : '';

  if (input.reason === 'PROBE1_CONFIG' || input.reason === 'PROBE1_RETRY') {
    const retryTag = input.reason === 'PROBE1_RETRY' ? ' (retry)' : '';
    console.log(
      `[TRIP-MATH] 🧮 [${stage}] Contrat pour "${alias}"${retryTag} | Arrivée: ${arrival} | Trajet: ${input.apiTrajetMin}m | Marge: +${input.bufferMin}m | Créneau: ${slot}${contractSuffix}`,
    );
    return;
  }

  if (input.reason === 'PROBE2_TREND') {
    console.log(
      `[TRIP-MATH] 🧮 [${stage}] Ajustement "${alias}" | Trajet: ${input.apiTrajetMin}m${delta} | Créneau: ${slot}${contractSuffix}`,
    );
    return;
  }

  console.log(
    `[TRIP-MATH] 🧮 [${stage}] Final "${alias}" | Arrivée: ${arrival} | Trajet: ${input.apiTrajetMin}m${delta} | Créneau: ${slot}${contractSuffix}`,
  );
}
