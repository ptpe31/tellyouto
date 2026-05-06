export const PROJECT_MILESTONES_METADATA_KEY = 'project_milestones_v1';

export type ProjectDurationUnit = 'hours' | 'days' | 'weeks';

export type ProjectMilestone = {
  title: string;
  estimated_duration: number;
  unit: ProjectDurationUnit;
};

export type ProjectMilestonesPayload = {
  title: string;
  milestones: ProjectMilestone[];
};

export function parseProjectMilestonesPayloadFromMetadataJson(raw: string | null | undefined): ProjectMilestonesPayload | null {
  if (!raw) return null;
  try {
    const root = JSON.parse(raw) as Record<string, unknown>;
    const block = root[PROJECT_MILESTONES_METADATA_KEY];
    if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
    const o = block as Record<string, unknown>;
    const title = String(o.title ?? '').trim();
    if (!title) return null;
    const ms = o.milestones;
    if (!Array.isArray(ms) || ms.length === 0) return null;
    const milestones: ProjectMilestone[] = ms
      .map((m) => {
        if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
        const r = m as Record<string, unknown>;
        const t = String(r.title ?? '').trim();
        const n = Number(r.estimated_duration);
        const unit = String(r.unit ?? '').trim() as ProjectDurationUnit;
        if (!t) return null;
        if (!Number.isFinite(n) || n <= 0) return null;
        if (unit !== 'hours' && unit !== 'days' && unit !== 'weeks') return null;
        return { title: t.slice(0, 200), estimated_duration: n, unit };
      })
      .filter(Boolean) as ProjectMilestone[];
    if (!milestones.length) return null;
    return { title: title.slice(0, 200), milestones };
  } catch {
    return null;
  }
}

export function parseGeminiProjectMilestonesJson(raw: string): ProjectMilestonesPayload {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const obj = JSON.parse(s) as Record<string, unknown>;
  const title = String(obj.title ?? '').trim();
  if (!title) throw new Error('PROJECT_JSON_MISSING_TITLE');
  const ms = obj.milestones;
  if (!Array.isArray(ms) || ms.length === 0) throw new Error('PROJECT_JSON_MISSING_MILESTONES');
  const milestones: ProjectMilestone[] = ms.map((m) => {
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('PROJECT_JSON_BAD_MILESTONE');
    const r = m as Record<string, unknown>;
    const t = String(r.title ?? '').trim();
    if (!t) throw new Error('PROJECT_JSON_BAD_MILESTONE_TITLE');
    const n = Number(r.estimated_duration);
    if (!Number.isFinite(n) || n <= 0) throw new Error('PROJECT_JSON_BAD_DURATION');
    const unit = String(r.unit ?? '').trim();
    if (unit !== 'hours' && unit !== 'days' && unit !== 'weeks') throw new Error('PROJECT_JSON_BAD_UNIT');
    return { title: t, estimated_duration: n, unit: unit as ProjectDurationUnit };
  });
  return { title, milestones };
}

export function buildProjectMilestonesMetadataPatch(payload: ProjectMilestonesPayload): Record<string, unknown> {
  return { [PROJECT_MILESTONES_METADATA_KEY]: payload };
}

