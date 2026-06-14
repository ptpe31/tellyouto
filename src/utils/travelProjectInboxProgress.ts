import type { TrankilV2TimelineItemRow } from '../api/trankilV2Db';
import type { ProjectMilestone } from '../services/projectMilestonesModel';
import { buildZoomJalonKey, type ZoomInboxView } from './zoomInboxModel';

export type TravelMilestoneInboxState = {
  uid: string;
  hasDecompose: boolean;
  zoomTotal: number;
  zoomDone: number;
  allZoomDone: boolean;
  milestoneChecked: boolean;
  unitTotal: number;
  unitDone: number;
  /** Case jalon visible (simple ou décomposé N/N). */
  showMilestoneCheckbox: boolean;
};

export type TravelProjectInboxProgress = {
  totalUnits: number;
  doneUnits: number;
  byUid: Map<string, TravelMilestoneInboxState>;
};

export function buildTravelProjectInboxProgress(params: {
  milestones: ProjectMilestone[];
  projectId: string;
  zoomView?: ZoomInboxView;
  resolveTaskRow?: (row: TrankilV2TimelineItemRow) => TrankilV2TimelineItemRow;
}): TravelProjectInboxProgress {
  const { milestones, projectId, zoomView, resolveTaskRow } = params;
  const resolve = resolveTaskRow ?? ((r) => r);
  const byUid = new Map<string, TravelMilestoneInboxState>();
  let totalUnits = 0;
  let doneUnits = 0;

  for (const milestone of milestones) {
    const uid = String(milestone.uid ?? '').trim();
    if (!uid) continue;
    const jalonKey = buildZoomJalonKey(projectId, uid);
    const zoomTasks = zoomView?.childrenByJalonKey.get(jalonKey) ?? [];
    const resolved = zoomTasks.map((t) => resolve(t));
    const zoomTotal = resolved.length;
    const zoomDone = resolved.filter((t) => t.status === 'DONE').length;
    const hasDecompose = zoomTotal > 0;
    const milestoneChecked = Boolean(milestone.checked);
    const allZoomDone = hasDecompose && zoomDone >= zoomTotal;
    const unitTotal = hasDecompose ? zoomTotal : 1;
    const unitDone = hasDecompose ? zoomDone : milestoneChecked ? 1 : 0;
    const showMilestoneCheckbox = !hasDecompose || allZoomDone;

    totalUnits += unitTotal;
    doneUnits += unitDone;

    byUid.set(uid, {
      uid,
      hasDecompose,
      zoomTotal,
      zoomDone,
      allZoomDone,
      milestoneChecked,
      unitTotal,
      unitDone,
      showMilestoneCheckbox,
    });
  }

  return { totalUnits, doneUnits, byUid };
}
