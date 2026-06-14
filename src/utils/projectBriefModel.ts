/**
 * Brief projet unifié — multi-domaine (v2) + rétrocompat voyage (v1).
 * @module projectBriefModel
 */
import { PROJECT_MULTI_DOMAIN_ENABLED } from '../config/projectMultiDomain';

export const PROJECT_BRIEF_V1_KEY = 'project_brief_v1';
export const PROJECT_BRIEF_V2_KEY = 'project_brief_v2';

export type ProjectDomain = 'travel' | 'renovation' | 'event' | 'move' | 'generic';

/** Brief voyage historique (metadata existante). */
export type ProjectBriefV1 = {
  version: 1;
  destination: string | null;
  party: string[];
  flights: string | null;
  constraints: string[];
  departure_ymd: string | null;
  auto_detail_requested: boolean;
};

export type ProjectBriefV2 = {
  version: 2;
  domain: ProjectDomain;
  auto_detail_requested: boolean;
  target_ymd: string | null;
  stakeholders: string[];
  constraints: string[];
  context_notes: string | null;
  destination?: string | null;
  flights?: string | null;
  room?: string | null;
  budget_hint?: string | null;
  trades_needed?: string[];
};

export type UnifiedProjectBrief = ProjectBriefV2;

export type GenericProjectTranscriptSignals = {
  explicitProject: boolean;
  fullDetailRequested: boolean;
  renovationLikely: boolean;
  eventLikely: boolean;
  moveLikely: boolean;
};

export type TravelProjectTranscriptSignals = {
  travelPrepLikely: boolean;
  explicitProject: boolean;
  fullDetailRequested: boolean;
  valiseLikely: boolean;
  shouldPreferProject: boolean;
};

