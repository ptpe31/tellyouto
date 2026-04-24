/** Émis après capture Talk (Quick / Deep) pour le moniteur Debug. */
export const TALK_CAPTURE_DEBUG_EVENT = 'tellyouto_talk_capture_debug';

/**
 * Instantanés et deltas **one-tap** (Quick) pour la page Debug — alignés sur les logs console `[OneTapPerf]` dans
 * `TalkDebugScreen.stopCapture`.
 *
 * Les champs `t0`, `t1`, `t3` sont des **valeurs absolues** `Math.round(performance.now())` (ms depuis le chargement de
 * la page), pas des durées. Seules `geminiMs` et `totalFromT1Ms` sont des durées.
 *
 * | Champ | Console / événement | Interprétation |
 * |-------|---------------------|----------------|
 * | **t0** | `T0_CAPTURE_END` | Fin capture (micro / reco arrêtés). |
 * | **t1** | `T1_DUAL_PATH_BACKGROUND` | Début du lot async : pre-save + refine Gemini (après squelette local + modale). |
 * | **t3** | `T3_REFINE_DONE` | Fin du lot async (Firestore + stream Gemini + replace draft). **Pas de champ `t2`** — le coût réseau modèle est isolé dans `geminiMs`. |
 * | **geminiMs** | (delta interne) | Durée approximative de l’appel streaming Gemini (`gemEnd - gemStart`). |
 * | **totalFromT1Ms** | — | `t3 - t1` : tout le travail « arrière-plan » après `t1`. |
 */
export type OneTapPerfMsSnapshot = {
  /** Voir tableau dans la doc du type — instantané T0. */
  t0: number;
  /** Instantané T1 (début async Dual-Path). */
  t1: number;
  /** Instantané T3 (fin async). */
  t3: number;
  /** Durée de la phase Gemini (streaming) en ms. */
  geminiMs: number;
  /** Durée totale du traitement async depuis T1 (`t3 - t1`). */
  totalFromT1Ms: number;
};

export type TalkCaptureDebugPayload = {
  mode: 'quick' | 'deep';
  at: number;
  rawTranscript: string;
  /** Quick : tri / structure locale (JSON). */
  localStructuredJson?: string;
  /** Deep : réponse analyse Gemini (texte brut modèle + objet parsé). */
  geminiFullJson?: string;
  /**
   * Quick one-tap : métriques Dual-Path — voir {@link OneTapPerfMsSnapshot}.
   * Affichage i18n : `debug.oneTapPerf*` dans `DebugScreen`.
   */
  oneTapPerfMs?: OneTapPerfMsSnapshot;
};
