/**
 * DEPRECATED — orchestration locale pré-OneTap (`TaskStrategy`). Voir `nettoyage-code-mort.md` §10.
 */
export type OrchestratorDecision = 'LOCAL' | 'COMPLEX';

export type OrchestratorResult = {
  rawText: string;
  decision: OrchestratorDecision;
  localType: 'TASK' | 'HABIT' | 'NOTE';
  confidence: number;
  suggestedTags: string[];
  schedule: Date | null;
  reason: string;
  wordCount: number;
};

/** DEPRECATED */
export async function transcribeStage(_input: {
  audioPath?: string | null;
  fallbackText?: string;
}): Promise<string> {
  return String(_input.fallbackText ?? '').trim();
}

/** DEPRECATED — utiliser le pipeline OneTap (`IntentionContext` / `oneTapUniversalCapture`). */
export async function runIntentOrchestration(_params: {
  audioPath?: string | null;
  fallbackText?: string;
  locale?: string;
}): Promise<OrchestratorResult> {
  const rawText = String(_params.fallbackText ?? '').trim();
  return {
    rawText,
    decision: 'COMPLEX',
    localType: 'TASK',
    confidence: 0,
    suggestedTags: [],
    schedule: null,
    reason: 'DEPRECATED orchestrator',
    wordCount: rawText.split(/\s+/).filter(Boolean).length,
  };
}

/* Implémentation Gatekeeper + Whisper : voir git history */
