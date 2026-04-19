/**
 * Persistance des intentions issues du flux **one-tap** (JSON unifié déjà interprété).
 *
 * @module oneTapPersist
 */

import {
  consumeListFreeSuccessOnce,
  getListFreeQuotaSnapshot,
  insertTrankilV2Intention,
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
import { createLocalTemporalIntention } from './localTemporalIntention';
import type { OneTapUniversalResult } from './oneTapUniversalCapture';
import { scheduleOneTapUniversalReminders } from './oneTapUniversalReminders';

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
        if (res.outcome.kind === 'simple_note_or_audio' && res.outcome.intentionId) {
          void scheduleOneTapUniversalReminders({
            intentionId: res.outcome.intentionId,
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
