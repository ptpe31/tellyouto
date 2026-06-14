/**
 * Projet — brief, signaux transcript, affichage Inbox (voyage + multi-domaine).
 * @module travelProjectModel
 */
import { PROJECT_MULTI_DOMAIN_ENABLED } from '../config/projectMultiDomain';
import {
  ensureProjectMilestoneUids,
  parseProjectMilestonesPayloadFromMetadataJson,
  type ProjectMilestone,
  type ProjectMilestonesPayload,
} from '../services/projectMilestonesModel';
import {
  buildBriefMetadataPatchCompat,
  buildUnifiedBriefMetadataPatch,
  detectTravelProjectTranscriptSignals,
  inferProjectDomainFromTranscript,
  isTravelBrief,
  parseBriefV1Block,
  parseUnifiedBriefFromIntentRaw,
  parseUnifiedBriefFromMetadataJson,
  PROJECT_BRIEF_V1_KEY,
  shouldAutoEnrichProject,
  type ProjectBriefV1,
  type ProjectBriefV2,
  type ProjectDomain,
  type TravelProjectTranscriptSignals,
  type UnifiedProjectBrief,
} from './projectBriefModel';

export const PROJECT_BRIEF_METADATA_KEY = PROJECT_BRIEF_V1_KEY;
export const PROJECT_PACKING_METADATA_KEY = 'project_packing_v1';

export type { ProjectBriefV1, ProjectBriefV2, ProjectDomain, TravelProjectTranscriptSignals, UnifiedProjectBrief };

export {
  detectTravelProjectTranscriptSignals,
  inferProjectDomainFromTranscript,
  isTravelBrief,
  shouldAutoEnrichProject,
};

/** @deprecated Utiliser shouldAutoEnrichProject */
export function shouldAutoEnrichTravelProject(
  transcript: string,
  brief: UnifiedProjectBrief | ProjectBriefV1 | null | undefined,
): boolean {
  if (!brief) return false;
  if ('domain' in brief && brief.version === 2) {
    return shouldAutoEnrichProject(transcript, brief);
  }
  const v1 = brief as ProjectBriefV1;
  return shouldAutoEnrichProject(transcript, {
    version: 2,
    domain: 'travel',
    auto_detail_requested: v1.auto_detail_requested,
    target_ymd: v1.departure_ymd,
    stakeholders: v1.party,
    constraints: v1.constraints,
    context_notes: null,
    destination: v1.destination,
    flights: v1.flights,
  });
}

export function parseProjectBriefFromIntentRaw(
  raw: Record<string, unknown>,
  transcript: string,
): UnifiedProjectBrief | null {
  return parseUnifiedBriefFromIntentRaw(raw, transcript);
}

export function parseProjectBriefFromMetadataJson(raw: string | null | undefined): UnifiedProjectBrief | null {
  return parseUnifiedBriefFromMetadataJson(raw);
}

export function buildProjectBriefMetadataPatch(brief: UnifiedProjectBrief): Record<string, unknown> {
  return buildBriefMetadataPatchCompat(brief);
}

export type TravelProjectPackingCategory = {
  name: string;
  itemCount: number;
};

export function parseTravelProjectPackingFromMetadataJson(
  raw: string | null | undefined,
): TravelProjectPackingCategory[] {
  if (!raw || !String(raw).trim()) return [];
  try {
    const root = JSON.parse(raw) as Record<string, unknown>;
    const block = root[PROJECT_PACKING_METADATA_KEY];
    if (!block || typeof block !== 'object' || Array.isArray(block)) return [];
    const cats = (block as Record<string, unknown>).categories;
    if (!Array.isArray(cats)) return [];
    return cats
      .map((c) => {
        if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
        const cr = c as Record<string, unknown>;
        const name = String(cr.name ?? '').trim();
        if (!name) return null;
        const itemsRaw = cr.items;
        const itemCount = Array.isArray(itemsRaw) ? itemsRaw.length : 0;
        return { name, itemCount };
      })
      .filter(Boolean) as TravelProjectPackingCategory[];
  } catch {
    return [];
  }
}

