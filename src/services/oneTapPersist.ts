/**
 * Persistance des intentions issues du flux **one-tap** (JSON unifié déjà interprété).
 *
 * @module oneTapPersist
 */

import type { TrankilV2IntentionInsert } from '../api/trankilV2Db';
import {
  consumeListFreeSuccessOnce,
  getListFreeQuotaSnapshot,
  insertTrankilV2Intention,
  replaceTrankilV2IntentionOneTap,
} from '../api/trankilV2Db';
import type { CaptureStrategyDeps } from './captureStrategies/types';
import { executeQuickNoteCapture } from './captureStrategies/NoteStrategy';
import { executeHabitCapture } from './captureStrategies/HabitStrategy';
import {
  buildListInventoryJsonStringFromDraftBlock,
  geminiJsonToStoredPayload,
  mergeListPayloadIntoMetadataJson,
  parseGeminiListInventoryJson,
} from './listIntentionModel';
import { buildLocalTemporalIntentionInsertRow, createLocalTemporalIntention } from './localTemporalIntention';
import type { OneTapUniversalResult } from './oneTapUniversalCapture';
import { cancelOneTapUniversalReminders, scheduleOneTapUniversalReminders } from './oneTapUniversalReminders';

export type PersistOneTapSuccess =
  | {
      kind: 'persisted_temporal';
      intentionId: string;
      mirrorType: 'TASK' | 'HABIT';
      title: string;
      dueDateYmd: string | null;
      metadataJson?: string;
      recapIntroI18nKey: 'talkDebug.taskQuickRecapIntro' | 'talkDebug.habitQuickRecapIntro';
      consumedClassicFreeSlot: boolean;
    }
  | {
      kind: 'simple_note_or_audio';
      successFeedbackI18nKey: string;
      consumedClassicFreeSlot: boolean;
      intentionId?: string;
    }
  | {
      kind: 'list_inventory_persisted';
      intentionId: string;
      successFeedbackI18nKey: string;
      consumedListFreeSlot: boolean;
    };

export type PersistOneTapResult =
  | { ok: true; outcome: PersistOneTapSuccess }
  | { ok: false; error: unknown; code?: 'LIST_QUOTA' | 'LIST_SELECTION' };

