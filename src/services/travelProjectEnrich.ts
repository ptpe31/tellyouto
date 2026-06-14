/**
 * Pass 2 auto — projet voyage (jalons + valises par voyageur).
 */
import { patchMetadata } from '../api/trankilV2Db';
import {
  buildProjectMilestonesMetadataPatch,
  ensureProjectMilestoneUids,
  type ProjectMilestonesPayload,
} from './projectMilestonesModel';
import { geminiEnrichGenericList, geminiEnrichTravelProjectPacking } from './geminiSemanticLab';
import {
  buildProjectBriefMetadataPatch,
  PROJECT_PACKING_METADATA_KEY,
  type ProjectBriefV1,
} from '../utils/travelProjectModel';
import { logCaptureFlow } from '../utils/captureFlowLog';

const PASS2_UNLOCKED_CONSUMED = 1;

export async function enrichTravelProjectAfterPersist(params: {
  intentionId: string;
  transcript: string;
  brief: ProjectBriefV1;
  uiLocale: string;
  trace?: string;
}): Promise<{ ok: true } | { ok: false; error: unknown }> {
  const { intentionId, transcript, brief, uiLocale } = params;
  const captureTrace = params.trace?.trim() || undefined;
  try {
    logCaptureFlow(captureTrace, 'travel_project_pass2_start', {
      intentionId,
      partyCount: brief.party.length,
      autoDetail: brief.auto_detail_requested,
    });

    const enriched = await geminiEnrichGenericList(transcript, {
      uiLocale,
      mode: 'PROJECT_TRAVEL',
      projectBrief: brief,
    });
    if (enriched.mode !== 'PROJECT') {
      return { ok: false, error: new Error('TRAVEL_PROJECT_ENRICH_MODE_MISMATCH') };
    }

    let payload: ProjectMilestonesPayload = ensureProjectMilestoneUids(enriched.parsed);
    let packingPatch: Record<string, unknown> = {};

    if (brief.party.length > 0) {
      try {
        const packing = await geminiEnrichTravelProjectPacking({
          transcript,
          uiLocale,
          party: brief.party,
          constraints: brief.constraints,
          destination: brief.destination,
        });
        packingPatch = { [PROJECT_PACKING_METADATA_KEY]: packing.parsed };
        const packingMilestoneTitle = 'Valises par voyageur';
        const hasPacking = payload.milestones.some((m) =>
          /\b(valise|packing|bagage)\b/i.test(String(m.title ?? '')),
        );
        if (!hasPacking) {
          payload = ensureProjectMilestoneUids({
            ...payload,
            milestones: [
              ...payload.milestones,
              {
                uid: '',
                title: packingMilestoneTitle,
                estimated_duration: 1,
                unit: 'days',
                expert_persona: 'Logisticien famille',
                checked: false,
                pivot_date: brief.departure_ymd,
                note: null,
              },
            ],
          });
        }
      } catch (packErr) {
        logCaptureFlow(captureTrace, 'travel_project_packing_skip', {
          intentionId,
          err: packErr instanceof Error ? packErr.message : String(packErr),
        });
      }
    }

    await patchMetadata(
      intentionId,
      {
        ...buildProjectMilestonesMetadataPatch(payload),
        ...buildProjectBriefMetadataPatch(brief),
        ...packingPatch,
        is_generating: false,
        list_enrich_status: 'done',
        list_enrich_error: null,
        pass2_unlocked: PASS2_UNLOCKED_CONSUMED,
        travel_project_enriched: true,
      },
      { silent: true },
    );

    logCaptureFlow(captureTrace, 'travel_project_pass2_done', {
      intentionId,
      milestoneCount: payload.milestones.length,
      hasPacking: Boolean(packingPatch[PROJECT_PACKING_METADATA_KEY]),
    });
    return { ok: true };
  } catch (error) {
    logCaptureFlow(captureTrace, 'travel_project_pass2_fail', {
      intentionId,
      err: error instanceof Error ? error.message : String(error),
    });
    try {
      await patchMetadata(
        intentionId,
        {
          list_enrich_status: 'error',
          list_enrich_error: error instanceof Error ? error.message : String(error),
          is_generating: false,
        },
        { silent: true },
      );
    } catch {
      /* best effort */
    }
    return { ok: false, error };
  }
}
