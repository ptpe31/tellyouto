/**
 * Pass 2 auto — projet multi-domaine (jalons + valises voyage si applicable).
 */
import { patchMetadata } from '../api/trankilV2Db';
import {
  buildProjectMilestonesMetadataPatch,
  ensureProjectMilestoneUids,
  type ProjectMilestonesPayload,
} from './projectMilestonesModel';
import { geminiEnrichGenericList, geminiEnrichTravelProjectPacking } from './geminiSemanticLab';
import { resolveProjectEnrichMode } from './projectEnrichRouter';
import {
  buildProjectBriefMetadataPatch,
  buildFallbackProjectMilestones,
  isTravelBrief,
  PROJECT_PACKING_METADATA_KEY,
  type UnifiedProjectBrief,
} from '../utils/travelProjectModel';
import { logCaptureFlow } from '../utils/captureFlowLog';

const PASS2_UNLOCKED_CONSUMED = 1;

export type ProjectEnrichStatus = 'done' | 'partial' | 'error';

function briefToPass2Context(brief: UnifiedProjectBrief) {
  return {
    destination: brief.destination ?? null,
    stakeholders: brief.stakeholders,
    party: brief.stakeholders,
    flights: brief.flights ?? null,
    constraints: brief.constraints,
    target_ymd: brief.target_ymd,
    departure_ymd: brief.target_ymd,
    room: brief.room ?? null,
    budget_hint: brief.budget_hint ?? null,
    trades_needed: brief.trades_needed ?? [],
    context_notes: brief.context_notes,
  };
}

async function resolveMilestonesPayload(params: {
  transcript: string;
  brief: UnifiedProjectBrief;
  uiLocale: string;
  titleFallback: string;
  intentionId: string;
  trace?: string;
}): Promise<{ payload: ProjectMilestonesPayload; enrichStatus: ProjectEnrichStatus }> {
  const { transcript, brief, uiLocale, titleFallback, intentionId, trace } = params;
  const enrichMode = resolveProjectEnrichMode(brief);
  try {
    const enriched = await geminiEnrichGenericList(transcript, {
      uiLocale,
      mode: enrichMode,
      projectBrief: briefToPass2Context(brief),
    });
    if (enriched.mode !== 'PROJECT') {
      throw new Error('PROJECT_ENRICH_MODE_MISMATCH');
    }
    const status: ProjectEnrichStatus = enriched.salvaged ? 'partial' : 'done';
    if (enriched.salvaged) {
      logCaptureFlow(trace, 'project_pass2_salvaged', {
        intentionId,
        domain: brief.domain,
        milestoneCount: enriched.parsed.milestones.length,
      });
    }
    return { payload: ensureProjectMilestoneUids(enriched.parsed), enrichStatus: status };
  } catch (geminiErr) {
    logCaptureFlow(trace, 'project_pass2_gemini_fail', {
      intentionId,
      domain: brief.domain,
      err: geminiErr instanceof Error ? geminiErr.message : String(geminiErr),
    });
    const fallback = buildFallbackProjectMilestones(brief, titleFallback);
    logCaptureFlow(trace, 'project_pass2_fallback', {
      intentionId,
      domain: brief.domain,
      milestoneCount: fallback.milestones.length,
    });
    return { payload: fallback, enrichStatus: 'partial' };
  }
}

export async function enrichProjectAfterPersist(params: {
  intentionId: string;
  transcript: string;
  brief: UnifiedProjectBrief;
  titleFallback?: string;
  uiLocale: string;
  trace?: string;
}): Promise<
  | { ok: true; enrichStatus: ProjectEnrichStatus; payload: ProjectMilestonesPayload }
  | { ok: false; error: unknown }
> {
  const { intentionId, transcript, brief, uiLocale } = params;
  const captureTrace = params.trace?.trim() || undefined;
  const titleFallback =
    String(params.titleFallback ?? brief.destination ?? brief.room ?? 'Projet').trim() || 'Projet';

  try {
    await patchMetadata(
      intentionId,
      { is_generating: true, list_enrich_status: 'pending', list_enrich_error: null },
      { silent: true },
    );

    logCaptureFlow(captureTrace, 'project_pass2_start', {
      intentionId,
      domain: brief.domain,
      stakeholderCount: brief.stakeholders.length,
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

    if (isTravelBrief(brief) && brief.stakeholders.length > 0) {
      try {
        const packing = await geminiEnrichTravelProjectPacking({
          transcript,
          uiLocale,
          party: brief.stakeholders,
          constraints: brief.constraints,
          destination: brief.destination ?? null,
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
                pivot_date: brief.target_ymd,
                note: null,
              },
            ],
          });
        }
      } catch (packErr) {
        logCaptureFlow(captureTrace, 'project_packing_skip', {
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
        project_enriched: true,
        travel_project_enriched: isTravelBrief(brief) ? true : undefined,
      },
      { silent: true },
    );

    logCaptureFlow(captureTrace, 'project_pass2_done', {
      intentionId,
      domain: brief.domain,
      milestoneCount: payload.milestones.length,
      enrichStatus,
      hasPacking: Boolean(packingPatch[PROJECT_PACKING_METADATA_KEY]),
    });
    return { ok: true, enrichStatus, payload };
  } catch (error) {
    logCaptureFlow(captureTrace, 'project_pass2_fail', {
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

/** @deprecated Utiliser enrichProjectAfterPersist */
export const enrichTravelProjectAfterPersist = enrichProjectAfterPersist;

export type TravelProjectEnrichStatus = ProjectEnrichStatus;
