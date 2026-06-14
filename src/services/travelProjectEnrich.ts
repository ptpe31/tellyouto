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
  buildFallbackTravelProjectMilestones,
  buildProjectBriefMetadataPatch,
  PROJECT_PACKING_METADATA_KEY,
  type ProjectBriefV1,
} from '../utils/travelProjectModel';
import { logCaptureFlow } from '../utils/captureFlowLog';

const PASS2_UNLOCKED_CONSUMED = 1;

export type TravelProjectEnrichStatus = 'done' | 'partial' | 'error';

async function resolveMilestonesPayload(params: {
  transcript: string;
  brief: ProjectBriefV1;
  uiLocale: string;
  titleFallback: string;
  intentionId: string;
  trace?: string;
}): Promise<{ payload: ProjectMilestonesPayload; enrichStatus: TravelProjectEnrichStatus }> {
  const { transcript, brief, uiLocale, titleFallback, intentionId, trace } = params;
  try {
    const enriched = await geminiEnrichGenericList(transcript, {
      uiLocale,
      mode: 'PROJECT_TRAVEL',
      projectBrief: brief,
    });
    if (enriched.mode !== 'PROJECT') {
      throw new Error('TRAVEL_PROJECT_ENRICH_MODE_MISMATCH');
    }
    const status: TravelProjectEnrichStatus = enriched.salvaged ? 'partial' : 'done';
    if (enriched.salvaged) {
      logCaptureFlow(trace, 'travel_project_pass2_salvaged', { intentionId, milestoneCount: enriched.parsed.milestones.length });
    }
    return { payload: ensureProjectMilestoneUids(enriched.parsed), enrichStatus: status };
  } catch (geminiErr) {
    logCaptureFlow(trace, 'travel_project_pass2_gemini_fail', {
      intentionId,
      err: geminiErr instanceof Error ? geminiErr.message : String(geminiErr),
    });
    const fallback = buildFallbackTravelProjectMilestones(brief, titleFallback);
    logCaptureFlow(trace, 'travel_project_pass2_fallback', { intentionId, milestoneCount: fallback.milestones.length });
    return { payload: fallback, enrichStatus: 'partial' };
  }
}

export async function enrichTravelProjectAfterPersist(params: {
  intentionId: string;
  transcript: string;
  brief: ProjectBriefV1;
  titleFallback?: string;
  uiLocale: string;
  trace?: string;
}): Promise<
  | { ok: true; enrichStatus: TravelProjectEnrichStatus; payload: ProjectMilestonesPayload }
  | { ok: false; error: unknown }
> {
  const { intentionId, transcript, brief, uiLocale } = params;
  const captureTrace = params.trace?.trim() || undefined;
  const titleFallback = String(params.titleFallback ?? brief.destination ?? 'Projet voyage').trim() || 'Projet voyage';

  try {
    await patchMetadata(
      intentionId,
      { is_generating: true, list_enrich_status: 'pending', list_enrich_error: null },
      { silent: true },
    );

    logCaptureFlow(captureTrace, 'travel_project_pass2_start', {
      intentionId,
      partyCount: brief.party.length,
      autoDetail: brief.auto_detail_requested,
    });

    const { payload: resolvedPayload, enrichStatus } = await resolveMilestonesPayload({
      transcript,
      brief,
      uiLocale,
      titleFallback,
      intentionId,
      trace: captureTrace,
    });

    let payload: ProjectMilestonesPayload = resolvedPayload;
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
        list_enrich_status: enrichStatus,
        list_enrich_error: enrichStatus === 'partial' ? 'fallback_or_salvaged' : null,
        pass2_unlocked: PASS2_UNLOCKED_CONSUMED,
        travel_project_enriched: true,
      },
      { silent: true },
    );

    logCaptureFlow(captureTrace, 'travel_project_pass2_done', {
      intentionId,
      milestoneCount: payload.milestones.length,
      enrichStatus,
      hasPacking: Boolean(packingPatch[PROJECT_PACKING_METADATA_KEY]),
    });
    return { ok: true, enrichStatus, payload };
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
