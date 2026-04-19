import {
  consumeListFreeSuccessOnce,
  getListFreeQuotaSnapshot,
  insertTrankilV2Intention,
} from '../../api/trankilV2Db';
import { geminiListInventoryFromTranscript } from '../geminiSemanticLab';
import { geminiJsonToStoredPayload, mergeListPayloadIntoMetadataJson } from '../listIntentionModel';
import type { CaptureStrategyDeps } from './types';
import type { ListCaptureOutcome } from './types';

/**
 * Entrée de la stratégie **capture liste** (dictée → Gemini → SQLite).
 */
export type ExecuteListCaptureInput = {
  deps: CaptureStrategyDeps;
  finalTranscript: string;
  fallbackTitle: string;
};

/** Résultat discriminant succès / erreur quota / erreur IA. */
export type ExecuteListCaptureResult =
  | { ok: true; outcome: ListCaptureOutcome }
  | { ok: false; error: unknown; code?: 'LIST_QUOTA' | 'LIST_GEMINI' };

/**
 * Orchestre une capture **LIST** : quota liste Free, appel Gemini Flash, insertion `LIST` non organisée.
 *
 * @param input — `deps` (timeouts, locale, ids), transcript et titre de repli.
 * @returns Succès avec id d’intention, ou erreur (`LIST_QUOTA` / `LIST_GEMINI`).
 */
export async function executeListInventoryCapture(input: ExecuteListCaptureInput): Promise<ExecuteListCaptureResult> {
  const { deps, finalTranscript, fallbackTitle } = input;
  const trimmed = String(finalTranscript || '').trim();
  if (!trimmed) {
    return { ok: false, error: new Error('empty_transcript'), code: 'LIST_GEMINI' };
  }
  try {
    if (!deps.spectrum.isProUser) {
      const gate = await getListFreeQuotaSnapshot();
      if (gate.remaining <= 0) {
        return { ok: false, error: new Error('list_quota_exhausted'), code: 'LIST_QUOTA' };
      }
    }

    const { parsed } = await geminiListInventoryFromTranscript(trimmed, {
      isProContext: deps.spectrum.isProUser,
      uiLocale: deps.spectrum.locale || 'fr',
    });
    const payload = geminiJsonToStoredPayload(parsed);
    const id = deps.newId();
    const meta = mergeListPayloadIntoMetadataJson('{}', payload);
    await insertTrankilV2Intention({
      id,
      type: 'LIST',
      title: payload.title || fallbackTitle,
      content_raw: trimmed,
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
    return {
      ok: true,
      outcome: {
        kind: 'list_inventory_persisted',
        intentionId: id,
        successFeedbackI18nKey: 'talkDebug.listSavedToast',
      },
    };
  } catch (e) {
    return { ok: false, error: e, code: 'LIST_GEMINI' };
  }
}
