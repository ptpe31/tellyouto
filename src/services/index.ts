export { pollVigilanceSignals } from './vigilanceAgent';
export type { VigilanceSignal } from './vigilanceAgent';
export {
  ensureNotificationPermissions,
  notifyExternalIntentionCaptured,
} from './notifications';
export { runStartupHealthCheck } from './healthCheck';
export type { HealthCheckResult, HealthWarningKey } from './healthCheck';
export { BACKGROUND_SYNC_TASK } from './backgroundTasks';
export {
  buildTimelineSlots,
  computeIntentionPriority,
  estimateDurationMinutes,
  generateEncouragement,
  orderIntentionsBySpectrum,
} from './agentLogic';
export type { TimelineSlot } from './agentLogic';
