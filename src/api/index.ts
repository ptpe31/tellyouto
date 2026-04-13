export {
  AccountLinkingRequiredError,
  ensureAuthenticatedUser,
  isFirebaseUserAnonymous,
} from './accountLinking';
export { getFirebaseApp, getFirestoreDb } from './firebase';
export {
  withLocalDatabase,
  applyMelimeloGrouping,
  createIntention,
  insertIntention,
  listCompletedSessionsBetween,
  listIntentionsDescending,
  listRecentCompletedFocusSessions,
  listUnclusteredPendingIntentions,
  listUnsyncedIntentions,
  markIntentionActive,
  markIntentionSynced,
  updateIntention,
} from './localDb';
export type {
  IntentionRow,
  IntentionStatus,
  UserStatusRow,
} from './localDb';
export { getUserStatus, updateUserStatus } from './localDb';
export { syncNativeRailAlarmsAfterIntentionWrite } from './intentionHardwareSync';
export {
  getOrCreateDeviceId,
  startConnectivitySyncListener,
  syncPendingIntentions,
} from './syncService';
