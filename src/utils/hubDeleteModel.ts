import type { TrankilV2TimelineItemRow } from '../api/trankilV2Db';
import { isSourcedCaptureParent } from './inboxRootsView';
import {
  buildZoomJalonKey,
  parseZoomAnchorFromMetadataJson,
  resolveRowZoomParentJalonUid,
  type ZoomInboxView,
} from './zoomInboxModel';

export type HubSelectionVisual = 'none' | 'partial' | 'all';

export type HubDeleteResolveSummary = {
  intentionIds: string[];
  rootCount: number;
  sourcingChildCount: number;
  zoomTaskCount: number;
  zoomAnchorCount: number;
  habitCount: number;
};

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
}

/** IDs des enfants sourcing d'un parent. */
export function resolveSourcingChildIds(
  parentId: string,
  childrenByParentId?: Map<string, TrankilV2TimelineItemRow[]>,
): string[] {
  if (!childrenByParentId) return [];
  return (childrenByParentId.get(parentId) ?? []).map((r) => r.id);
}

/** IDs des sous-tâches zoom rattachées à un projet. */
export function resolveZoomTaskIdsForProject(projectId: string, zoomView?: ZoomInboxView): string[] {
  if (!zoomView) return [];
  const ids: string[] = [];
  for (const [key, rows] of zoomView.childrenByJalonKey) {
    const [rootProjectId] = key.split(':') as [string, string];
    if (rootProjectId === projectId) ids.push(...rows.map((r) => r.id));
  }
  return uniqueIds(ids);
}

/** Ancres zoom orphelines si toutes les sous-tâches d'un jalon sont supprimées. */
export function resolveOrphanZoomAnchorIds(
  deleteIds: Set<string>,
  poolRows: TrankilV2TimelineItemRow[],
  zoomView?: ZoomInboxView,
): string[] {
  if (!zoomView) return [];
  const anchorIds: string[] = [];

  for (const [key, childRows] of zoomView.childrenByJalonKey) {
    if (childRows.length === 0) continue;
    const allChildrenDeleted = childRows.every((r) => deleteIds.has(r.id));
    if (!allChildrenDeleted) continue;

    const [rootProjectId, jalonUid] = key.split(':') as [string, string];
    for (const row of poolRows) {
      const anchorMeta = parseZoomAnchorFromMetadataJson(row.metadata_json);
      if (anchorMeta?.root_project_id === rootProjectId && anchorMeta.jalon_uid === jalonUid) {
        anchorIds.push(row.id);
        break;
      }
    }
    for (const row of poolRows) {
      if (anchorIds.includes(row.id)) break;
      if (row.type !== 'PROJECT' && row.type !== 'NOTE') continue;
      const uid = resolveRowZoomParentJalonUid(row);
      if (uid !== jalonUid) continue;
      const pid = String(row.parent_id ?? '').trim();
      if (pid === rootProjectId || !pid) {
        anchorIds.push(row.id);
        break;
      }
    }
  }

  return uniqueIds(anchorIds);
}

/** Tous les ids sélectionnables dans le pool hub (racines + enfants sourcing + zoom). */
export function collectAllSelectableIds(params: {
  roots: TrankilV2TimelineItemRow[];
  childrenByParentId?: Map<string, TrankilV2TimelineItemRow[]>;
  zoomView?: ZoomInboxView;
}): string[] {
  const { roots, childrenByParentId, zoomView } = params;
  const ids = roots.map((r) => r.id);
  if (childrenByParentId) {
    for (const parent of roots) {
      if (!isSourcedCaptureParent(parent)) continue;
      ids.push(...resolveSourcingChildIds(parent.id, childrenByParentId));
    }
  }
  if (zoomView) {
    for (const parent of roots) {
      if (parent.type !== 'PROJECT') continue;
      ids.push(...resolveZoomTaskIdsForProject(parent.id, zoomView));
    }
  }
  return uniqueIds(ids);
}

export function resolveParentSelectionVisual(
  parentId: string,
  childIds: string[],
  selectedIds: Set<string>,
): HubSelectionVisual {
  if (childIds.length === 0) {
    return selectedIds.has(parentId) ? 'all' : 'none';
  }
  const selectedChildCount = childIds.filter((id) => selectedIds.has(id)).length;
  const parentSelected = selectedIds.has(parentId);
  if (parentSelected && selectedChildCount === childIds.length) return 'all';
  if (parentSelected || selectedChildCount > 0) return 'partial';
  return 'none';
}

/** Toggle parent sourcing / projet : sélection ou désélection en cascade des enfants visibles. */
export function toggleHubParentSelection(
  parentId: string,
  childIds: string[],
  selectedIds: Set<string>,
): Set<string> {
  const next = new Set(selectedIds);
  const visual = resolveParentSelectionVisual(parentId, childIds, selectedIds);
  if (visual === 'all') {
    next.delete(parentId);
    for (const id of childIds) next.delete(id);
    return next;
  }
  next.add(parentId);
  for (const id of childIds) next.add(id);
  return next;
}

