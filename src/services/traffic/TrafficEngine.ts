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
  nowMs?: number;
};

export type ExecuteTrafficScanOutput = {
  nextSession: TrafficScanSession;
  event: TrafficScanEvent;
  evaluation: TrafficEvaluation;
  shouldNotify: boolean;
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
 * Seuil cible: max(base * ratio, base + 120s, 120s)
 */
export function computeDurationTargetSec(
  staticDurationSec: number,
  thresholdRatio: number
): number {
  const base = Math.max(0, Number(staticDurationSec) || 0);
  const ratio =
    Number.isFinite(Number(thresholdRatio)) && Number(thresholdRatio) > 0
      ? Number(thresholdRatio)
      : 1;
  const raw = Math.round(base * ratio);
  const minPlus = base + 120;
  return Math.max(raw, minPlus, 120);
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
  const scanCount = Math.max(0, Math.floor(Number(input.session.internalScanCount) || 0));
  const status = input.session.status;

  if (status !== "active") {
    return {
      nextSession: { ...input.session },
      event: "NONE",
      evaluation: evaluateTrafficStatus({
        targetDurationSec: target,
        currentDurationSec: current,
        lastDurationSec: previous,
        departureGapMin: input.departureGapMin,
      }),
      shouldNotify: false,
    };
  }

  const fluidNow = target > 0 && current <= target;
  const overNow = target > 0 && current > target;
  const wasOver = target > 0 && previous > target;

  let event: TrafficScanEvent = "NONE";
  let shouldNotify = false;

  const nextSession: TrafficScanSession = {
    ...input.session,
    lastTrafficDurationSec: current,
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
      currentDurationSec: current,
      lastDurationSec: previous,
      departureGapMin: input.departureGapMin,
    }),
    shouldNotify,
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
