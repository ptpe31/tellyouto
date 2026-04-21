import { useEffect } from 'react';

import { startConnectivitySyncListener } from '../api/syncService';
import { purgeProcessedQueue } from '../services/intention/offlineAudioQueue';

import { NativeAlarmBootstrap } from './NativeAlarmBootstrap';
import { ProfileSyncBootstrap } from './ProfileSyncBootstrap';

/**
 * Démarre l’écoute réseau + synchro Firestore des intentions (arrière-plan).
 */
export function IntentionSyncBootstrap() {
  useEffect(() => {
    void purgeProcessedQueue();
    return startConnectivitySyncListener();
  }, []);
  return (
    <>
      <NativeAlarmBootstrap />
      <ProfileSyncBootstrap />
    </>
  );
}