function str(d: Record<string, unknown>, key: string): string | null {
  const v = d[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function logisticsFieldsFromDraft(
  data: Record<string, unknown>,
): Pick<TrankilV2IntentionInsert, 'remind_to_leave' | 'location_address'> {
  const remind = Boolean(data.remind_to_leave) ? 1 : 0;
  const loc = str(data, 'location_address');
  return { remind_to_leave: remind, location_address: loc };
}

function nextAnniversaryDueYmd(monthDay: string | null): string | null {
  if (!monthDay) return null;
  const s = monthDay.trim();
  let month = 0;
  let day = 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    month = Number(s.slice(5, 7));
    day = Number(s.slice(8, 10));
  } else if (/^\d{2}-\d{2}$/.test(s)) {
    month = Number(s.slice(0, 2));
    day = Number(s.slice(3, 5));
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const now = new Date();
  const y0 = now.getFullYear();
  const build = (y: number): Date | null => {
    const d = new Date(y, month - 1, day);
    if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d;
  };
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (let y = y0; y <= y0 + 2; y += 1) {
    const d = build(y);
    if (!d) continue;
    if (d.getTime() >= startToday) {
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const d1 = build(y0 + 1);
  if (!d1) return null;
  return `${d1.getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function materializeOneTapIntentionRow(params: {
  deps: CaptureStrategyDeps;
  draft: OneTapUniversalResult;
  transcript: string;
  intentionId: string;
  habitsDefaultTitle: string;
  birthdayLabel: string;
  isPendingAi: number;
}): Promise<TrankilV2IntentionInsert> {
  const { draft, transcript, intentionId, habitsDefaultTitle, birthdayLabel, isPendingAi, deps } = params;
  const title = draft.title.trim() || transcript.trim().slice(0, 200);
  const raw = transcript.trim();
  const created_at = Date.now();

  switch (draft.predictedType) {
    case 'NOTE':
      return {
        id: intentionId,
        type: 'NOTE',
        title: title || deps.translate('timeline.note'),
        due_date: null,
        content_raw: raw,
        metadata_json: JSON.stringify(
          {
            source: 'one_tap_universal',
            categoryTag: draft.categoryTag,
            local_stt_transcript: raw,
            memo: str(draft.data, 'memo'),
          },
          null,
          2,
        ),
        suggested_tags: JSON.stringify(['sans_pression']),
        category_id: 'sans_pression',
        parent_id: null,
        status: 'TODO',
        is_organized: 0,
        is_local_processed: 1,
        complexity_level: 0,
        created_at,
        is_pending_ai: isPendingAi,
      };
    case 'TASK':
    case 'RECURRING_TASK': {
      let dueDateYmd = str(draft.data, 'dueDateYmd') ?? str(draft.data, 'nextDueYmd');
      if (dueDateYmd && !/^\d{4}-\d{2}-\d{2}$/.test(dueDateYmd)) {
        dueDateYmd = null;
      }
      const metaExtra: Record<string, unknown> = {
        source: 'one_tap_universal',
        categoryTag: draft.categoryTag,
      };
      if (draft.predictedType === 'RECURRING_TASK') {
        metaExtra.recurring_task = draft.data;
      }
      const { row } = buildLocalTemporalIntentionInsertRow({
        id: intentionId,
        title,
        rawTranscript: raw,
        localType: 'TASK',
        dueDateYmd,
        suggestedTags: [draft.categoryTag.toLowerCase().replace(/\s+/g, '_')],
        source: 'one_tap_task',
        metadataExtra: metaExtra,
        is_pending_ai: isPendingAi,
        created_at,
      });
      return row;
    }
    case 'HABIT': {
      const habitTitle = (title || habitsDefaultTitle).slice(0, 200);
      return {
        id: intentionId,
        type: 'HABIT',
        title: habitTitle,
        due_date: null,
        content_raw: raw,
        metadata_json: JSON.stringify(
          {
            source: 'one_tap_universal',
            categoryTag: draft.categoryTag,
            cadenceDescription: str(draft.data, 'cadenceDescription'),
            preferredTimeHm: str(draft.data, 'preferredTimeHm'),
            notes: str(draft.data, 'notes'),
            destination_name: str(draft.data, 'destination_name') ?? undefined,
            location_address: str(draft.data, 'location_address') ?? undefined,
            remind_to_leave: Boolean(draft.data.remind_to_leave) ? true : undefined,
          },
          null,
          2,
        ),
        suggested_tags: JSON.stringify(['sans_pression']),
        category_id: 'regulier',
        parent_id: null,
        status: 'TODO',
        is_organized: 0,
        is_local_processed: 1,
        complexity_level: 1,
        created_at,
        is_pending_ai: isPendingAi,
        ...logisticsFieldsFromDraft(draft.data as Record<string, unknown>),
      };
    }
    case 'ANNIVERSARY': {
      const personName = str(draft.data, 'personName') || title;
      const habitTitle = `🎂 ${birthdayLabel} ${personName}`.trim().slice(0, 200);
      const md = str(draft.data, 'monthDay');
      const dueDateYmd = nextAnniversaryDueYmd(md);
      const metadataForSync = JSON.stringify(
        {
          source: 'talk_debug_habit_local',
          type: 'ANNIVERSARY',
          recurrence: 'yearly',
          person_name: personName,
          month_day: md,
          categoryTag: draft.categoryTag,
        },
        null,
        2,
      );
      return {
        id: intentionId,
        type: 'HABIT',
        title: habitTitle,
        due_date: dueDateYmd,
        content_raw: raw,
        metadata_json: metadataForSync,
        suggested_tags: JSON.stringify(dueDateYmd ? ['regulier'] : ['sans_pression']),
        category_id: dueDateYmd ? 'regulier' : 'sans_pression',
        parent_id: null,
        status: 'TODO',
        is_organized: 0,
        is_local_processed: 1,
        complexity_level: 1,
        created_at,
        is_pending_ai: isPendingAi,
      };
    }
    case 'LIST': {
      const listBlock = draft.data.list;
      if (!listBlock || typeof listBlock !== 'object') {
        throw new Error('LIST_DATA_MISSING');
      }
      const jsonStr = buildListInventoryJsonStringFromDraftBlock(listBlock as Record<string, unknown>, title);
      const parsedList = parseGeminiListInventoryJson(jsonStr);
      const payload = geminiJsonToStoredPayload(parsedList);
      const mergedTitle = title || payload.title;
      const meta = mergeListPayloadIntoMetadataJson('{}', { ...payload, title: mergedTitle });
      return {
        id: intentionId,
        type: 'LIST',
        title: mergedTitle,
        due_date: null,
        content_raw: raw,
        metadata_json: meta,
        suggested_tags: JSON.stringify(['sans_pression']),
        category_id: null,
        parent_id: null,
        status: 'TODO',
        is_organized: 0,
        is_local_processed: 1,
        complexity_level: 0,
        created_at,
        is_pending_ai: isPendingAi,
      };
    }
    default:
      throw new Error('unsupported_type');
  }
}

/**
 * Pré-enregistrement SQLite dès la réponse Gemini (brouillon `is_pending_ai = 1`).
 */
export async function preSaveOneTapOptimisticDraft(params: {
  deps: CaptureStrategyDeps;
  draft: OneTapUniversalResult;
  transcript: string;
  habitsDefaultTitle: string;
  birthdayLabel: string;
}): Promise<{ ok: true; intentionId: string } | { ok: false; error: unknown }> {
  const intentionId = params.deps.newId();
  try {
    const row = await materializeOneTapIntentionRow({
      ...params,
      intentionId,
      isPendingAi: 1,
    });
    await insertTrankilV2Intention(row);
    console.log(`[SQLite] Optimistic Save Success - ID: ${intentionId}`);
    return { ok: true, intentionId };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Met à jour une intention one-tap déjà insérée (même id) après affinage IA — garde `is_pending_ai = 1`.
 */
export async function replacePendingOneTapDraft(params: {
  deps: CaptureStrategyDeps;
  intentionId: string;
  draft: OneTapUniversalResult;
  transcript: string;
  habitsDefaultTitle: string;
  birthdayLabel: string;
}): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    const row = await materializeOneTapIntentionRow({
      deps: params.deps,
      draft: params.draft,
      transcript: params.transcript,
      intentionId: params.intentionId,
      habitsDefaultTitle: params.habitsDefaultTitle,
      birthdayLabel: params.birthdayLabel,
      isPendingAi: 1,
    });
    const { id: _id, created_at: _ct, ...patch } = row;
    await replaceTrankilV2IntentionOneTap(params.intentionId, patch);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Met à jour l’intention pré-enregistrée après validation modale (Option B).
 */
export async function finalizeOneTapOptimisticDraft(params: {
  deps: CaptureStrategyDeps;
  intentionId: string;
  draft: OneTapUniversalResult;
  transcript: string;
  habitsDefaultTitle: string;
  birthdayLabel: string;
}): Promise<PersistOneTapResult> {
  const { intentionId, deps, draft, transcript, habitsDefaultTitle, birthdayLabel } = params;
  const consumedClassic = !deps.spectrum.isProUser;
  const title = draft.title.trim() || transcript.trim().slice(0, 200);

  try {
    if (draft.predictedType === 'LIST') {
      if (!deps.spectrum.isProUser) {
        const gate = await getListFreeQuotaSnapshot();
        if (gate.remaining <= 0) {
          return { ok: false, error: new Error('list_quota_exhausted'), code: 'LIST_QUOTA' };
        }
      }
    }

    let row: TrankilV2IntentionInsert;
    try {
      row = await materializeOneTapIntentionRow({
        deps,
        draft,
        transcript,
        intentionId,
        habitsDefaultTitle,
        birthdayLabel,
        isPendingAi: 0,
      });
    } catch (e) {
      if (e instanceof Error && e.message === 'LIST_NO_ITEMS_SELECTED') {
        return { ok: false, error: e, code: 'LIST_SELECTION' };
      }
      return { ok: false, error: e };
    }

    const { id: _id, created_at: _ct, ...replacePatch } = row;
    await cancelOneTapUniversalReminders(intentionId);
    await replaceTrankilV2IntentionOneTap(intentionId, replacePatch);

    if (draft.predictedType === 'LIST' && !deps.spectrum.isProUser) {
      await consumeListFreeSuccessOnce();
    }

    void scheduleOneTapUniversalReminders({
      intentionId,
      title: row.title,
      data: draft.data,
      translate: deps.translate,
    });

    switch (draft.predictedType) {
      case 'NOTE':
        return {
          ok: true,
          outcome: {
            kind: 'simple_note_or_audio',
            successFeedbackI18nKey: 'talkDebug.noteSaved',
            consumedClassicFreeSlot: consumedClassic,
            intentionId,
          },
        };
      case 'TASK':
      case 'RECURRING_TASK': {
        let dueDateYmd = str(draft.data, 'dueDateYmd') ?? str(draft.data, 'nextDueYmd');
        if (dueDateYmd && !/^\d{4}-\d{2}-\d{2}$/.test(dueDateYmd)) {
          dueDateYmd = null;
        }
        return {
          ok: true,
          outcome: {
            kind: 'persisted_temporal',
            intentionId,
            mirrorType: 'TASK',
            title: row.title,
            dueDateYmd,
            recapIntroI18nKey: 'talkDebug.taskQuickRecapIntro',
            consumedClassicFreeSlot: consumedClassic,
          },
        };
      }
      case 'HABIT':
      case 'ANNIVERSARY':
        return {
          ok: true,
          outcome: {
            kind: 'persisted_temporal',
            intentionId,
            mirrorType: 'HABIT',
            title: row.title,
            dueDateYmd: row.due_date ?? null,
            metadataJson: row.metadata_json,
            recapIntroI18nKey: 'talkDebug.habitQuickRecapIntro',
            consumedClassicFreeSlot: consumedClassic,
          },
        };
      case 'LIST':
        return {
          ok: true,
          outcome: {
            kind: 'list_inventory_persisted',
            intentionId,
            successFeedbackI18nKey: 'talkDebug.listSavedToast',
            consumedListFreeSlot: !deps.spectrum.isProUser,
          },
        };
      default:
        return { ok: false, error: new Error('unsupported_type') };
    }
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Enregistre en SQLite (et consomme les quotas Free pertinents) une intention validée dans la modale one-tap.
 *
 * @param params.deps — Dépendances capture (ids, timeouts, traductions).
 * @param params.draft — Résultat Gemini + éventuelles éditions utilisateur.
 * @param params.transcript — Texte brut conservé comme `content_raw`.
 * @param params.habitsDefaultTitle — Libellé par défaut des habitudes (i18n).
 * @param params.birthdayLabel — Libellé anniversaire (i18n).
 * @returns Succès discriminant ou erreur quota liste.
 */
export async function persistOneTapDraft(params: {
  deps: CaptureStrategyDeps;
  draft: OneTapUniversalResult;
  transcript: string;
  habitsDefaultTitle: string;
  birthdayLabel: string;
}): Promise<PersistOneTapResult> {
  const { deps, draft, transcript, habitsDefaultTitle, birthdayLabel } = params;
  const title = draft.title.trim() || transcript.trim().slice(0, 200);
  const raw = transcript.trim();
  const consumedClassic = !deps.spectrum.isProUser;

  try {
    switch (draft.predictedType) {
      case 'NOTE': {
        const res = await executeQuickNoteCapture({
          deps,
          title,
          finalTranscript: raw,
          fallbackNoteTitle: deps.translate('timeline.note'),
        });
        if (!res.ok) return { ok: false, error: res.error };
        const noteOut = res.outcome;
        const noteIntentionId =
          noteOut.kind === 'simple_note_or_audio' &&
          'intentionId' in noteOut &&
          typeof (noteOut as { intentionId?: string }).intentionId === 'string'
            ? (noteOut as { intentionId: string }).intentionId
            : undefined;
        if (noteIntentionId) {
          void scheduleOneTapUniversalReminders({
            intentionId: noteIntentionId,
            title,
            data: draft.data,
            translate: deps.translate,
          });
        }
        return {
          ok: true,
          outcome: {
            kind: 'simple_note_or_audio',
            successFeedbackI18nKey: 'talkDebug.noteSaved',
            consumedClassicFreeSlot: consumedClassic,
            intentionId: noteIntentionId,
          },
        };
      }
      case 'TASK':
      case 'RECURRING_TASK': {
        let dueDateYmd = str(draft.data, 'dueDateYmd') ?? str(draft.data, 'nextDueYmd');
        if (dueDateYmd && !/^\d{4}-\d{2}-\d{2}$/.test(dueDateYmd)) {
          dueDateYmd = null;
        }
        const intentionId = deps.newId();
        const metaExtra: Record<string, unknown> = {
          source: 'one_tap_universal',
          categoryTag: draft.categoryTag,
        };
        if (draft.predictedType === 'RECURRING_TASK') {
          metaExtra.recurring_task = draft.data;
        }
        const created = await createLocalTemporalIntention({
          id: intentionId,
          title,
          rawTranscript: raw,
          localType: 'TASK',
          dueDateYmd,
          suggestedTags: [draft.categoryTag.toLowerCase().replace(/\s+/g, '_')],
          source: 'one_tap_task',
          metadataExtra: metaExtra,
        });
        void scheduleOneTapUniversalReminders({
          intentionId,
          title,
          data: draft.data,
          translate: deps.translate,
        });
        return {
          ok: true,
          outcome: {
            kind: 'persisted_temporal',
            intentionId,
            mirrorType: 'TASK',
            title,
            dueDateYmd: created.dueDateYmd,
            recapIntroI18nKey: 'talkDebug.taskQuickRecapIntro',
            consumedClassicFreeSlot: consumedClassic,
          },
        };
      }
      case 'HABIT':
      case 'ANNIVERSARY': {
        const res = await executeHabitCapture({
          deps,
          finalTranscript: raw,
          smartTitle: title,
          habitsDefaultTitle,
          birthdayLabel,
        });
        if (!res.ok) return { ok: false, error: res.error };
        if (res.outcome.kind === 'offline_raw_note_saved') {
          return { ok: true, outcome: { kind: 'simple_note_or_audio', successFeedbackI18nKey: 'capture.offlineNoteGenericToast', consumedClassicFreeSlot: false } };
        }
        if (res.outcome.kind !== 'persisted_temporal') {
          return { ok: false, error: new Error('unexpected_habit_outcome') };
        }
        const o = res.outcome;
        void scheduleOneTapUniversalReminders({
          intentionId: o.intentionId,
          title,
          data: draft.data,
          translate: deps.translate,
        });
        return {
          ok: true,
          outcome: {
            kind: 'persisted_temporal',
            intentionId: o.intentionId,
            mirrorType: 'HABIT',
            title: o.title,
            dueDateYmd: o.dueDateYmd,
            metadataJson: o.metadataJson,
            recapIntroI18nKey: 'talkDebug.habitQuickRecapIntro',
            consumedClassicFreeSlot: consumedClassic,
          },
        };
      }
      case 'LIST': {
        if (!deps.spectrum.isProUser) {
          const gate = await getListFreeQuotaSnapshot();
          if (gate.remaining <= 0) {
            return { ok: false, error: new Error('list_quota_exhausted'), code: 'LIST_QUOTA' };
          }
        }
        const listBlock = draft.data.list;
        if (!listBlock || typeof listBlock !== 'object') {
          return { ok: false, error: new Error('LIST_DATA_MISSING') };
        }
        let parsedList;
        try {
          const jsonStr = buildListInventoryJsonStringFromDraftBlock(
            listBlock as Record<string, unknown>,
            title,
          );
          parsedList = parseGeminiListInventoryJson(jsonStr);
        } catch (e) {
          if (e instanceof Error && e.message === 'LIST_NO_ITEMS_SELECTED') {
            return { ok: false, error: e, code: 'LIST_SELECTION' };
          }
          return { ok: false, error: e };
        }
        const payload = geminiJsonToStoredPayload(parsedList);
        const mergedTitle = title || payload.title;
        const id = deps.newId();
        const meta = mergeListPayloadIntoMetadataJson(
          '{}',
          { ...payload, title: mergedTitle },
        );
        await insertTrankilV2Intention({
          id,
          type: 'LIST',
          title: mergedTitle,
          content_raw: raw,
          metadata_json: meta,
          suggested_tags: JSON.stringify(['sans_pression']),
          category_id: null,
          parent_id: null,
          status: 'TODO',
          is_organized: 0,
          is_local_processed: 1,
          complexity_level: 0,
          created_at: Date.now(),
        });
        if (!deps.spectrum.isProUser) {
          await consumeListFreeSuccessOnce();
        }
        void scheduleOneTapUniversalReminders({
          intentionId: id,
          title: mergedTitle,
          data: draft.data,
          translate: deps.translate,
        });
        return {
          ok: true,
          outcome: {
            kind: 'list_inventory_persisted',
            intentionId: id,
            successFeedbackI18nKey: 'talkDebug.listSavedToast',
            consumedListFreeSlot: !deps.spectrum.isProUser,
          },
        };
      }
      default:
        return { ok: false, error: new Error('unsupported_type') };
    }
  } catch (error) {
    return { ok: false, error };
  }
}
