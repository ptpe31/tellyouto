export { getFirebaseApp, getFirestoreDb } from './firebase';
export {
  getLocalDatabase,
  insertIntention,
  listIntentionsDescending,
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
export type { ConnectorId, ConnectorStatus, PlatformConnector } from './connectors';
export { connectorRegistry } from './connectors';
