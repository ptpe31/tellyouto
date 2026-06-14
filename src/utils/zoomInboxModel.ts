/**
 * Inbox — sous-tâches zoom groupées par jalon sous le projet parent (accordéon voyage).
 * Clé stable : (rootProjectId, parentJalonUid).
 */
import type { TrankilV2TimelineItemRow } from '../api/trankilV2Db';
import { SOURCING_V1_ENABLED } from '../config/features';

export const ZOOM_ANCHOR_METADATA_KEY = 'zoom_anchor_v1';

export type ZoomAnchorV1 = {
  version: 1;
  root_project_id: string;
  jalon_uid: string;
  milestone_title: string;
};

export type ZoomJalonStats = {
  childCount: number;
  doneCount: number;
};

export type ZoomGroupKey = `${string}:${string}`;

export type ZoomInboxView = {
  childrenByJalonKey: Map<ZoomGroupKey, TrankilV2TimelineItemRow[]>;
  statsByJalonKey: Map<ZoomGroupKey, ZoomJalonStats>;
  /** Ancres NOTE/PROJECT zoom — masquées des racines Inbox (affichées sous le parent). */
  hiddenRootRowIds: Set<string>;
};

function safeParseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function buildZoomJalonKey(rootProjectId: string, parentJalonUid: string): ZoomGroupKey {
  return `${String(rootProjectId || '').trim()}:${String(parentJalonUid || '').trim()}`;
}

export function parseZoomAnchorFromMetadataJson(raw: string | null | undefined): ZoomAnchorV1 | null {
  const root = safeParseJsonObject(raw);
  if (!root) return null;
  const block = root[ZOOM_ANCHOR_METADATA_KEY];
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  const o = block as Record<string, unknown>;
  if (Number(o.version) !== 1) return null;
  const rootProjectId = String(o.root_project_id ?? '').trim();
  const jalonUid = String(o.jalon_uid ?? '').trim();
  const milestoneTitle = String(o.milestone_title ?? '').trim();
  if (!rootProjectId || !jalonUid) return null;
  return { version: 1, root_project_id: rootProjectId, jalon_uid: jalonUid, milestone_title: milestoneTitle };
}

export function buildZoomAnchorMetadataPatch(anchor: ZoomAnchorV1): Record<string, unknown> {
  return { [ZOOM_ANCHOR_METADATA_KEY]: anchor };
}

export function buildZoomAnchorTitle(projectTitle: string, milestoneTitle: string): string {
  const p = String(projectTitle ?? '').trim();
  const m = String(milestoneTitle ?? '').trim();
  if (p && m) return `${p} - ${m}`.slice(0, 200);
  return (m || p || 'Étape décomposée').slice(0, 200);
}

export function resolveRowZoomParentJalonUid(row: TrankilV2TimelineItemRow): string | null {
  const meta = safeParseJsonObject(row.metadata_json);
  const raw = meta?.zoom_parent_jalon_uid;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

export function isZoomChildTaskRow(row: TrankilV2TimelineItemRow): boolean {
  const parentId = String(row.parent_id ?? '').trim();
  const jalonUid = resolveRowZoomParentJalonUid(row);
  return row.type === 'TASK' && parentId.length > 0 && Boolean(jalonUid);
}

export function isZoomInboxAnchorRow(row: TrankilV2TimelineItemRow): boolean {
  if (parseZoomAnchorFromMetadataJson(row.metadata_json)) return true;
  const jalonUid = resolveRowZoomParentJalonUid(row);
  if (!jalonUid) return false;
  return row.type === 'PROJECT' || row.type === 'NOTE';
}

/**
 * Construit la vue zoom Inbox : TASKs par jalon + ids de cartes ancre à masquer.
 */
export function buildZoomInboxView(rows: TrankilV2TimelineItemRow[]): ZoomInboxView {
  const childrenByJalonKey = new Map<ZoomGroupKey, TrankilV2TimelineItemRow[]>();
  const statsByJalonKey = new Map<ZoomGroupKey, ZoomJalonStats>();
  const hiddenRootRowIds = new Set<string>();

  if (!SOURCING_V1_ENABLED) {
    return { childrenByJalonKey, statsByJalonKey, hiddenRootRowIds };
  }

  const groups = new Map<ZoomGroupKey, TrankilV2TimelineItemRow[]>();
  for (const row of rows) {
    if (!isZoomChildTaskRow(row)) continue;
    const rootProjectId = String(row.parent_id ?? '').trim();
    const jalonUid = resolveRowZoomParentJalonUid(row)!;
    const key = buildZoomJalonKey(rootProjectId, jalonUid);
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  for (const [key, childRows] of groups) {
    const [rootProjectId, jalonUid] = key.split(':') as [string, string];
    const doneCount = childRows.filter((r) => r.status === 'DONE').length;
    const sortedChildren = [...childRows].sort((a, b) => Number(a.created_at) - Number(b.created_at));
    childrenByJalonKey.set(key, sortedChildren);
    statsByJalonKey.set(key, { childCount: sortedChildren.length, doneCount });

    for (const row of rows) {
      const anchorMeta = parseZoomAnchorFromMetadataJson(row.metadata_json);
      if (anchorMeta?.root_project_id === rootProjectId && anchorMeta.jalon_uid === jalonUid) {
        hiddenRootRowIds.add(row.id);
        break;
      }
    }
    for (const row of rows) {
      if (hiddenRootRowIds.has(row.id)) continue;
      if (row.type !== 'PROJECT' && row.type !== 'NOTE') continue;
      const uid = resolveRowZoomParentJalonUid(row);
      if (uid !== jalonUid) continue;
      const pid = String(row.parent_id ?? '').trim();
      if (pid === rootProjectId || !pid) {
        hiddenRootRowIds.add(row.id);
        break;
      }
    }
  }

  return { childrenByJalonKey, statsByJalonKey, hiddenRootRowIds };
}

export function formatZoomStepCountSuffix(params: {
  total: number;
  t: (key: string, options?: Record<string, unknown>) => string;
}): string {
  const { total, t } = params;
  if (total <= 0) return '';
  return t('timeline.inboxProjectItemCount', {
    count: total,
    defaultValue: `${total} étapes`,
  });
}
