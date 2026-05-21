/**
 * DEPRECATED — capture TalkDebug pré-OneTap. Voir `nettoyage-code-mort.md` §10.
 */
import type { CaptureChooseActionResult, CaptureStrategyDeps } from './types';

export async function executeTaskCapture(_params: {
  deps: CaptureStrategyDeps;
  finalTranscript: string;
  smartTitle: string;
  quickTaskLabel: string;
}): Promise<CaptureChooseActionResult> {
  void _params;
  return { ok: false, error: new Error('DEPRECATED: use OneTap pipeline') };
}

export function buildFinalTranscriptForCapture(transcriptDraft: string, rawTranscript: string): string {
  return (transcriptDraft.trim() || rawTranscript.trim()).trim();
}
