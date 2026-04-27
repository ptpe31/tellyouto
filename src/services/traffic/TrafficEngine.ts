/**
 * TrafficEngine: coeur mathématique pur pour la surveillance trajet.
 * Aucun accès réseau, DB, notifications ou SDK natif.
 */

export const SURVEILLANCE_NOTIF_MIN_INTERVAL_MS = 15 * 60 * 1000;

export type VigilanceStatus =
  | "VIGILANCE_BLUE"
  | "VIGILANCE_ORANGE"
  | "VIGILANCE_RED"
  | "FINISHED";

export type TrafficEvaluation = {
  status: VigilanceStatus;
  nextJumpMs: number;
};

export type EvaluateTrafficStatusInput = {
  nowMs: number;
  targetArrivalMs: number;
  stabilizedDurationSec: number;
  sessionStatus?: TrafficScanSession["status"];
};

export type TrafficScanSession = {
  status: "active" | "cancelled" | "finished";
  durationTargetSec: number;
  lastTrafficDurationSec: number;
  internalScanCount: number;
  lastSurveillanceNotifAtMs?: number | null;
  topDepartAtMs?: number | null;
};

export type TrafficScanEvent =
  | "NONE"
  | "SCAN0_STANDARD"
  | "SURVEILLANCE_REMINDER"
  | "TOP_DEPART";

export type ExecuteTrafficScanInput = {
  session: TrafficScanSession;
  currentTrafficDurationSec: number;
  targetArrivalMs: number;
  previousTrafficDurationSec?: number | null;
  nowMs?: number;
};

export type ExecuteTrafficScanOutput = {
  nextSession: TrafficScanSession;
  event: TrafficScanEvent;
  evaluation: TrafficEvaluation;
  shouldNotify: boolean;
  stabilizedTrafficDurationSec: number;
  tripComplexityScore: number;
  tOptimisteMs: number;
  tPessimisteMs: number;
};

/**
 * Calcule le prochain intervalle de vérification (Saut Elastique)
 * @param departureGapMin Minutes restantes avant l'heure de depart prevue
 * @returns Intervalle en millisecondes
 */
export function computeNewtonWindow(
  targetArrivalMs: number,
  stabilizedDurationSec: number
): { tOptimisteMs: number; tPessimisteMs: number } {
  const arrivalMs = Math.max(0, Number(targetArrivalMs) || 0);
  const durationMs = Math.max(0, Number(stabilizedDurationSec) || 0) * 1000;
  const marginMs = 5 * 60 * 1000;
  const tPessimisteMs = Math.round(arrivalMs - durationMs - marginMs);
  const tOptimisteMs = Math.round(tPessimisteMs - durationMs * 0.15);
  return { tOptimisteMs, tPessimisteMs };
}

export function calculateNextJump(departureGapMin: number): number;
export function calculateNextJump(params: {
  nowMs: number;
  targetArrivalMs: number;
  stabilizedDurationSec: number;
}): number;
export function calculateNextJump(
  params: number | { nowMs: number; targetArrivalMs: number; stabilizedDurationSec: number }
): number {
  if (typeof params === "number") {
    const gapMin = Number.isFinite(Number(params)) ? Number(params) : 0;
    if (gapMin > 120) return 60 * 60 * 1000;
    if (gapMin < 60) return 15 * 60 * 1000;
    return 30 * 60 * 1000;
  }

  const nowMs = Number.isFinite(Number(params.nowMs)) ? Number(params.nowMs) : Date.now();
  const { tOptimisteMs, tPessimisteMs } = computeNewtonWindow(params.targetArrivalMs, params.stabilizedDurationSec);

  if (nowMs >= tOptimisteMs && nowMs < tPessimisteMs) return 5 * 60 * 1000;

  const remainingToCriticalMs = tPessimisteMs - nowMs;
  if (remainingToCriticalMs > 2 * 60 * 60 * 1000) return 60 * 60 * 1000;
  if (remainingToCriticalMs < 60 * 60 * 1000) return 15 * 60 * 1000;
  return 30 * 60 * 1000;
}

