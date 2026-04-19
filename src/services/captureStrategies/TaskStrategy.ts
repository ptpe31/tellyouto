import { runIntentOrchestration } from '../IntentOrchestrator';
import { createLocalTemporalIntention } from '../localTemporalIntention';
import { cleanTranscriptText } from '../smartTitle';
import { formatYmdLocal } from '../TimeSorter';
import type { CaptureChooseActionResult, CaptureStrategyDeps } from './types';

export async function executeTaskCapture(params: {
  deps: CaptureStrategyDeps;
  finalTranscript: string;
  smartTitle: string;
  quickTaskLabel: string;
}): Promise<CaptureChooseActionResult> {
  const { deps, finalTranscript, smartTitle, quickTaskLabel } = params;
  try {
    const orchestration = await runIntentOrchestration({
      fallbackText: finalTranscript,
      locale: deps.spectrum.locale,
    });
    deps.emitTalkDebug({
      mode: 'quick',
      at: Date.now(),
      rawTranscript: orchestration.rawText || finalTranscript,
      localStructuredJson: JSON.stringify(
        {
          decision: orchestration.decision,
          localType: orchestration.localType,
          confidence: orchestration.confidence,
          suggestedTags: orchestration.suggestedTags,
          reason: orchestration.reason,
        },
        null,
        2,
      ),
    });
    const scheduleDate =
      orchestration.schedule instanceof Date && !Number.isNaN(orchestration.schedule.getTime())
        ? orchestration.schedule
        : null;
    const dueDateYmd =
      (scheduleDate ? formatYmdLocal(scheduleDate) : null) ?? deps.parseDueDateFromText(finalTranscript);
    const finalTitle = smartTitle || quickTaskLabel;
    const suggestedTags = Array.from(
      new Set((orchestration.suggestedTags ?? []).filter((tag) => tag !== 'regulier')),
    );
    const intentionId = deps.newId();
    const created = await createLocalTemporalIntention({
      id: intentionId,
      title: finalTitle,
      rawTranscript: finalTranscript,
      localType: 'TASK',
      dueDateYmd,
      suggestedTags,
      source: 'talk_debug_local_orchestrator',
      metadataExtra: {},
    });
    return {
      ok: true,
      outcome: {
        kind: 'persisted_temporal' as const,
        intentionId,
        mirrorType: 'TASK',
        title: finalTitle,
        dueDateYmd: created.dueDateYmd,
        recapIntroI18nKey: 'talkDebug.taskQuickRecapIntro',
      },
    };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Utilitaire partagé pour la construction du transcript final côté écran. */
export function buildFinalTranscriptForCapture(transcriptDraft: string, rawTranscript: string): string {
  return cleanTranscriptText(transcriptDraft.trim() || rawTranscript.trim());
}
