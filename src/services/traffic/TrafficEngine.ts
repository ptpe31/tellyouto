/**
 * TrafficEngine: coeur mathématique pur pour la surveillance trajet.
 * Aucun accès réseau, DB, notifications ou SDK natif.
 */

export const SURVEILLANCE_NOTIF_MIN_INTERVAL_MS = 15 * 60 * 1000;

export type TrafficStatus = "TOP_DEPART" | "STILL_OVER" | "FLUID";

export type TrafficEvaluation = {
  status: TrafficStatus;
  nextJumpMs: number;
};

export type EvaluateTrafficStatusInput = {
  targetDurationSec: number;
  currentDurationSec: number;
  lastDurationSec?: number | null;
  departureGapMin: number;
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
  departureGapMin: number;
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
};

/**
 * Calcule le prochain intervalle de vérification (Saut Elastique)
 * @param departureGapMin Minutes restantes avant l'heure de depart prevue
 * @returns Intervalle en millisecondes
 */
export function calculateNextJump(departureGapMin: number): number {
  const MIN_INTERVAL = 2; // 2 minutes (precision finale)
  const MAX_INTERVAL = 20; // 20 minutes (economie API)
  const K_FACTOR = 3; // verification tous les 1/3 du temps restant

  if (!Number.isFinite(departureGapMin)) {
    return MIN_INTERVAL * 60 * 1000;
  }

  if (departureGapMin <= MIN_INTERVAL) {
    return MIN_INTERVAL * 60 * 1000;
  }

  const suggestedJump = departureGapMin / K_FACTOR;
  const finalJumpMin = Math.max(
    MIN_INTERVAL,
    Math.min(MAX_INTERVAL, suggestedJump)
  );

  return Math.floor(finalJumpMin * 60 * 1000);
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
  const target = Math.max(0, Number(input.targetDurationSec) || 0);
  const current = Math.max(0, Number(input.currentDurationSec) || 0);
  const last = Math.max(0, Number(input.lastDurationSec ?? 0) || 0);

  const overNow = target > 0 && current > target;
  const wasOver = target > 0 && last > target;

  let status: TrafficStatus = "FLUID";
  if (wasOver && !overNow) {
    status = "TOP_DEPART";
  } else if (overNow) {
    status = "STILL_OVER";
  }

  return {
    status,
    nextJumpMs: calculateNextJump(input.departureGapMin),
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
  departureGapMin: number,
  surveillanceWindowMin: number
): number {
  const minGap = Math.max(0, Number(departureGapMin) || 0);
  const windowMin = Math.max(0, Number(surveillanceWindowMin) || 0);

  let scansEstimated = 0;
  let remaining = minGap;
  const hardLimit = 200;
  while (remaining > 0 && scansEstimated < hardLimit) {
    const jumpMs = calculateNextJump(remaining);
    const jumpMin = Math.max(0.01, jumpMs / 60_000);
    scansEstimated += 1;
    remaining -= jumpMin;
  }

  return Math.round(scansEstimated * 10 + windowMin);
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
  const target = Math.max(0, Number(input.session.durationTargetSec) || 0);
  const previous = Math.max(0, Number(input.session.lastTrafficDurationSec) || 0);
  const previousForEma = Math.max(
    0,
    Number(input.previousTrafficDurationSec ?? previous) || 0
  );
  const stabilizedCurrent = stabilizeTrafficDurationSec(current, previousForEma);
  const scanCount = Math.max(0, Math.floor(Number(input.session.internalScanCount) || 0));
  const status = input.session.status;
  const tripComplexityScore = calculateTripComplexity(
    input.departureGapMin,
    input.departureGapMin
  );

  if (status !== "active") {
    return {
      nextSession: { ...input.session },
      event: "NONE",
      evaluation: evaluateTrafficStatus({
        targetDurationSec: target,
        currentDurationSec: stabilizedCurrent,
        lastDurationSec: previous,
        departureGapMin: input.departureGapMin,
      }),
      shouldNotify: false,
      stabilizedTrafficDurationSec: stabilizedCurrent,
      tripComplexityScore,
    };
  }

  const fluidNow = target > 0 && stabilizedCurrent <= target;
  const overNow = target > 0 && stabilizedCurrent > target;
  const wasOver = target > 0 && previous > target;

  let event: TrafficScanEvent = "NONE";
  let shouldNotify = false;

  const nextSession: TrafficScanSession = {
    ...input.session,
    lastTrafficDurationSec: stabilizedCurrent,
    internalScanCount: scanCount + 1,
  };

  if (scanCount === 0 && fluidNow) {
    nextSession.status = "finished";
    event = "SCAN0_STANDARD";
    shouldNotify = true;
  } else if (scanCount === 0 && overNow) {
    nextSession.lastSurveillanceNotifAtMs = nowMs;
    event = "SURVEILLANCE_REMINDER";
    shouldNotify = true;
  } else if (wasOver && fluidNow) {
    nextSession.topDepartAtMs = nowMs;
    event = "TOP_DEPART";
    shouldNotify = true;
  } else if (overNow) {
    const lastNotif = Math.max(
      0,
      Number(nextSession.lastSurveillanceNotifAtMs ?? 0) || 0
    );
    if (nowMs - lastNotif >= SURVEILLANCE_NOTIF_MIN_INTERVAL_MS) {
      nextSession.lastSurveillanceNotifAtMs = nowMs;
      event = "SURVEILLANCE_REMINDER";
      shouldNotify = true;
    }
  }

  return {
    nextSession,
    event,
    evaluation: evaluateTrafficStatus({
      targetDurationSec: target,
        currentDurationSec: stabilizedCurrent,
      lastDurationSec: previous,
      departureGapMin: input.departureGapMin,
    }),
    shouldNotify,
      stabilizedTrafficDurationSec: stabilizedCurrent,
      tripComplexityScore,
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