/**
 * Interpole lineairement un ratio de tolerance selon la duree du trajet:
 * - < 15 min: 1.3 (plus tolerant aux aleas urbains)
 * - > 45 min: 1.1 (plus strict pour fiabiliser les longs trajets)
 * - entre les deux: interpolation lineaire
 *
 * Benefice metier:
 * - Confort utilisateur sur trajets courts (moins d'alertes nerveuses)
 * - Precision sur trajets longs (declenchement plus pertinent)
 */
export function computeDynamicToleranceRatio(staticDurationSec: number): number {
  const base = Math.max(0, Number(staticDurationSec) || 0);
  const shortTripSec = 15 * 60;
  const longTripSec = 45 * 60;
  const maxRatio = 1.3;
  const minRatio = 1.1;

  if (base <= shortTripSec) return maxRatio;
  if (base >= longTripSec) return minRatio;

  const alpha = (base - shortTripSec) / (longTripSec - shortTripSec);
  return maxRatio + (minRatio - maxRatio) * alpha;
}

/**
 * Seuil cible dynamique:
 * target = max(base * dynamicRatio, base + 120s, 120s)
 *
 * Benefice metier:
 * - Stabilise le compromis precision/confort automatiquement selon la longueur du trajet.
 */
export function computeDurationTargetSec(staticDurationSec: number): number {
  const base = Math.max(0, Number(staticDurationSec) || 0);
  const ratio = computeDynamicToleranceRatio(base);
  const raw = Math.round(base * ratio);
  const minPlus = base + 120;
  return Math.max(raw, minPlus, 120);
}

/**
 * Exponential Moving Average simplifiee (EMA 1 step):
 * stabilized = current * currentWeight + previous * previousWeight
 *
 * Par defaut: 70/30.
 * Benefice metier:
 * - Evite les faux "Top Depart" sur pic de trafic ponctuel
 * - Conserve une reaction rapide a la tendance recente
 */
export function stabilizeTrafficDurationSec(
  currentTrafficSec: number,
  previousTrafficSec: number,
  currentWeight = 0.7
): number {
  const current = Math.max(0, Number(currentTrafficSec) || 0);
  const previous = Math.max(0, Number(previousTrafficSec) || 0);
  const cw = Number.isFinite(Number(currentWeight))
    ? Math.min(1, Math.max(0, Number(currentWeight)))
    : 0.7;
  const pw = 1 - cw;
  return Math.round(current * cw + previous * pw);
}

/**
 * Compare l'etat precedent vs courant par rapport au seuil.
 */
export function evaluateTrafficStatus(
  input: EvaluateTrafficStatusInput
): TrafficEvaluation {
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now();
  const arrivalMs = Math.max(0, Number(input.targetArrivalMs) || 0);
  const stabilizedDurationSec = Math.max(0, Number(input.stabilizedDurationSec) || 0);

  const { tOptimisteMs, tPessimisteMs } = computeNewtonWindow(arrivalMs, stabilizedDurationSec);
  let status: VigilanceStatus = "VIGILANCE_BLUE";
  if (input.sessionStatus && input.sessionStatus !== "active") {
    status = "FINISHED";
  } else if (arrivalMs > 0 && nowMs >= arrivalMs) {
    status = "FINISHED";
  } else if (arrivalMs > 0 && nowMs >= tPessimisteMs) {
    status = "VIGILANCE_RED";
  } else if (arrivalMs > 0 && nowMs >= tOptimisteMs) {
    status = "VIGILANCE_ORANGE";
  }

  return {
    status,
    nextJumpMs: calculateNextJump({
      nowMs,
      targetArrivalMs: arrivalMs,
      stabilizedDurationSec,
    }),
  };
}

/**
 * Score de "poids de surveillance" pour estimer le cout API d'un trajet.
 *
 * Approche:
 * - Simule les sauts elastiques successifs jusqu'au depart (gap -> gap - jump)
 * - Combine nombre de scans + duree de fenetre de surveillance
 *
 * Formule:
 * complexity = scansEstimated * 10 + surveillanceWindowMin
 *
 * Benefice metier:
 * - Permet un pilotage budgetaire (quota API) sans couplage a un backend
 * - Offre une base pour un cout au prorata par trajet
 */
