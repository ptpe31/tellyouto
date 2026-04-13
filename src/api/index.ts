export {
  AccountLinkingRequiredError,
  ensureAuthenticatedUser,
  isFirebaseUserAnonymous,
} from './accountLinking';
export { getFirebaseApp, getFirestoreDb } from './firebase';
export {
  withLocalDatabase,
  createIntention,
  insertIntention,
  listCompletedSessionsBetween,
  listIntentionsDescending,
  listRecentCompletedFocusSessions,
  listUnsyncedIntentions,
  markIntentionActive,
  markIntentionSynced,
  updateIntention,
} from './localDb';
export type { IntentionRow, IntentionStatus } from './localDb';
export { syncNativeRailAlarmsAfterIntentionWrite } from './intentionHardwareSync';
export {
  getOrCreateDeviceId,
  startConnectivitySyncListener,
  syncPendingIntentions,
} from './syncService';
export type {
  ConnectorId,
  ConnectorStatus,
  ParsedIncomingIntention,
  PlatformConnector,
} from './connectors';
export {
  connectorRegistry,
  getConnectorById,
  LineConnector,
} from './connectors';