const EXPLICIT_PROJECT_RE =
  /\b(c'est un projet|cest un projet|structure.*projet|projet complet|je veux le d[ée]tail|organiser un voyage)\b/i;
const FULL_DETAIL_RE =
  /\b(d[ée]tail complet|structure bien|je veux le d[ée]tail|d[ée]tail de ce qu'il faut|liste compl[èe]te)\b/i;
const TRAVEL_PREP_RE =
  /\b(voyage|trip|d[ée]part|logistique|valise|packing|transit|escale|avion|partir en|pr[ée]parer.*voyage|organiser.*voyage)\b/i;
const VALISE_RE = /\b(valise|packing|affaires|mettre dans la valise)\b/i;
const RENOVATION_RE =
  /\b(r[ée]nov|r[ée]nover|travaux|refaire|cuisine|salle de bain|carrelage|plomberie|peinture|d[ée]molition)\b/i;
const EVENT_RE =
  /\b(mariage|anniversaire|f[êe]te|soir[ée]e|bapt[êe]me|r[ée]ception|[ée]v[ée]nement|organiser.*mariage)\b/i;
const MOVE_RE = /\b(d[ée]m[ée]nag|emm[ée]nag|cartons|d[ée]m[ée]nagement)\b/i;

export function detectGenericProjectTranscriptSignals(transcript: string): GenericProjectTranscriptSignals {
  const text = String(transcript ?? '');
  return {
    explicitProject: EXPLICIT_PROJECT_RE.test(text),
    fullDetailRequested: FULL_DETAIL_RE.test(text),
    renovationLikely: RENOVATION_RE.test(text),
    eventLikely: EVENT_RE.test(text),
    moveLikely: MOVE_RE.test(text),
  };
}

export function detectTravelProjectTranscriptSignals(transcript: string): TravelProjectTranscriptSignals {
  const text = String(transcript ?? '');
  const travelPrepLikely = TRAVEL_PREP_RE.test(text);
  const explicitProject = EXPLICIT_PROJECT_RE.test(text);
  const fullDetailRequested = FULL_DETAIL_RE.test(text);
  const valiseLikely = VALISE_RE.test(text);
  const shouldPreferProject =
    travelPrepLikely &&
    (explicitProject || fullDetailRequested || (valiseLikely && /\b(enfant|enfants|famille|mari|voyageur)\b/i.test(text)));
  return {
    travelPrepLikely,
    explicitProject,
    fullDetailRequested,
    valiseLikely,
    shouldPreferProject,
  };
}

export function inferProjectDomainFromTranscript(transcript: string): ProjectDomain {
  const travel = detectTravelProjectTranscriptSignals(transcript);
  if (travel.travelPrepLikely || travel.shouldPreferProject) return 'travel';
  const generic = detectGenericProjectTranscriptSignals(transcript);
  if (generic.renovationLikely) return 'renovation';
  if (generic.eventLikely) return 'event';
  if (generic.moveLikely) return 'move';
  return 'generic';
}

function normalizeStringList(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeYmd(raw: unknown): string | null {
  const s = String(raw ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function briefV1ToUnified(v1: ProjectBriefV1): UnifiedProjectBrief {
  return {
    version: 2,
    domain: 'travel',
    auto_detail_requested: v1.auto_detail_requested,
    target_ymd: v1.departure_ymd,
    stakeholders: [...v1.party],
    constraints: [...v1.constraints],
    context_notes: null,
    destination: v1.destination,
    flights: v1.flights,
  };
}

export function parseBriefV2Block(block: Record<string, unknown>): UnifiedProjectBrief | null {
  if (Number(block.version) !== 2) return null;
  const domainRaw = String(block.domain ?? 'generic').trim().toLowerCase();
  const domain: ProjectDomain =
    domainRaw === 'travel' ||
    domainRaw === 'renovation' ||
    domainRaw === 'event' ||
    domainRaw === 'move'
      ? domainRaw
      : 'generic';
  return {
    version: 2,
    domain,
    auto_detail_requested: block.auto_detail_requested === true,
    target_ymd: normalizeYmd(block.target_ymd ?? block.departure_ymd),
    stakeholders: normalizeStringList(block.stakeholders ?? block.party, 12),
    constraints: normalizeStringList(block.constraints, 16),
    context_notes: String(block.context_notes ?? '').trim() || null,
    destination: String(block.destination ?? '').trim() || null,
    flights: String(block.flights ?? '').trim() || null,
    room: String(block.room ?? '').trim() || null,
    budget_hint: String(block.budget_hint ?? '').trim() || null,
    trades_needed: normalizeStringList(block.trades_needed, 12),
  };
}

export function parseBriefV1Block(block: Record<string, unknown>): ProjectBriefV1 | null {
  if (Number(block.version) !== 1 && block.version != null) return null;
  return {
    version: 1,
    destination: String(block.destination ?? '').trim() || null,
    party: normalizeStringList(block.party, 12),
    flights: String(block.flights ?? '').trim() || null,
    constraints: normalizeStringList(block.constraints, 16),
    departure_ymd: normalizeYmd(block.departure_ymd ?? block.departureYmd),
    auto_detail_requested: block.auto_detail_requested === true,
  };
}

export function parseUnifiedBriefFromIntentRaw(
  raw: Record<string, unknown>,
  transcript: string,
): UnifiedProjectBrief | null {
  const travelSignals = detectTravelProjectTranscriptSignals(transcript);
  const genericSignals = detectGenericProjectTranscriptSignals(transcript);

  const v2Block = raw[PROJECT_BRIEF_V2_KEY] ?? raw.project_brief_v2 ?? raw.project_brief;
  if (v2Block && typeof v2Block === 'object' && !Array.isArray(v2Block)) {
    const block = v2Block as Record<string, unknown>;
    const parsedV2 = Number(block.version) === 2 ? parseBriefV2Block(block) : null;
    if (parsedV2) {
      return {
        ...parsedV2,
        auto_detail_requested:
          parsedV2.auto_detail_requested ||
          genericSignals.fullDetailRequested ||
          /\b(d[ée]tail complet|structure bien)\b/i.test(transcript),
      };
    }
  }

  const legacyV1Block = raw[PROJECT_BRIEF_V1_KEY];
  if (legacyV1Block && typeof legacyV1Block === 'object' && !Array.isArray(legacyV1Block)) {
    const v1 = parseBriefV1Block(legacyV1Block as Record<string, unknown>);
    if (v1) {
      return {
        ...briefV1ToUnified(v1),
        auto_detail_requested:
          v1.auto_detail_requested ||
          genericSignals.fullDetailRequested ||
          travelSignals.fullDetailRequested ||
          /\b(d[ée]tail complet|structure bien)\b/i.test(transcript),
      };
    }
  }

  const v1Block = raw.project_brief;
  if (v1Block && typeof v1Block === 'object' && !Array.isArray(v1Block)) {
    const v1 = parseBriefV1Block(v1Block as Record<string, unknown>);
    if (v1) {
      return {
        ...briefV1ToUnified(v1),
        auto_detail_requested:
          v1.auto_detail_requested ||
          genericSignals.fullDetailRequested ||
          travelSignals.fullDetailRequested ||
          /\b(d[ée]tail complet|structure bien)\b/i.test(transcript),
      };
    }
  }

  if (!PROJECT_MULTI_DOMAIN_ENABLED) {
    if (!travelSignals.shouldPreferProject) return null;
    return {
      version: 2,
      domain: 'travel',
      auto_detail_requested: travelSignals.fullDetailRequested,
      target_ymd: null,
      stakeholders: [],
      constraints: [],
      context_notes: null,
      destination: null,
      flights: null,
    };
  }

  const wantsBrief =
    genericSignals.explicitProject ||
    genericSignals.fullDetailRequested ||
    travelSignals.shouldPreferProject;

  if (!wantsBrief) return null;

  const domain = inferProjectDomainFromTranscript(transcript);
  return {
    version: 2,
    domain,
    auto_detail_requested: genericSignals.fullDetailRequested || travelSignals.fullDetailRequested,
    target_ymd: null,
    stakeholders: [],
    constraints: [],
    context_notes: null,
    ...(domain === 'travel' ? { destination: null, flights: null } : {}),
    ...(domain === 'renovation' ? { room: null, budget_hint: null, trades_needed: [] } : {}),
  };
}

export function parseUnifiedBriefFromMetadataJson(raw: string | null | undefined): UnifiedProjectBrief | null {
  if (!raw || !String(raw).trim()) return null;
  try {
    const root = JSON.parse(raw) as Record<string, unknown>;
    const v2 = root[PROJECT_BRIEF_V2_KEY];
    if (v2 && typeof v2 === 'object' && !Array.isArray(v2)) {
      return parseBriefV2Block(v2 as Record<string, unknown>);
    }
    const v1 = root[PROJECT_BRIEF_V1_KEY];
    if (v1 && typeof v1 === 'object' && !Array.isArray(v1)) {
      const parsed = parseBriefV1Block(v1 as Record<string, unknown>);
      return parsed ? briefV1ToUnified(parsed) : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function buildUnifiedBriefMetadataPatch(brief: UnifiedProjectBrief): Record<string, unknown> {
  return { [PROJECT_BRIEF_V2_KEY]: brief };
}

/** Compat legacy — écrit aussi v1 si domaine voyage. */
export function buildBriefMetadataPatchCompat(brief: UnifiedProjectBrief): Record<string, unknown> {
  const patch: Record<string, unknown> = buildUnifiedBriefMetadataPatch(brief);
  if (brief.domain === 'travel') {
    patch[PROJECT_BRIEF_V1_KEY] = {
      version: 1,
      destination: brief.destination ?? null,
      party: brief.stakeholders,
      flights: brief.flights ?? null,
      constraints: brief.constraints,
      departure_ymd: brief.target_ymd,
      auto_detail_requested: brief.auto_detail_requested,
    };
  }
  return patch;
}

export function shouldAutoEnrichProject(
  transcript: string,
  brief: UnifiedProjectBrief | null | undefined,
): boolean {
  if (!brief) return false;
  if (brief.auto_detail_requested) return true;
  const generic = detectGenericProjectTranscriptSignals(transcript);
  if (PROJECT_MULTI_DOMAIN_ENABLED && generic.fullDetailRequested) return true;
  if (brief.domain === 'travel') {
    return detectTravelProjectTranscriptSignals(transcript).fullDetailRequested;
  }
  return false;
}

export function isTravelBrief(brief: UnifiedProjectBrief | null | undefined): boolean {
  return brief?.domain === 'travel';
}

export function resolveProjectTargetYmd(brief: UnifiedProjectBrief | null | undefined): string | null {
  return brief?.target_ymd ?? null;
}
