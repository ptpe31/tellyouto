import type { GeminiAnniversaryDetails, GeminiHabitRecurrence } from '../GeminiExpert';
import { extractAnniversaryDetails, extractHabitRecurrence } from '../GeminiExpert';
import { createLocalTemporalIntention } from '../localTemporalIntention';
import {
  computeNextYearlyDueDateFromNativeDate,
  hasAnniversaryKeyword,
} from '../TimeSorter';
import type { CaptureChooseActionResult, CaptureStrategyDeps } from './types';

export async function executeHabitCapture(params: {
  deps: CaptureStrategyDeps;
  finalTranscript: string;
  smartTitle: string;
  habitsDefaultTitle: string;
  birthdayLabel: string;
}): Promise<CaptureChooseActionResult> {
  const { deps, finalTranscript, smartTitle, habitsDefaultTitle, birthdayLabel } = params;
  try {
    const buildHabitMeta = async (): Promise<{ recurrence_rule?: GeminiHabitRecurrence }> => {
      const recurrence = await deps.withTimeout(extractHabitRecurrence(finalTranscript), 2500);
      if (!recurrence) return {};
      return { recurrence_rule: recurrence };
    };
    const buildAnniversaryMeta = async (): Promise<{
      details: GeminiAnniversaryDetails | null;
      dueDateYmd: string | null;
    }> => {
      const details = await deps.withTimeout(extractAnniversaryDetails(finalTranscript), 2500);
      if (!details) return { details: null, dueDateYmd: null };
      const dueDateYmd = computeNextYearlyDueDateFromNativeDate(details.native_date);
      return { details, dueDateYmd };
    };

    const hasAnniversary = hasAnniversaryKeyword(finalTranscript);
    let ann: { details: GeminiAnniversaryDetails | null; dueDateYmd: string | null };
    let habitMeta: { recurrence_rule?: GeminiHabitRecurrence };
    if (hasAnniversary) {
      const [annResult, habitMetaResult] = await Promise.all([buildAnniversaryMeta(), buildHabitMeta()]);
      ann = annResult;
      habitMeta = habitMetaResult;
    } else {
      ann = { details: null, dueDateYmd: null };
      habitMeta = await buildHabitMeta();
    }

    const intentionId = deps.newId();
    const finalHabitTitle = ann.details
      ? `🎂 ${birthdayLabel} ${ann.details.personName}`
      : smartTitle || habitsDefaultTitle;
    const anniversaryExtra = ann.details
      ? {
          type: 'ANNIVERSARY' as const,
          recurrence: 'yearly' as const,
          native_date: ann.details.native_date,
          person_name: ann.details.personName,
        }
      : {};
    const metadataForSync = JSON.stringify({
      ...habitMeta,
      ...anniversaryExtra,
    });
    const created = await createLocalTemporalIntention({
      id: intentionId,
      title: finalHabitTitle,
      rawTranscript: finalTranscript,
      localType: 'HABIT',
      dueDateYmd: ann.dueDateYmd,
      suggestedTags: ['regulier'],
      source: 'talk_debug_habit_local',
      metadataExtra: {
        ...habitMeta,
        ...anniversaryExtra,
      },
    });
    return {
      ok: true,
      outcome: {
        kind: 'persisted_temporal' as const,
        intentionId,
        mirrorType: 'HABIT',
        title: finalHabitTitle,
        dueDateYmd: created.dueDateYmd,
        metadataJson: metadataForSync,
        recapIntroI18nKey: 'talkDebug.habitQuickRecapIntro',
      },
    };
  } catch (error) {
    return { ok: false, error };
  }
}
