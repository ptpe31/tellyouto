/** Émis après capture Talk (Quick / Deep) pour le moniteur Debug. */
export const TALK_CAPTURE_DEBUG_EVENT = 'tellyouto_talk_capture_debug';

export type TalkCaptureDebugPayload = {
  mode: 'quick' | 'deep';
  at: number;
  rawTranscript: string;
  /** Quick : tri / structure locale (JSON). */
  localStructuredJson?: string;
  /** Deep : réponse analyse Gemini (texte brut modèle + objet parsé). */
  geminiFullJson?: string;
};
