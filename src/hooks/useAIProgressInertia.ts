import { useCallback, useEffect, useRef, useState } from 'react';

/** P1 + P2 : deux paliers d’inertie ease-in-out jusqu’au plancher 60 % (avant phase 3 asymptotique). */
export const AI_PROGRESS_INERTIA_P1_MS = 1200;
export const AI_PROGRESS_INERTIA_P2_MS = 1200;
export const AI_PROGRESS_INERTIA_TOTAL_MS = AI_PROGRESS_INERTIA_P1_MS + AI_PROGRESS_INERTIA_P2_MS;
export const AI_PROGRESS_TICK_MS = 16;
/** Phase 3 : approche asymptotique vers ~95 % en attendant l’IA (exp). */
export const AI_PROGRESS_PHASE3_ASYMPTOTE_MS = 5200;
/** Sprint final linéaire (P3 « boost ») vers 100 %. */
export const AI_PROGRESS_FINAL_SPRINT_MS = 200;
export const AI_PROGRESS_REVEAL_HOLD_MS = 150;

function perfNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

type FinalSprintTo100 = { startMs: number; fromPct: number; durationMs: number };

function easeInOutSmooth(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** Inertie imposée : 0→30 % (P1) puis 30→60 % (P2) sur `AI_PROGRESS_INERTIA_TOTAL_MS`. */
export function inertiaFloorPct(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  if (elapsedMs < AI_PROGRESS_INERTIA_P1_MS) {
    return 30 * easeInOutSmooth(elapsedMs / AI_PROGRESS_INERTIA_P1_MS);
  }
  if (elapsedMs < AI_PROGRESS_INERTIA_TOTAL_MS) {
    const u = (elapsedMs - AI_PROGRESS_INERTIA_P1_MS) / AI_PROGRESS_INERTIA_P2_MS;
    return 30 + 30 * easeInOutSmooth(u);
  }
  return 60;
}

export type UseAIProgressInertiaOptions = {
  /** Quand faux, l’intervalle de lissage est arrêté. */
  active: boolean;
  /** Une fois la barre à 100 % (fin du sprint linéaire), avant le reveal parent. */
  onFinalSprintHit100?: () => void;
  /** Après 100 % : typiquement temporisation puis fermeture overlay. */
  onLinearSprintComplete?: () => void;
};

/**
 * Progression IA universelle lissée : paliers d’inertie (→60 %), phase 3 asymptotique,
 * cibles « bump » événementielles, sprint final vers 100 %.
 */
export function useAIProgressInertia({
  active,
  onFinalSprintHit100,
  onLinearSprintComplete,
}: UseAIProgressInertiaOptions) {
  const [progress, setProgress] = useState(0);
  const inertiaStartRef = useRef(0);
  const targetRef = useRef(0);
  const finalSprintRef = useRef<FinalSprintTo100 | null>(null);
  /** Pour éviter de relancer un sprint si un sprint est déjà actif (listeners pipeline). */
  const finalSprintActiveRef = useRef(false);
  const displayedPctLiveRef = useRef(0);
  const onHit100Ref = useRef(onFinalSprintHit100);
  onHit100Ref.current = onFinalSprintHit100;
  const onCompleteRef = useRef(onLinearSprintComplete);
  onCompleteRef.current = onLinearSprintComplete;
  const sprintCompleteNotifiedRef = useRef(false);

  const beginInertia = useCallback(() => {
    inertiaStartRef.current = perfNowMs();
  }, []);

  const clearInertia = useCallback(() => {
    inertiaStartRef.current = 0;
  }, []);

  const bumpTarget = useCallback((v: number) => {
    targetRef.current = Math.max(targetRef.current, v);
  }, []);

  const startFinalSprintTo100 = useCallback(() => {
    inertiaStartRef.current = 0;
    sprintCompleteNotifiedRef.current = false;
    finalSprintActiveRef.current = true;
    finalSprintRef.current = {
      startMs: perfNowMs(),
      fromPct: Math.min(99, Math.max(0, displayedPctLiveRef.current)),
      durationMs: AI_PROGRESS_FINAL_SPRINT_MS,
    };
    targetRef.current = 100;
  }, []);

  const clearFinalSprint = useCallback(() => {
    finalSprintRef.current = null;
    finalSprintActiveRef.current = false;
  }, []);

  const reset = useCallback(() => {
    inertiaStartRef.current = 0;
    targetRef.current = 0;
    finalSprintRef.current = null;
    finalSprintActiveRef.current = false;
    displayedPctLiveRef.current = 0;
    sprintCompleteNotifiedRef.current = false;
    setProgress(0);
  }, []);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setProgress((d) => {
        const now = perfNowMs();

        const fs = finalSprintRef.current;
        if (fs) {
          const u = Math.min(1, (now - fs.startMs) / fs.durationMs);
          const next = fs.fromPct + (100 - fs.fromPct) * u;
          if (u >= 1) {
            finalSprintRef.current = null;
            finalSprintActiveRef.current = false;
            displayedPctLiveRef.current = 100;
            if (!sprintCompleteNotifiedRef.current) {
              sprintCompleteNotifiedRef.current = true;
              queueMicrotask(() => {
                onHit100Ref.current?.();
                onCompleteRef.current?.();
              });
            }
            return 100;
          }
          displayedPctLiveRef.current = next;
          return next;
        }

        const inertiaStart = inertiaStartRef.current;
        if (inertiaStart <= 0) {
          const tOnly = targetRef.current;
          const n = d + (tOnly - d) * 0.12;
          const next = Math.abs(tOnly - n) < 0.45 ? tOnly : n;
          displayedPctLiveRef.current = next;
          return Math.min(100, next);
        }

        const elapsed = now - inertiaStart;

        if (elapsed < AI_PROGRESS_INERTIA_TOTAL_MS) {
          const next = inertiaFloorPct(elapsed);
          displayedPctLiveRef.current = next;
          return Math.min(100, next);
        }

        const phase3Elapsed = elapsed - AI_PROGRESS_INERTIA_TOTAL_MS;
        const creepTarget = 60 + 35 * (1 - Math.exp(-phase3Elapsed / AI_PROGRESS_PHASE3_ASYMPTOTE_MS));
        const bumpTarget = targetRef.current;
        const target = Math.max(bumpTarget, creepTarget);
        let next = d + (target - d) * 0.1;
        if (bumpTarget < 100 && next > 94.75) {
          next = Math.min(next, 94.85);
        }
        if (Math.abs(target - next) < 0.4) next = target;
        displayedPctLiveRef.current = next;
        return Math.min(100, next);
      });
    }, AI_PROGRESS_TICK_MS);
    return () => clearInterval(id);
  }, [active]);

  return {
    progress,
    displayedPctLiveRef,
    finalSprintActiveRef,
    /** `performance.now()` au début de l’inertie P1/P2 (profiler T4, etc.). */
    inertiaEpochRef: inertiaStartRef,
    beginInertia,
    clearInertia,
    bumpTarget,
    startFinalSprintTo100,
    clearFinalSprint,
    reset,
  };
}