export function calculateTripComplexity(
  params: { nowMs: number; targetArrivalMs: number; stabilizedDurationSec: number }
): number {
  const nowMs = Number.isFinite(Number(params.nowMs)) ? Number(params.nowMs) : Date.now();
  const { tPessimisteMs } = computeNewtonWindow(params.targetArrivalMs, params.stabilizedDurationSec);
  const remainingMin = Math.max(0, (tPessimisteMs - nowMs) / 60_000);

  let scansEstimated = 0;
  let cursorMs = nowMs;
  const hardLimit = 200;
  while (cursorMs < tPessimisteMs && scansEstimated < hardLimit) {
    const jumpMs = calculateNextJump({
      nowMs: cursorMs,
      targetArrivalMs: params.targetArrivalMs,
      stabilizedDurationSec: params.stabilizedDurationSec,
    });
    scansEstimated += 1;
    cursorMs += Math.max(1, jumpMs);
  }

  return Math.round(scansEstimated * 10 + remainingMin);
}

/**
 * Version pure de la logique executeWatch4MeInternalScan:
 * - ne fait aucun appel reseau
 * - ne lit/ecrit aucune base
 * - ne declenche aucun side-effect
 */
export function executeTrafficScan(
  input: ExecuteTrafficScanInput
): ExecuteTrafficScanOutput {
  const nowMs = Number.isFinite(Number(input.nowMs))
    ? Number(input.nowMs)
    : Date.now();
  const current = Math.max(0, Number(input.currentTrafficDurationSec) || 0);
  const previous = Math.max(0, Number(input.session.lastTrafficDurationSec) || 0);
  const previousForEma = Math.max(
    0,
    Number(input.previousTrafficDurationSec ?? previous) || 0
  );
  const stabilizedCurrent = stabilizeTrafficDurationSec(current, previousForEma);
  const scanCount = Math.max(0, Math.floor(Number(input.session.internalScanCount) || 0));
  const status = input.session.status;
  const tripComplexityScore = calculateTripComplexity({
    nowMs,
    targetArrivalMs: input.targetArrivalMs,
    stabilizedDurationSec: stabilizedCurrent,
  });
  const { tOptimisteMs, tPessimisteMs } = computeNewtonWindow(
    input.targetArrivalMs,
    stabilizedCurrent
  );

  if (status !== "active") {
    return {
      nextSession: { ...input.session },
      event: "NONE",
      evaluation: evaluateTrafficStatus({
        nowMs,
        targetArrivalMs: input.targetArrivalMs,
        stabilizedDurationSec: stabilizedCurrent,
        sessionStatus: status,
      }),
      shouldNotify: false,
      stabilizedTrafficDurationSec: stabilizedCurrent,
      tripComplexityScore,
      tOptimisteMs,
      tPessimisteMs,
    };
  }

  let event: TrafficScanEvent = "NONE";
  let shouldNotify = false;

  const nextSession: TrafficScanSession = {
    ...input.session,
    lastTrafficDurationSec: stabilizedCurrent,
    internalScanCount: scanCount + 1,
  };

  const evaluation = evaluateTrafficStatus({
    nowMs,
    targetArrivalMs: input.targetArrivalMs,
    stabilizedDurationSec: stabilizedCurrent,
    sessionStatus: status,
  });
  if (evaluation.status === "FINISHED") {
    nextSession.status = "finished";
  }

  return {
    nextSession,
    event,
    evaluation,
    shouldNotify,
    stabilizedTrafficDurationSec: stabilizedCurrent,
    tripComplexityScore,
    tOptimisteMs,
    tPessimisteMs,
  };
}

/**
 * Alias metier explicite pour la migration Watch4Me.
 * Meme comportement que `executeTrafficScan`, sans dependance API/DB.
 */
export function executeWatch4MeInternalScan(
  input: ExecuteTrafficScanInput
): ExecuteTrafficScanOutput {
  return executeTrafficScan(input);
}
