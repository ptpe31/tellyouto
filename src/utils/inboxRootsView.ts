import type { TrankilV2TimelineItemRow } from '../api/trankilV2Db';
import { SOURCING_V1_ENABLED } from '../config/features';
import { isSourcingShellMetadata } from './sourcingTitle';
import { buildZoomInboxView, isZoomChildTaskRow, type ZoomInboxView } from './zoomInboxModel';

export type InboxRootsView = {
  roots: TrankilV2TimelineItemRow[];
  childrenByParentId: Map<string, TrankilV2TimelineItemRow[]>;
  rootCount: number;
  zoomView: ZoomInboxView;
};

function isChildTaskRow(row: TrankilV2TimelineItemRow): boolean {
  const parentId = String(row.parent_id ?? '').trim();
  return row.type === 'TASK' && parentId.length > 0;
}

/**
 * Filtre racines Inbox côté JS — pas de sous-requête SQL NOT EXISTS.
 * Flag OFF : retourne le tableau inchangé (comportement legacy).
 * Les TASK zoom (parent_id + zoom_parent_jalon_uid) sont groupées via zoomView, pas sourcing.
 */
export function buildInboxRootsView(rows: TrankilV2TimelineItemRow[]): InboxRootsView {
  const zoomView = buildZoomInboxView(rows);

  if (!SOURCING_V1_ENABLED) {
    return {
      roots: rows,
      childrenByParentId: new Map(),
      rootCount: rows.length,
      zoomView,
    };
  }

  const childrenByParentId = new Map<string, TrankilV2TimelineItemRow[]>();
  for (const row of rows) {
    if (!isChildTaskRow(row)) continue;
    if (isZoomChildTaskRow(row)) continue;
    const pid = String(row.parent_id ?? '').trim();
    const bucket = childrenByParentId.get(pid) ?? [];
    bucket.push(row);
    childrenByParentId.set(pid, bucket);
  }

  const roots = rows.filter((row) => !isChildTaskRow(row));
  return {
    roots,
    childrenByParentId,
    rootCount: roots.length,
    zoomView,
  };
}

export function isSourcedCaptureParent(row: TrankilV2TimelineItemRow): boolean {
  const sourcing = row.sourcing_v1;
  if (!sourcing?.auto_parent_id || sourcing.auto_parent_id !== row.id) return false;
  if (row.type === 'NOTE' && isSourcingShellMetadata(row.metadata_json)) return true;
  return row.type === 'PROJECT';
}
