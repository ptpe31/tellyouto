export {
  AccountLinkingRequiredError,
  ensureAuthenticatedUser,
  isFirebaseUserAnonymous,
} from './accountLinking';
export { getFirebaseApp, getFirestoreDb } from './firebase';
export {
  addRemainingIntents,
  applyAvailabilityReward,
  addFlowerBoosts,
  applyGrowthDecayIfNeeded,
  deleteTrankilV2IntentionById,
  consumeTrankilV2IntentCredit,
  getEveningDoneSummaryToday,
  grantViralBonus,
  getHerbierCount,
  getLocalEcoScore,
  getTrankilV2UnorganizedCount,
  getTrankilV2UserStats,
  growthPointsForType,
  harvestCurrentFlower,
  initTrankilV2Schema,
  incrementBehaviorScores,
  incrementAdVideosWatched,
  insertTrankilV2Intention,
  listTrankilV2OrganizedIntentions,
  listTrankilV2Intentions,
  listTrankilV2UnorganizedIntentions,
  listHerbierEntries,
  markTrankilV2IntentionDone,
  pickAvailabilityTask,
  setMorningFocusSelection,
  setAdState,
  recordLocalAffinityEvent,
  saveEmergencyLog,
  setDebugSpawnFlies,
  setNotificationsQuietUntil,
  setEveningRitualDateKey,
  updateGrowth,
  updateTrankilV2IntentionOrganization,
  updateTrankilV2IntentionQuick,
} from './trankilV2Db';
export type {
  HerbierRow,
  TrankilIntentStatus,
  TrankilIntentType,
  TrankilV2IntentionRow,
  TrankilV2UserStatsRow,
} from './trankilV2Db';
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
