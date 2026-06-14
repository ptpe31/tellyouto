/**
 * Pass 2 projet depuis le hub IdeaBank (sans bottom sheet détail).
 */
import { getTrankilV2IntentionById, patchMetadata } from '../api/trankilV2Db';
import { enrichProjectAfterPersist } from './projectEnrich';
import { geminiEnrichGenericList } from './geminiSemanticLab';
import {
  buildProjectMilestonesMetadataPatch,
  parseProjectMilestonesPayloadFromMetadataJson,
} from './projectMilestonesModel';
import { parseProjectBriefFromMetadataJson } from '../utils/travelProjectModel';

const PASS2_UNLOCKED = 1;

export async function runProjectPass2ForHub(params: {
  intentionId: string;
  uiLocale: string;
}): Promise<{ ok: true; metadataJson: string } | { ok: false; error: unknown }> {
  const intentionId = String(params.intentionId ?? '').trim();
  if (!intentionId) return { ok: false, error: new Error('PROJECT_PASS2_MISSING_ID') };

  const row = await getTrankilV2IntentionById(intentionId);
  if (!row) return { ok: false, error: new Error('PROJECT_PASS2_ROW_NOT_FOUND') };

  const transcript = String(row.content_raw ?? '').trim();
  const titleFallback = String(row.title ?? '').trim() || 'Projet';
  const brief = parseProjectBriefFromMetadataJson(row.metadata_json);

  try {
    await patchMetadata(
      intentionId,
      { is_generating: true, list_enrich_status: 'pending', list_enrich_error: null },
      { silent: true },
    );

    if (brief) {
      const result = await enrichProjectAfterPersist({
        intentionId,
        transcript,
        brief,
        titleFallback,
        uiLocale: params.uiLocale,
      });
      if (!result.ok) return { ok: false, error: result.error };
      const fresh = await getTrankilV2IntentionById(intentionId);
      return {
        ok: true,
        metadataJson: String(fresh?.metadata_json ?? row.metadata_json ?? '{}'),
      };
    }

    const enriched = await geminiEnrichGenericList(transcript, {
      uiLocale: params.uiLocale,
      mode: 'PROJECT',
    });
    if (enriched.mode !== 'PROJECT') throw new Error('PROJECT_ENRICH_MODE_MISMATCH');
    const payload = enriched.parsed;
    const enrichStatus = enriched.salvaged ? 'partial' : 'done';
    const donePatch = {
      ...buildProjectMilestonesMetadataPatch({ ...payload, title: titleFallback }),
      is_generating: false,
      list_enrich_status: enrichStatus,
      list_enrich_error: enriched.salvaged ? 'fallback_or_salvaged' : null,
      pass2_unlocked: PASS2_UNLOCKED,
      project_enriched: true,
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

export function hubRowHasProjectMilestones(metadataJson: string | null | undefined): boolean {
  const payload = parseProjectMilestonesPayloadFromMetadataJson(metadataJson);
  if (!payload?.milestones?.length) return false;
  return payload.milestones.some((m) => String(m.title ?? '').trim() && m.title !== '—');
}
