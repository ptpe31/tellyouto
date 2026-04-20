/**
 * Ré-exports des services **runtime** (santé, notifications, logique agent) pour les entrées
 * qui ne souhaitent pas importer chaque fichier en profondeur.
 */
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
  inferIsLateNightIntent,
  orderIntentionsBySpectrum,
} from './agentLogic';
export type { ComputePriorityOptions, TimelineSlot } from './agentLogic';
export { askGeminiExpert, atomizeProject } from './GeminiExpert';
export {
  getOptimalReward,
  onLocalAiValidated,
  recordBonusReaction,
  resetLocalStreakOnExpert,
  triggerOptimalBonus,
} from './BonusEngine';
export {
  applyAdReward,
  canRunAdSession,
  getSuggestedAdRewardType,
  showRewardedAd,
} from './AdManager';
export {
  calculateNextJump,
  computeDurationTargetSec,
  evaluateTrafficStatus,
  executeTrafficScan,
  executeWatch4MeInternalScan,
  SURVEILLANCE_NOTIF_MIN_INTERVAL_MS,
} from './traffic/TrafficEngine';
export type {
  ExecuteTrafficScanInput,
  ExecuteTrafficScanOutput,
  EvaluateTrafficStatusInput,
  TrafficEvaluation,
  TrafficScanEvent,
  TrafficScanSession,
  TrafficStatus,
} from './traffic/TrafficEngine';
