import { useEffect } from 'react';

import { startConnectivitySyncListener } from '../api/syncService';

/**
 * Démarre l’écoute réseau + synchro Firestore des intentions (arrière-plan).
 */
export function IntentionSyncBootstrap() {
  useEffect(() => {
    return startConnectivitySyncListener();
  }, []);
  return null;
}
