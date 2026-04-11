export { getFirebaseApp, getFirestoreDb } from './firebase';
export {
  getLocalDatabase,
  insertIntention,
  listCompletedSessionsBetween,
  listIntentionsDescending,
  listRecentCompletedFocusSessions,
  listUnsyncedIntentions,
  markIntentionActive,
  markIntentionSynced,
} from './localDb';
export type { IntentionRow, IntentionStatus } from './localDb';
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
