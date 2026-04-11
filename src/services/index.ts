export { pollVigilanceSignals } from './vigilanceAgent';
export type { VigilanceSignal } from './vigilanceAgent';
export {
  ensureNotificationPermissions,
} from './notifications';
export { BACKGROUND_SYNC_TASK } from './backgroundTasks';
export {
  buildTimelineSlots,
  computeIntentionPriority,
  estimateDurationMinutes,
  generateEncouragement,
  orderIntentionsBySpectrum,
} from './agentLogic';
export type { TimelineSlot } from './agentLogic';