export function formatProjectInboxLine2(params: {
  brief: UnifiedProjectBrief | null;
  milestoneCount: number | null;
  dueYmd: string | null;
  locale: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  omitMilestoneInLine2?: boolean;
}): string | null {
  const { brief, milestoneCount, dueYmd, locale, t, omitMilestoneInLine2 } = params;
  if (!brief && milestoneCount == null && !dueYmd) return null;

  const parts: string[] = [t('timeline.inboxProjectLabel', { defaultValue: 'Projet' })];
  const domain = brief?.domain ?? 'generic';

  if (domain === 'travel') {
    const partyLen = brief?.stakeholders?.length ?? 0;
    if (partyLen > 0) {
      parts.push(
        t('timeline.travelProjectPartyCount', {
          count: partyLen,
          defaultValue: `${partyLen} voyageur${partyLen > 1 ? 's' : ''}`,
        }),
      );
    }
    if (brief?.destination) {
      parts.push(brief.destination);
    }
  } else if (domain === 'renovation' && brief?.room) {
    parts.push(brief.room);
  } else if (domain === 'event' && brief?.context_notes) {
    parts.push(brief.context_notes.slice(0, 40));
  } else if (brief?.context_notes) {
    parts.push(brief.context_notes.slice(0, 40));
  }

  const targetYmd = dueYmd ?? brief?.target_ymd ?? null;
  if (targetYmd && /^\d{4}-\d{2}-\d{2}$/.test(targetYmd)) {
    try {
      const [y, m, d] = targetYmd.split('-').map((n) => Number(n));
      const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
      const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(dt);
      const dateKey =
        domain === 'travel'
          ? 'timeline.travelProjectDeparture'
          : 'timeline.projectTargetDate';
      const dateDefault = domain === 'travel' ? `départ ${day}` : `échéance ${day}`;
      parts.push(t(dateKey, { date: day, defaultValue: dateDefault }));
    } catch {
      parts.push(targetYmd);
    }
  }

  if (milestoneCount != null && milestoneCount > 0 && !omitMilestoneInLine2) {
    parts.push(
      t('timeline.inboxProjectItemCount', {
        count: milestoneCount,
        defaultValue: `${milestoneCount} étapes`,
      }),
    );
  }
  return parts.join(' · ');
}

/** @deprecated Utiliser formatProjectInboxLine2 */
export function formatTravelProjectInboxLine2(
  params: Parameters<typeof formatProjectInboxLine2>[0],
): string | null {
  return formatProjectInboxLine2(params);
}

export function resolveProjectMilestoneCount(metadataJson: string | null | undefined): number | null {
  const milestones = resolveProjectMilestonesForInbox(metadataJson);
  return milestones.length > 0 ? milestones.length : null;
}

/** @deprecated */
export const resolveTravelProjectMilestoneCount = resolveProjectMilestoneCount;

/** Jalons réels (hors placeholder « — ») pour accordéon Inbox projet. */
export function resolveProjectMilestonesForInbox(metadataJson: string | null | undefined): ProjectMilestone[] {
  const payload = parseProjectMilestonesPayloadFromMetadataJson(metadataJson);
  if (!payload?.milestones?.length) return [];
  return payload.milestones.filter((m) => String(m.title ?? '').trim() && m.title !== '—');
}

/** @deprecated */
export const resolveTravelProjectMilestonesForInbox = resolveProjectMilestonesForInbox;

export function shouldShowProjectInboxAccordion(
  metadataJson: string | null | undefined,
  brief: UnifiedProjectBrief | null,
): boolean {
  const milestones = resolveProjectMilestonesForInbox(metadataJson);
  if (milestones.length === 0) return false;
  if (!PROJECT_MULTI_DOMAIN_ENABLED) {
    return brief != null && isTravelBrief(brief);
  }
  return true;
}

export function buildFallbackTravelProjectMilestones(
  brief: UnifiedProjectBrief | ProjectBriefV1,
  title: string,
): ProjectMilestonesPayload {
  const pivot =
    'domain' in brief && brief.version === 2
      ? brief.target_ymd
      : (brief as ProjectBriefV1).departure_ymd;
  const templates: Array<{ title: string; duration: number; unit: 'hours' | 'days' | 'weeks'; persona: string }> = [
    { title: 'Administratif', duration: 2, unit: 'weeks', persona: 'Expert administratif' },
    { title: 'Billets & escale', duration: 3, unit: 'hours', persona: 'Agent aérien' },
    { title: 'Kit escale', duration: 2, unit: 'days', persona: 'Assistant voyage' },
    { title: 'Valises par voyageur', duration: 1, unit: 'days', persona: 'Logisticien famille' },
    { title: 'Logistique départ', duration: 1, unit: 'days', persona: 'Assistant voyage' },
  ];
  return ensureProjectMilestoneUids({
    title: title.slice(0, 200),
    milestones: templates.map((t) => ({
      uid: '',
      title: t.title,
      estimated_duration: t.duration,
      unit: t.unit,
      expert_persona: t.persona,
      checked: false,
      pivot_date: pivot,
      note: null,
    })),
  });
}

