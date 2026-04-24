import * as chrono from 'chrono-node';

import {
  deleteTrankilV2IntentionById,
  finalizeOfflineFirstHabitFromShell,
  getTrankilV2IntentionById,
  updateTrankilV2IntentionMetadataJson,
  updateTrankilV2IntentionPendingAiFlag,
} from '../api/trankilV2Db';
import {
  extractAnniversaryDetails,
  extractHabitRecurrence,
  askGeminiExpert,
  atomizeProject,
  type GeminiExpertIntention,
} from './GeminiExpert';
import { persistGeminiExpertRows } from './ProjectPlanFlowService';
import { cleanTranscriptText } from './smartTitle';
import { computeNextYearlyDueDateFromNativeDate, formatYmdLocal, hasAnniversaryKeyword } from './TimeSorter';
import { applyOfflineFirstShellFailure, mergeIntentionMetadataJson } from './captureOfflineFirstUtils';
import { safeParseGeminiExpertRows } from './geminiResponseGuards';

function parseDueDateFromLocale(text: string, locale: string): string | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const ref = new Date();
  const loc = locale.toLowerCase();
  const tryParse = (mod: { parseDate?: (t: string, r: Date) => Date | null }) =>
    typeof mod.parseDate === 'function' ? mod.parseDate(raw, ref) : null;
  let parsed: Date | null = null;
  if (loc.startsWith('fr')) parsed = tryParse(chrono.fr);
  else if (loc.startsWith('en')) parsed = tryParse(chrono.en);
  else if (loc.startsWith('de')) parsed = tryParse(chrono.de);
  else if (loc.startsWith('it')) parsed = tryParse(chrono.it);
  else if (loc.startsWith('es')) parsed = tryParse(chrono.es);
  else if (loc.startsWith('ja')) parsed = tryParse(chrono.ja);
  else if (loc.startsWith('zh')) parsed = tryParse(chrono.zh);
  else parsed = tryParse(chrono.en);
  if (!parsed) return null;
  return formatYmdLocal(parsed);
}