/** Toggle enfant sourcing ou sous-tâche zoom. */
export function toggleHubChildSelection(
  parentId: string,
  childId: string,
  allChildIds: string[],
  selectedIds: Set<string>,
): Set<string> {
  const next = new Set(selectedIds);
  if (next.has(childId)) {
    next.delete(childId);
    if (allChildIds.some((id) => id !== childId && next.has(id))) {
      next.add(parentId);
    } else {
      next.delete(parentId);
    }
    return next;
  }
  next.add(childId);
  next.add(parentId);
  if (allChildIds.every((id) => next.has(id))) {
    next.add(parentId);
  }
  return next;
}

/** Toggle racine simple (sans enfants sourcing/zoom à gérer en UI). */
export function toggleHubRowSelection(rowId: string, selectedIds: Set<string>): Set<string> {
  const next = new Set(selectedIds);
  if (next.has(rowId)) next.delete(rowId);
  else next.add(rowId);
  return next;
}

/**
 * Résout les ids SQLite à supprimer : sélection explicite + cascade parent sourcing/zoom + ancres orphelines.
 */
export function resolveHubDeleteIntentionIds(params: {
  selectedIds: Set<string>;
  roots: TrankilV2TimelineItemRow[];
  poolRows: TrankilV2TimelineItemRow[];
  childrenByParentId?: Map<string, TrankilV2TimelineItemRow[]>;
  zoomView?: ZoomInboxView;
}): HubDeleteResolveSummary {
  const { selectedIds, roots, poolRows, childrenByParentId, zoomView } = params;
  const rootIdSet = new Set(roots.map((r) => r.id));
  const resolved = new Set<string>();

  for (const id of selectedIds) {
    resolved.add(id);
  }

  for (const root of roots) {
    if (!selectedIds.has(root.id)) continue;
    if (isSourcedCaptureParent(root)) {
      for (const childId of resolveSourcingChildIds(root.id, childrenByParentId)) {
        resolved.add(childId);
      }
    }
    if (root.type === 'PROJECT') {
      for (const taskId of resolveZoomTaskIdsForProject(root.id, zoomView)) {
        resolved.add(taskId);
      }
    }
  }

  for (const anchorId of resolveOrphanZoomAnchorIds(resolved, poolRows, zoomView)) {
    resolved.add(anchorId);
  }

  const intentionIds = uniqueIds([...resolved]);
  const rootCount = intentionIds.filter((id) => rootIdSet.has(id)).length;
  const sourcingChildCount = intentionIds.filter((id) => {
    if (rootIdSet.has(id)) return false;
    if (!childrenByParentId) return false;
    for (const children of childrenByParentId.values()) {
      if (children.some((r) => r.id === id)) return true;
    }
    return false;
  }).length;
  const zoomTaskCount = intentionIds.filter((id) => {
    if (!zoomView) return false;
    for (const rows of zoomView.childrenByJalonKey.values()) {
      if (rows.some((r) => r.id === id)) return true;
    }
    return false;
  }).length;
  const zoomAnchorCount = intentionIds.filter((id) => zoomView?.hiddenRootRowIds.has(id)).length;
  const habitCount = intentionIds.filter((id) => {
    const row = poolRows.find((r) => r.id === id);
    return row?.type === 'HABIT';
  }).length;

  return {
    intentionIds,
    rootCount,
    sourcingChildCount,
    zoomTaskCount,
    zoomAnchorCount,
    habitCount,
  };
}

/** Auto-expand : parents sourcing + projets voyage avec étapes. */
export function collectAutoExpandParentIds(params: {
  roots: TrankilV2TimelineItemRow[];
  childrenByParentId?: Map<string, TrankilV2TimelineItemRow[]>;
  hasTravelSteps: (root: TrankilV2TimelineItemRow) => boolean;
}): Set<string> {
  const ids = new Set<string>();
  for (const root of params.roots) {
    if (isSourcedCaptureParent(root)) {
      const childCount = resolveSourcingChildIds(root.id, params.childrenByParentId).length;
      if (childCount > 0) ids.add(root.id);
    }
    if (params.hasTravelSteps(root)) ids.add(root.id);
  }
  return ids;
}

/** Auto-expand jalons zoom sous projets voyage. */
export function collectAutoExpandZoomJalonKeys(params: {
  roots: TrankilV2TimelineItemRow[];
  zoomView?: ZoomInboxView;
}): Set<string> {
  const keys = new Set<string>();
  if (!params.zoomView) return keys;
  for (const root of params.roots) {
    if (root.type !== 'PROJECT') continue;
    for (const key of params.zoomView.childrenByJalonKey.keys()) {
      const [projectId] = key.split(':') as [string, string];
      if (projectId === root.id) keys.add(key);
    }
  }
  return keys;
}

export function buildZoomJalonKeyForMilestone(projectId: string, milestoneUid: string): string {
  return buildZoomJalonKey(projectId, milestoneUid);
}
