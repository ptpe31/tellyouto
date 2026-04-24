import { analyzeLocally } from './Gatekeeper';
import { transcribeWithWhisperLocal } from './WhisperAdapter';

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

type TranscriptionInput = {
  audioPath?: string | null;
  fallbackText?: string;
};

function looksComplexProject(text: string): boolean {
  return /\b(projet|roadmap|milestone|plan global|strategie|strategy|multi[- ]step)\b/i.test(text);
}

function hasClearEntities(confidence: number, schedule: Date | null, tags: string[], localType: string): boolean {
  if (confidence >= 0.68) return true;
  if (schedule) return true;
  if (localType === 'HABIT') return true;
  return tags.length > 0 && confidence >= 0.55;
}

export async function transcribeStage(input: TranscriptionInput): Promise<string> {
  const whisperText =
    input.audioPath && input.audioPath.trim()
      ? await transcribeWithWhisperLocal(input.audioPath.trim())
      : null;
  const rawText = (whisperText ?? input.fallbackText ?? '').trim();
  return rawText;
}

export async function runIntentOrchestration(params: {
  audioPath?: string | null;
  fallbackText?: string;
  locale?: string;
}): Promise<OrchestratorResult> {
  const rawText = await transcribeStage({
    audioPath: params.audioPath,
    fallbackText: params.fallbackText,
  });
  const wordCount = rawText.split(/\s+/).filter(Boolean).length;
  const local = await analyzeLocally(rawText, params.locale ?? 'fr');
  const confidence = Number(local.structured?.confidence ?? 0);
  const suggestedTags = local.structured?.suggestedTags?.length
    ? local.structured.suggestedTags
    : [];
  const schedule = local.structured?.schedule ?? null;

  const localClear = hasClearEntities(confidence, schedule, suggestedTags, local.localType);
  const isShort = wordCount > 0 && wordCount < 15;
  const complexByShape = looksComplexProject(rawText) || local.localType === 'NOTE';
  const decision: OrchestratorDecision =
    isShort && localClear && !complexByShape && !local.isExpertNeeded ? 'LOCAL' : 'COMPLEX';

  return {
    rawText,
    decision,
    localType: local.localType,
    confidence,
    suggestedTags,
    schedule,
    reason: local.reason,
    wordCount,
  };
}