function readMeta(row: { metadata_json: string }): Record<string, unknown> {
  try {
    const p = JSON.parse(row.metadata_json || '{}');
    if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return {};
}

async function runHabitAiUpgrade(
  row: Awaited<ReturnType<typeof getTrankilV2IntentionById>>,
  withTimeout: <T>(p: Promise<T>, ms: number) => Promise<T | null>,
  birthdayLabel: string,
  habitsDefaultTitle: string,
): Promise<void> {
  if (!row) throw new Error('MISSING_ROW');
  const finalTranscript = row.content_raw;
  const buildHabitMeta = async (): Promise<{ recurrence_rule?: Awaited<ReturnType<typeof extractHabitRecurrence>> }> => {
    const recurrence = await withTimeout(extractHabitRecurrence(finalTranscript), 2500);
    if (!recurrence) return {};
    return { recurrence_rule: recurrence };
  };
  const buildAnniversaryMeta = async (): Promise<{
    details: Awaited<ReturnType<typeof extractAnniversaryDetails>>;
    dueDateYmd: string | null;
  }> => {
    const details = await withTimeout(extractAnniversaryDetails(finalTranscript), 2500);
    if (!details) return { details: null, dueDateYmd: null };
    const dueDateYmd = computeNextYearlyDueDateFromNativeDate(details.native_date);
    return { details, dueDateYmd };
  };

  const hasAnniversary = hasAnniversaryKeyword(finalTranscript);
  let ann: { details: Awaited<ReturnType<typeof extractAnniversaryDetails>>; dueDateYmd: string | null };
  let habitMeta: { recurrence_rule?: Awaited<ReturnType<typeof extractHabitRecurrence>> };
  if (hasAnniversary) {
    const [annResult, habitMetaResult] = await Promise.all([buildAnniversaryMeta(), buildHabitMeta()]);
    ann = annResult;
    habitMeta = habitMetaResult;
  } else {
    ann = { details: null, dueDateYmd: null };
    habitMeta = await buildHabitMeta();
  }

  const smartTitle = row.title?.trim() || '';
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

  await finalizeOfflineFirstHabitFromShell(row.id, {
    title: finalHabitTitle,
    due_date: ann.dueDateYmd,
    metadata_json: metadataForSync,
    suggested_tags: suggestedTags,
    category_id: 'regulier',
  });
}

async function runExpertRowsFromShell(
  row: NonNullable<Awaited<ReturnType<typeof getTrankilV2IntentionById>>>,
  meta: Record<string, unknown>,
  locale: string,
): Promise<void> {
  const raw = row.content_raw;
  const kind = String(meta.ai_capture_kind || '');
  let expertRows: GeminiExpertIntention[] = [];

  if (kind === 'PROJECT_ATOMIZE') {
    const deadlineText = String(meta.project_deadline_text || '').trim();
    if (deadlineText) {
      const consolidatedPrompt = `Voici mon projet : ${cleanTranscriptText(raw)}. Je veux le terminer ${deadlineText}. Genere un plan de taches structure en JSON.`;
      const rawRows = await atomizeProject(consolidatedPrompt);
      const deadlineYmd = parseDueDateFromLocale(deadlineText, locale);
      const normalizedRows = safeParseGeminiExpertRows(rawRows).map((r) => {
        if (r.type !== 'TASK') return r;
        return {
          ...r,
          metadata: {
            ...(r.metadata ?? {}),
            due_date: (() => {
              const fallback = String((r.metadata as { due_date?: unknown })?.due_date || '').trim();
              return deadlineYmd ?? (fallback || null);
            })(),
          },
        };
      });
      expertRows = normalizedRows;
    } else {
      expertRows = safeParseGeminiExpertRows(await atomizeProject(raw));
    }
  } else {
    expertRows = safeParseGeminiExpertRows(await askGeminiExpert(raw));
  }

  if (expertRows.length === 0) {
    throw new Error('GEMINI_ROWS_INVALID');
  }

  await deleteTrankilV2IntentionById(row.id);
  await persistGeminiExpertRows(raw, expertRows, {
    status: 'TODO',
    isOrganized: 0,
  });
}

export function timelineRowEligibleForOfflineAiRetry(row: {
  type: string;
  is_pending_ai?: number;
  metadata_json?: string | null;
}): boolean {
  if (row.type !== 'NOTE' && row.type !== 'AUDIO') return false;
  if (row.is_pending_ai === 1) return true;
  const meta = (() => {
    try {
      const p = JSON.parse(row.metadata_json || '{}');
      return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  })();
  if (meta.awaiting_project_validation) return false;
  return Boolean(meta.ai_processing_failed);
}

export async function retryOfflineFirstAiSort(params: {
  intentionId: string;
  withTimeout: <T>(p: Promise<T>, ms: number) => Promise<T | null>;
  locale: string;
  birthdayLabel: string;
  habitsDefaultTitle: string;
}): Promise<{ ok: boolean; error?: unknown }> {
  const { intentionId, withTimeout, locale, birthdayLabel, habitsDefaultTitle } = params;
  const row = await getTrankilV2IntentionById(intentionId);
  if (!row || (row.type !== 'NOTE' && row.type !== 'AUDIO')) {
    return { ok: false, error: new Error('NOT_RETRYABLE') };
  }
  const meta = readMeta(row);
  const kind = String(meta.ai_capture_kind || '');
  if (!kind) return { ok: false, error: new Error('MISSING_CAPTURE_KIND') };

  await updateTrankilV2IntentionPendingAiFlag(intentionId, 1);
  await updateTrankilV2IntentionMetadataJson(
    intentionId,
    mergeIntentionMetadataJson(row.metadata_json, {
      ai_processing_failed: false,
      ai_transient_error: false,
    }),
  );

  try {
    if (kind === 'HABIT') {
      await runHabitAiUpgrade(row, withTimeout, birthdayLabel, habitsDefaultTitle);
      return { ok: true };
    }
    if (kind === 'GEMINI_EXPERT' || kind === 'PROJECT_ATOMIZE') {
      await runExpertRowsFromShell(row, meta, locale);
      return { ok: true };
    }
    return { ok: false, error: new Error('UNKNOWN_CAPTURE_KIND') };
  } catch (e) {
    await applyOfflineFirstShellFailure(intentionId, e);
    return { ok: false, error: e };
  }
}
