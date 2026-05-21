/** DEPRECATED — stratégie pré-OneTap, non exportée. Voir `nettoyage-code-mort.md` §10. */
import { finalizeOfflineFirstHabitFromShell, insertTrankilV2Intention } from '../../api/trankilV2Db';
import type { GeminiAnniversaryDetails, GeminiHabitRecurrence } from '../GeminiExpert';
import { extractAnniversaryDetails, extractHabitRecurrence } from '../GeminiExpert';
import {
  computeNextYearlyDueDateFromNativeDate,
  hasAnniversaryKeyword,
} from '../TimeSorter';
import { applyOfflineFirstShellFailure } from '../captureOfflineFirstUtils';
import type { CaptureChooseActionResult, CaptureStrategyDeps } from './types';

export async function executeHabitCapture(params: {
  deps: CaptureStrategyDeps;
  finalTranscript: string;
  smartTitle: string;
  habitsDefaultTitle: string;
  birthdayLabel: string;
}): Promise<CaptureChooseActionResult> {
  const { deps, finalTranscript, smartTitle, habitsDefaultTitle, birthdayLabel } = params;
  const intentionId = deps.newId();
  const draftTitle = (smartTitle || habitsDefaultTitle || finalTranscript).trim().slice(0, 200) || habitsDefaultTitle;

  try {
    await insertTrankilV2Intention({
      id: intentionId,
      type: 'NOTE',
      title: draftTitle,
      content_raw: finalTranscript,
      metadata_json: JSON.stringify(
        {
          source: 'offline_first_habit_shell',
          offline_first_pending_ai: true,
          ai_capture_kind: 'HABIT',
        },
        null,
        2,
      ),
      suggested_tags: JSON.stringify(['sans_pression']),
      category_id: 'HEALTH',
      parent_id: null,
      status: 'TODO',
      is_organized: 0,
      is_local_processed: 0,
      complexity_level: 0,
      created_at: Date.now(),
      is_pending_ai: 1,
    });
  } catch (error) {
    return { ok: false, error };
  }

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
    const metadataForSync = JSON.stringify(
      {
        ...habitMeta,
        ...anniversaryExtra,
        source: 'talk_debug_habit_local',
      },
      null,
      2,
    );
    const suggestedTags = ann.dueDateYmd ? JSON.stringify(['regulier']) : JSON.stringify(['sans_pression']);

    await finalizeOfflineFirstHabitFromShell(intentionId, {
      title: finalHabitTitle,
      due_date: ann.dueDateYmd,
      metadata_json: metadataForSync,
      suggested_tags: suggestedTags,
      category_id: 'HEALTH',
    });

    return {
      ok: true,
      outcome: {
        kind: 'persisted_temporal' as const,
        intentionId,
        mirrorType: 'HABIT',
        title: finalHabitTitle,
        dueDateYmd: ann.dueDateYmd,
        metadataJson: metadataForSync,
        recapIntroI18nKey: 'talkDebug.habitQuickRecapIntro',
      },
    };
  } catch (error) {
    await applyOfflineFirstShellFailure(intentionId, error);
    return {
      ok: true,
      outcome: {
        kind: 'offline_raw_note_saved' as const,
        intentionId,
      },
    };
  }
}
