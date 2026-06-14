/**
 * Projet voyage monolithique — brief Pass 1, signaux transcript, affichage Inbox.
 * @module travelProjectModel
 */
import {
  ensureProjectMilestoneUids,
  parseProjectMilestonesPayloadFromMetadataJson,
  type ProjectMilestonesPayload,
} from '../services/projectMilestonesModel';

export const PROJECT_BRIEF_METADATA_KEY = 'project_brief_v1';
export const PROJECT_PACKING_METADATA_KEY = 'project_packing_v1';

export type ProjectBriefV1 = {
  version: 1;
  destination: string | null;
  party: string[];
  flights: string | null;
  constraints: string[];
  departure_ymd: string | null;
  auto_detail_requested: boolean;
};

export type TravelProjectTranscriptSignals = {
  travelPrepLikely: boolean;
  explicitProject: boolean;
  fullDetailRequested: boolean;
  valiseLikely: boolean;
  shouldPreferProject: boolean;
};

const TRAVEL_PREP_RE =
  /\b(voyage|trip|d[ée]part|logistique|valise|packing|transit|escale|avion|partir en|pr[ée]parer.*voyage|organiser.*voyage)\b/i;
const EXPLICIT_PROJECT_RE =
  /\b(c'est un projet|cest un projet|structure.*projet|organiser un voyage|projet complet|je veux le d[ée]tail)\b/i;
const FULL_DETAIL_RE =
  /\b(d[ée]tail complet|structure bien|je veux le d[ée]tail|d[ée]tail de ce qu'il faut|liste compl[èe]te)\b/i;
const VALISE_RE = /\b(valise|packing|affaires|mettre dans la valise)\b/i;

export function detectTravelProjectTranscriptSignals(transcript: string): TravelProjectTranscriptSignals {
  const text = String(transcript ?? '');
  const travelPrepLikely = TRAVEL_PREP_RE.test(text);
  const explicitProject = EXPLICIT_PROJECT_RE.test(text);
  const fullDetailRequested = FULL_DETAIL_RE.test(text);
  const valiseLikely = VALISE_RE.test(text);
  const shouldPreferProject =
    travelPrepLikely && (explicitProject || fullDetailRequested || (valiseLikely && /\b(enfant|enfants|famille|mari|voyageur)\b/i.test(text)));
  return {
    travelPrepLikely,
    explicitProject,
    fullDetailRequested,
    valiseLikely,
    shouldPreferProject,
  };
}

export function shouldAutoEnrichTravelProject(
  transcript: string,
  brief: ProjectBriefV1 | null | undefined,
): boolean {
  if (!brief) return false;
  if (brief.auto_detail_requested) return true;
  return detectTravelProjectTranscriptSignals(transcript).fullDetailRequested;
}

function normalizeParty(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeConstraints(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .slice(0, 16);
}

export function parseProjectBriefFromIntentRaw(raw: Record<string, unknown>, transcript: string): ProjectBriefV1 | null {
  const block = raw.project_brief;
  const signals = detectTravelProjectTranscriptSignals(transcript);
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    if (!signals.shouldPreferProject) return null;
    return {
      version: 1,
      destination: null,
      party: [],
      flights: null,
      constraints: [],
      departure_ymd: null,
      auto_detail_requested: signals.fullDetailRequested,
    };
  }
  const o = block as Record<string, unknown>;
  return {
    version: 1,
    destination: String(o.destination ?? '').trim() || null,
    party: normalizeParty(o.party),
    flights: String(o.flights ?? '').trim() || null,
    constraints: normalizeConstraints(o.constraints),
    departure_ymd: String(o.departure_ymd ?? o.departureYmd ?? '').trim() || null,
    auto_detail_requested:
      o.auto_detail_requested === true ||
      signals.fullDetailRequested ||
      /\b(d[ée]tail complet|structure bien)\b/i.test(transcript),
  };
}

export function parseProjectBriefFromMetadataJson(raw: string | null | undefined): ProjectBriefV1 | null {
  if (!raw || !String(raw).trim()) return null;
  try {
    const root = JSON.parse(raw) as Record<string, unknown>;
    const block = root[PROJECT_BRIEF_METADATA_KEY];
    if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
    const o = block as Record<string, unknown>;
    if (Number(o.version) !== 1) return null;
    return {
      version: 1,
      destination: String(o.destination ?? '').trim() || null,
      party: normalizeParty(o.party),
      flights: String(o.flights ?? '').trim() || null,
      constraints: normalizeConstraints(o.constraints),
      departure_ymd: String(o.departure_ymd ?? '').trim() || null,
      auto_detail_requested: o.auto_detail_requested === true,
    };
  } catch {
    return null;
  }
}

export function buildProjectBriefMetadataPatch(brief: ProjectBriefV1): Record<string, unknown> {
  return { [PROJECT_BRIEF_METADATA_KEY]: brief };
}

export type TravelProjectPackingCategory = {
  name: string;
  itemCount: number;
};

/** Valises par voyageur (`project_packing_v1`) — catégories = prénoms. */
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

export function formatTravelProjectInboxLine2(params: {
  brief: ProjectBriefV1 | null;
  milestoneCount: number | null;
  dueYmd: string | null;
  locale: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  /** true si le badge +N voyageurs est affiché à gauche (évite la redondance en L2). */
  omitPartyInLine2?: boolean;
}): string | null {
  const { brief, milestoneCount, dueYmd, locale, t, omitPartyInLine2 } = params;
  if (!brief && milestoneCount == null && !dueYmd) return null;

  const parts: string[] = [t('timeline.inboxProjectLabel', { defaultValue: 'Projet' })];
  const partyLen = brief?.party?.length ?? 0;
  if (partyLen > 0 && !omitPartyInLine2) {
    parts.push(
      t('timeline.travelProjectPartyCount', {
        count: partyLen,
        defaultValue: `${partyLen} voyageur${partyLen > 1 ? 's' : ''}`,
      }),
    );
  }
  if (dueYmd && /^\d{4}-\d{2}-\d{2}$/.test(dueYmd)) {
    try {
      const [y, m, d] = dueYmd.split('-').map((n) => Number(n));
      const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
      const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(dt);
      parts.push(
        t('timeline.travelProjectDeparture', {
          date: day,
          defaultValue: `départ ${day}`,
        }),
      );
    } catch {
      parts.push(dueYmd);
    }
  }
  if (milestoneCount != null && milestoneCount > 0) {
    parts.push(
      t('timeline.inboxProjectItemCount', {
        count: milestoneCount,
        defaultValue: `${milestoneCount} étapes`,
      }),
    );
  }
  return parts.join(' · ');
}

export function resolveTravelProjectMilestoneCount(metadataJson: string | null | undefined): number | null {
  const payload = parseProjectMilestonesPayloadFromMetadataJson(metadataJson);
  if (!payload?.milestones?.length) return null;
  const real = payload.milestones.filter((m) => String(m.title ?? '').trim() && m.title !== '—');
  return real.length > 0 ? real.length : null;
}

/** Jalons déterministes si Pass 2 Gemini échoue (projet voyage). */
export function buildFallbackTravelProjectMilestones(brief: ProjectBriefV1, title: string): ProjectMilestonesPayload {
  const pivot = brief.departure_ymd;
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