export function buildFallbackRenovationProjectMilestones(
  brief: UnifiedProjectBrief,
  title: string,
): ProjectMilestonesPayload {
  const room = brief.room ? ` ${brief.room}` : '';
  const pivot = brief.target_ymd;
  const templates: Array<{ title: string; duration: number; unit: 'hours' | 'days' | 'weeks'; persona: string }> = [
    { title: 'Devis & budget', duration: 1, unit: 'weeks', persona: 'Chef de chantier' },
    { title: `Démolition${room}`, duration: 2, unit: 'days', persona: 'Démolisseur' },
    { title: 'Plomberie & électricité', duration: 1, unit: 'weeks', persona: 'Artisan' },
    { title: 'Finitions & peinture', duration: 1, unit: 'weeks', persona: 'Peintre' },
    { title: 'Nettoyage & réception', duration: 1, unit: 'days', persona: 'Assistant personnel' },
  ];
  return ensureProjectMilestoneUids({
    title: title.slice(0, 200),
    milestones: templates.map((t) => ({
      uid: '',
      title: t.title.trim(),
      estimated_duration: t.duration,
      unit: t.unit,
      expert_persona: t.persona,
      checked: false,
      pivot_date: pivot,
      note: null,
    })),
  });
}

export function buildFallbackEventProjectMilestones(
  brief: UnifiedProjectBrief,
  title: string,
): ProjectMilestonesPayload {
  const pivot = brief.target_ymd;
  const templates: Array<{ title: string; duration: number; unit: 'hours' | 'days' | 'weeks'; persona: string }> = [
    { title: 'Budget & invités', duration: 2, unit: 'weeks', persona: 'Wedding planner' },
    { title: 'Lieu & traiteur', duration: 3, unit: 'weeks', persona: 'Organisateur' },
    { title: 'Invitations', duration: 1, unit: 'weeks', persona: 'Assistant personnel' },
    { title: 'Décoration & logistique', duration: 1, unit: 'weeks', persona: 'Décorateur' },
    { title: 'Jour J', duration: 1, unit: 'days', persona: 'Coordinateur' },
  ];
  return ensureProjectMilestoneUids({
    title: title.slice(0, 200),
    milestones: templates.map((t) => ({
      uid: '',
      title: t.title,
      estimated_duration: t.duration,
      unit: t.unit,
      expert_persona: t.persona,
      checked: false,
      pivot_date: pivot,
      note: null,
    })),
  });
}

export function buildFallbackGenericProjectMilestones(
  brief: UnifiedProjectBrief,
  title: string,
): ProjectMilestonesPayload {
  const pivot = brief.target_ymd;
  const templates: Array<{ title: string; duration: number; unit: 'hours' | 'days' | 'weeks'; persona: string }> = [
    { title: 'Cadrage & objectifs', duration: 3, unit: 'days', persona: 'Assistant personnel' },
    { title: 'Plan d\'action', duration: 1, unit: 'weeks', persona: 'Chef de projet' },
    { title: 'Exécution principale', duration: 2, unit: 'weeks', persona: 'Expert métier' },
    { title: 'Suivi & ajustements', duration: 3, unit: 'days', persona: 'Assistant personnel' },
    { title: 'Finalisation', duration: 2, unit: 'days', persona: 'Assistant personnel' },
  ];
  return ensureProjectMilestoneUids({
    title: title.slice(0, 200),
    milestones: templates.map((t) => ({
      uid: '',
      title: t.title,
      estimated_duration: t.duration,
      unit: t.unit,
      expert_persona: t.persona,
      checked: false,
      pivot_date: pivot,
      note: null,
    })),
  });
}

export function buildFallbackProjectMilestones(
  brief: UnifiedProjectBrief,
  title: string,
): ProjectMilestonesPayload {
  switch (brief.domain) {
    case 'travel':
      return buildFallbackTravelProjectMilestones(brief, title);
    case 'renovation':
      return buildFallbackRenovationProjectMilestones(brief, title);
    case 'event':
      return buildFallbackEventProjectMilestones(brief, title);
    default:
      return buildFallbackGenericProjectMilestones(brief, title);
  }
}

// Re-export for metadata patch without v1 compat when only v2 needed
export { buildUnifiedBriefMetadataPatch };
