/**
 * Inbox — regroupement des sous-tâches zoom (jalon décomposé) sous une ancre Option A.
 * Clé stable : (rootProjectId, parentJalonUid) — pas le parent_id du sous-projet.
 */
import type { TrankilV2TimelineItemRow } from '../api/trankilV2Db';
import { parseProjectMilestonesPayloadFromMetadataJson } from '../services/projectMilestonesModel';
import { SOURCING_V1_ENABLED } from '../config/features';

export const ZOOM_ANCHOR_METADATA_KEY = 'zoom_anchor_v1';

export type ZoomAnchorV1 = {
  version: 1;
  root_project_id: string;
  jalon_uid: string;
  milestone_title: string;
};

export type ZoomInboxAnchor = {
  anchorRowId: string;
  rootProjectId: string;
  parentJalonUid: string;
  childCount: number;
  doneCount: number;
  milestoneTitle: string;
};

export type ZoomInboxView = {
  anchorsByRowId: Map<string, ZoomInboxAnchor>;
  childrenByAnchorId: Map<string, TrankilV2TimelineItemRow[]>;
};

export type ZoomGroupKey = `${string}:${string}`;

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

export function isZoomInboxAnchorRow(
  row: TrankilV2TimelineItemRow,
  anchorsByRowId?: Map<string, ZoomInboxAnchor>,
): boolean {
  if (anchorsByRowId?.has(row.id)) return true;
  const anchorMeta = parseZoomAnchorFromMetadataJson(row.metadata_json);
  if (anchorMeta) return true;
  const jalonUid = resolveRowZoomParentJalonUid(row);
  if (!jalonUid) return false;
  return row.type === 'PROJECT' || row.type === 'NOTE';
}

function zoomGroupKey(rootProjectId: string, jalonUid: string): ZoomGroupKey {
  return `${rootProjectId}:${jalonUid}`;
}

function resolveMilestoneTitle(rootProjectId: string, jalonUid: string, rows: TrankilV2TimelineItemRow[]): string {
  for (const row of rows) {
    if (row.id !== rootProjectId) continue;
    const payload = parseProjectMilestonesPayloadFromMetadataJson(row.metadata_json);
    const hit = payload?.milestones.find((m) => m.uid === jalonUid);
    if (hit?.title) return String(hit.title).trim();
  }
  for (const row of rows) {
    const anchorMeta = parseZoomAnchorFromMetadataJson(row.metadata_json);
    if (anchorMeta?.jalon_uid === jalonUid && anchorMeta.root_project_id === rootProjectId && anchorMeta.milestone_title) {
      return anchorMeta.milestone_title;
    }
    const uid = resolveRowZoomParentJalonUid(row);
    if (uid !== jalonUid) continue;
    if (row.type === 'PROJECT' || row.type === 'NOTE') {
      const title = String(row.display_title || '').trim();
      if (title) return title;
    }
  }
  return '';
}

/**
 * Construit la vue accordéon zoom depuis les lignes Inbox du jour (sync, sans SQL).
 */
export function buildZoomInboxView(rows: TrankilV2TimelineItemRow[]): ZoomInboxView {
  const anchorsByRowId = new Map<string, ZoomInboxAnchor>();
  const childrenByAnchorId = new Map<string, TrankilV2TimelineItemRow[]>();

  if (!SOURCING_V1_ENABLED) {
    return { anchorsByRowId, childrenByAnchorId };
  }

  const groups = new Map<ZoomGroupKey, TrankilV2TimelineItemRow[]>();
  for (const row of rows) {
    if (!isZoomChildTaskRow(row)) continue;
    const rootProjectId = String(row.parent_id ?? '').trim();
    const jalonUid = resolveRowZoomParentJalonUid(row)!;
    const key = zoomGroupKey(rootProjectId, jalonUid);
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  if (groups.size === 0) {
    return { anchorsByRowId, childrenByAnchorId };
  }

  for (const [key, childRows] of groups) {
    const [rootProjectId, jalonUid] = key.split(':') as [string, string];
    const doneCount = childRows.filter((r) => r.status === 'DONE').length;
    const milestoneTitle = resolveMilestoneTitle(rootProjectId, jalonUid, rows);

    let anchorRow: TrankilV2TimelineItemRow | null = null;

    for (const row of rows) {
      const anchorMeta = parseZoomAnchorFromMetadataJson(row.metadata_json);
      if (anchorMeta?.root_project_id === rootProjectId && anchorMeta.jalon_uid === jalonUid) {
        anchorRow = row;
        break;
      }
    }

    if (!anchorRow) {
      for (const row of rows) {
        if (row.type !== 'PROJECT' && row.type !== 'NOTE') continue;
        const uid = resolveRowZoomParentJalonUid(row);
        if (uid !== jalonUid) continue;
        const pid = String(row.parent_id ?? '').trim();
        if (pid === rootProjectId || pid === '') {
          anchorRow = row;
          break;
        }
      }
    }

    if (!anchorRow) continue;

    const sortedChildren = [...childRows].sort((a, b) => Number(a.created_at) - Number(b.created_at));
    childrenByAnchorId.set(anchorRow.id, sortedChildren);
    anchorsByRowId.set(anchorRow.id, {
      anchorRowId: anchorRow.id,
      rootProjectId,
      parentJalonUid: jalonUid,
      childCount: sortedChildren.length,
      doneCount,
      milestoneTitle: milestoneTitle || String(anchorRow.display_title || '').trim(),
    });
  }

  return { anchorsByRowId, childrenByAnchorId };
}

export function formatZoomDecomposedInboxLine2(params: {
  done: number;
  total: number;
  locale: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  omitProgressInLine2?: boolean;
}): string {
  const { done, total, t, omitProgressInLine2 } = params;
  const parts: string[] = [
    t('timeline.inboxProjectLabel', { defaultValue: 'Projet' }),
    t('timeline.zoomDecomposeLabel', { defaultValue: 'décomposé' }),
  ];
  if (!omitProgressInLine2 && total > 0) {
    parts.push(
      t('timeline.zoomDecomposeProgress', {
        done,
        total,
        defaultValue: `${done}/${total} fait`,
      }),
    );
  }
  return parts.join(' · ');
}
