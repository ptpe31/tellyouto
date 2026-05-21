export const PROJECT_MILESTONES_METADATA_KEY = 'project_milestones_v1';

export type ProjectDurationUnit = 'hours' | 'days' | 'weeks';

export type ProjectMilestone = {
  uid: string;
  title: string;
  estimated_duration: number;
  unit: ProjectDurationUnit;
  expert_persona?: string;
  checked?: boolean;
  pivot_date?: string | null;
  note?: string | null;
};

export type ProjectMilestonesPayload = {
  title: string;
  milestones: ProjectMilestone[];
};

function newUid(prefix: string, idx: number): string {
  const rnd = Math.random().toString(16).slice(2, 10);
  return `${prefix}_${Date.now()}_${idx}_${rnd}`;
}

export function ensureProjectMilestoneUids(payload: ProjectMilestonesPayload): ProjectMilestonesPayload {
  return {
    ...payload,
    milestones: payload.milestones.map((m, idx) => ({
      ...m,
      uid: String((m as any)?.uid ?? '').trim() || newUid('M', idx),
      expert_persona: String((m as any)?.expert_persona ?? '').trim() || 'Assistant Personnel',
    })),
  };
}

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
        const uid = String(r.uid ?? '').trim();
        const t = String(r.title ?? '').trim();
        const n = Number(r.estimated_duration);
        const unit = String(r.unit ?? '').trim() as ProjectDurationUnit;
        const expert_persona = String(r.expert_persona ?? '').trim();
        const checked = Boolean(r.checked);
        const pivot_date = typeof r.pivot_date === 'string' && r.pivot_date.trim() ? r.pivot_date.trim() : null;
        const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim() : null;
        if (!t) return null;
        if (!Number.isFinite(n) || n <= 0) return null;
        if (unit !== 'hours' && unit !== 'days' && unit !== 'weeks') return null;
        return {
          uid: uid || '',
          title: t.slice(0, 200),
          estimated_duration: n,
          unit,
          expert_persona: expert_persona || 'Assistant Personnel',
          checked,
          pivot_date: pivot_date && /^\d{4}-\d{2}-\d{2}$/.test(pivot_date) ? pivot_date : null,
          note,
        };
      })
      .filter(Boolean) as ProjectMilestone[];
    if (!milestones.length) return null;
    return ensureProjectMilestoneUids({ title: title.slice(0, 200), milestones });
  } catch {
    return null;
  }
}

export function parseGeminiProjectMilestonesJson(raw: string): ProjectMilestonesPayload {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const startIdx = stripped.indexOf('{');
  const endIdx = stripped.lastIndexOf('}');
  let cleanText = stripped;
  if (startIdx >= 0 && endIdx > startIdx) {
    cleanText = stripped.slice(startIdx, endIdx + 1);
  }
  const obj = JSON.parse(cleanText) as Record<string, unknown>;
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
    const expert_persona = String(r.expert_persona ?? '').trim();
    return {
      uid: '',
      title: t,
      estimated_duration: n,
      unit: unit as ProjectDurationUnit,
      expert_persona: expert_persona || 'Assistant Personnel',
      checked: false,
      pivot_date: null,
      note: null,
    };
  });
  return ensureProjectMilestoneUids({ title, milestones });
}

export function buildProjectMilestonesMetadataPatch(payload: ProjectMilestonesPayload): Record<string, unknown> {
  return { [PROJECT_MILESTONES_METADATA_KEY]: payload };
}

function dateNoonFromYmd(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split('-').map((x) => Number(x));
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function formatYmdFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function durationMs(unit: ProjectDurationUnit, value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (unit === 'hours') return n * 60 * 60 * 1000;
  if (unit === 'weeks') return n * 7 * 24 * 60 * 60 * 1000;
  return n * 24 * 60 * 60 * 1000;
}

export function getProjectStartDateFromMetadataJson(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const root = JSON.parse(raw) as Record<string, unknown>;
    const p = root.project;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    const ymd = String((p as Record<string, unknown>).start_date ?? '').trim();
    return ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
  } catch {
    return null;
  }
}

/** Recalcule les `pivot_date` des jalons à partir d’un `start_date` (même logique que la sheet projet). */
export function replanProjectMilestonesFromStartDate(
  payload: ProjectMilestonesPayload,
  startYmd: string,
): ProjectMilestonesPayload {
  const startMs = dateNoonFromYmd(startYmd)?.getTime();
  if (!startMs) return payload;
  const ms = payload.milestones;
  const pivotMsByUid = new Map<string, number>();
  for (const m of ms) {
    const ymd = m.pivot_date;
    const dt = ymd ? dateNoonFromYmd(ymd) : null;
    if (dt) pivotMsByUid.set(m.uid, dt.getTime());
  }

  const endDates: Array<number | null> = ms.map(() => null);
  let cur = startMs;
  for (let i = 0; i < ms.length; i++) {
    cur += durationMs(ms[i].unit, ms[i].estimated_duration);
    const pivot = pivotMsByUid.get(ms[i].uid);
    if (pivot) cur = pivot;
    endDates[i] = cur;
  }

  for (let i = 0; i < ms.length; i++) {
    const pivot = pivotMsByUid.get(ms[i].uid);
    if (!pivot) continue;
    let curPivot = pivot;
    endDates[i] = pivot;
    for (let j = i - 1; j >= 0; j--) {
      const prevPivot = pivotMsByUid.get(ms[j].uid);
      if (prevPivot) {
        curPivot = prevPivot;
        endDates[j] = curPivot;
        continue;
      }
      curPivot -= durationMs(ms[j + 1].unit, ms[j + 1].estimated_duration);
      endDates[j] = curPivot;
    }
  }

  let curEnd = endDates.find((x): x is number => x !== null) ?? null;
  if (curEnd !== null) {
    for (let i = 0; i < ms.length; i++) {
      const pivot = pivotMsByUid.get(ms[i].uid);
      if (pivot) {
        curEnd = pivot;
        endDates[i] = pivot;
        continue;
      }
      if (endDates[i] !== null) {
        curEnd = endDates[i] as number;
        continue;
      }
      if (curEnd === null) break;
      curEnd += durationMs(ms[i].unit, ms[i].estimated_duration);
      endDates[i] = curEnd;
    }
  }

  const milestones = ms.map((m, i) => {
    const dt = endDates[i] !== null ? new Date(Number(endDates[i])) : null;
    const pivotYmd = dt ? formatYmdFromDate(dt) : m.pivot_date ?? null;
    return { ...m, pivot_date: pivotYmd };
  });

  return { ...payload, milestones };
}
