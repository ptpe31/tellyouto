export {
  AccountLinkingRequiredError,
  ensureAuthenticatedUser,
  isFirebaseUserAnonymous,
} from './accountLinking';
export { getFirebaseApp, getFirestoreDb } from './firebase';
export {
  withLocalDatabase,
  insertIntention,
  listCompletedSessionsBetween,
  listIntentionsDescending,
  listRecentCompletedFocusSessions,
  listUnsyncedIntentions,
  markIntentionActive,
  markIntentionSynced,
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
  WhatsAppConnector,
} from './connectors';
