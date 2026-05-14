import { DeviceEventEmitter } from 'react-native';

/**
 * Logs de traçage du pipeline capture → persistance SQLite (`__DEV__` uniquement).
 * Émission parallèle **`CAPTURE_PIPELINE_PROGRESS`** pour le dashboard Talk (toutes builds).
 * Préfixe stable `[CAPTURE_FLOW]` pour filtrer la console et vérifier les régressions.
 *
 * @module captureFlowLog
 */

export const CAPTURE_PIPELINE_PROGRESS_EVENT = 'talkndone.capture_pipeline_progress';

export type CapturePipelineProgressPayload = {
  trace?: string;
  phase: string;
  detail?: Record<string, unknown>;
};

/**
 * Émis à chaque étape utile au dashboard de progression (TalkDebug) ; ne dépend pas de `__DEV__`.
 */
export function notifyCapturePipelineProgress(
  trace: string | undefined,
  phase: string,
  detail?: Record<string, unknown>,
): void {
  const tid = trace && String(trace).trim() ? String(trace).trim() : undefined;
  DeviceEventEmitter.emit(CAPTURE_PIPELINE_PROGRESS_EVENT, {
    trace: tid,
    phase,
    detail,
  } satisfies CapturePipelineProgressPayload);
}

/**
 * @param trace Identifiant de corrélation (ex. `mic_*` depuis le micro) ; `undefined` hors micro.
 * @param phase Nom machine lisible (ex. `submit_enter`, `peek_snapshot_emit`, `peek_snapshot_offline_queue`).
 * @param detail Métadonnées sérialisées en JSON (taille limitée côté appelant).
 */
export function logCaptureFlow(trace: string | undefined, phase: string, detail?: Record<string, unknown>): void {
  notifyCapturePipelineProgress(trace, phase, detail);
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  const tid = trace && String(trace).trim() ? String(trace).trim() : '—';
  const rest = detail && Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : '';
  console.log(`[CAPTURE_FLOW] trace=${tid} phase=${phase}${rest}`);
}
