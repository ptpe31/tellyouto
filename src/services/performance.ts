import { InteractionManager } from 'react-native';

/** Horodatage du premier chargement JS (import du module depuis index). */
export const STARTUP_T0_MS = Date.now();

let interactiveElapsedMs: number | null = null;
const listeners = new Set<(ms: number) => void>();

function emitTti(ms: number): void {
  interactiveElapsedMs = ms;
  for (const l of listeners) {
    l(ms);
  }
}

/**
 * Temps jusqu’à l’interactivité (approx. TTI) : après la première frame « prête »
 * et la fin des interactions différées (file RN).
 * À appeler une fois qu’on affiche onboarding ou l’app principale.
 */
export function markAppInteractive(): void {
  if (interactiveElapsedMs !== null) return;
  InteractionManager.runAfterInteractions(() => {
    if (interactiveElapsedMs !== null) return;
    emitTti(Date.now() - STARTUP_T0_MS);
  });
}

export function getTimeToInteractiveMs(): number | null {
  return interactiveElapsedMs;
}

export function subscribeTimeToInteractive(
  listener: (ms: number) => void,
): () => void {
  if (interactiveElapsedMs !== null) {
    listener(interactiveElapsedMs);
    return () => {};
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
