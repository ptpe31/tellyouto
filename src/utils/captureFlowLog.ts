/**
 * Logs de traçage du pipeline capture → persistance SQLite (`__DEV__` uniquement).
 * Préfixe stable `[CAPTURE_FLOW]` pour filtrer la console et vérifier les régressions.
 *
 * @module captureFlowLog
 */

/**
 * @param trace Identifiant de corrélation (ex. `mic_*` depuis le micro) ; `undefined` hors micro.
 * @param phase Nom machine lisible (ex. `submit_enter`, `peek_snapshot_emitted`).
 * @param detail Métadonnées sérialisées en JSON (taille limitée côté appelant).
 */
export function logCaptureFlow(trace: string | undefined, phase: string, detail?: Record<string, unknown>): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  const tid = trace && String(trace).trim() ? String(trace).trim() : '—';
  const rest = detail && Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : '';
  console.log(`[CAPTURE_FLOW] trace=${tid} phase=${phase}${rest}`);
}
