import type { TrankilV2TimelineItemRow } from '../api/trankilV2Db';
import { SOURCING_V1_ENABLED } from '../config/features';

export type InboxRootsView = {
  roots: TrankilV2TimelineItemRow[];
  childrenByParentId: Map<string, TrankilV2TimelineItemRow[]>;
  rootCount: number;
};

function isChildTaskRow(row: TrankilV2TimelineItemRow): boolean {
  const parentId = String(row.parent_id ?? '').trim();
  return row.type === 'TASK' && parentId.length > 0;
}

/**
 * Filtre racines Inbox côté JS — pas de sous-requête SQL NOT EXISTS.
 * Flag OFF : retourne le tableau inchangé (comportement legacy).
 */
export function buildInboxRootsView(rows: TrankilV2TimelineItemRow[]): InboxRootsView {
  if (!SOURCING_V1_ENABLED) {
    return {
      roots: rows,
      childrenByParentId: new Map(),
      rootCount: rows.length,
    };
  }

  const childrenByParentId = new Map<string, TrankilV2TimelineItemRow[]>();
  for (const row of rows) {
    if (!isChildTaskRow(row)) continue;
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
  };
}

export function isSourcedCaptureParent(row: TrankilV2TimelineItemRow): boolean {
  if (row.type !== 'PROJECT') return false;
  const sourcing = row.sourcing_v1;
  return Boolean(sourcing?.auto_parent_id && sourcing.auto_parent_id === row.id);
}
