/**
 * Pass 2 liste depuis le hub IdeaBank (sans bottom sheet détail).
 */
import { getTrankilV2IntentionById, patchMetadata } from '../api/trankilV2Db';
import { geminiEnrichGenericList } from './geminiSemanticLab';
import {
  buildListMetadataPatch,
  geminiJsonToStoredPayload,
  parseListScalablePayloadFromMetadataJson,
} from './listIntentionModel';

const PASS2_UNLOCKED = 1;

export async function runListPass2ForHub(params: {
  intentionId: string;
  uiLocale: string;
}): Promise<{ ok: true; metadataJson: string } | { ok: false; error: unknown }> {
  const intentionId = String(params.intentionId ?? '').trim();
  if (!intentionId) return { ok: false, error: new Error('LIST_PASS2_MISSING_ID') };

  const row = await getTrankilV2IntentionById(intentionId);
  if (!row) return { ok: false, error: new Error('LIST_PASS2_ROW_NOT_FOUND') };

  const transcript = String(row.content_raw ?? '').trim();
  const titleFallback = String(row.title ?? '').trim() || 'Liste';

  try {
    await patchMetadata(
      intentionId,
      { is_generating: true, list_enrich_status: 'pending', list_enrich_error: null },
      { silent: true },
    );

    const enriched = await geminiEnrichGenericList(transcript, {
      uiLocale: params.uiLocale,
      mode: 'LIST',
      referenceTimeIso: new Date().toISOString(),
    });
    if (enriched.mode !== 'LIST') throw new Error('LIST_ENRICH_MODE_MISMATCH');

    const payload = geminiJsonToStoredPayload(enriched.parsed);
    const donePatch = {
      ...buildListMetadataPatch({ ...payload, title: titleFallback }),
      is_generating: false,
      list_enrich_status: 'done',
      list_enrich_error: null,
      pass2_unlocked: PASS2_UNLOCKED,
    };
    await patchMetadata(intentionId, donePatch, { silent: true });
    const fresh = await getTrankilV2IntentionById(intentionId);
    return {
      ok: true,
      metadataJson: String(fresh?.metadata_json ?? JSON.stringify(donePatch)),
    };
  } catch (error) {
    try {
      await patchMetadata(
        intentionId,
        {
          is_generating: false,
          list_enrich_status: 'error',
          list_enrich_error: error instanceof Error ? error.message : String(error),
        },
        { silent: true },
      );
    } catch {
      /* best effort */
    }
    return { ok: false, error };
  }
}

export function hubRowHasListItems(metadataJson: string | null | undefined): boolean {
  const payload = parseListScalablePayloadFromMetadataJson(metadataJson);
  if (!payload?.categories?.length) return false;
  return payload.categories.some((cat) =>
    cat.items.some((it) => String(it.name ?? '').trim()),
  );
}
