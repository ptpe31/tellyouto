import { useEffect } from 'react';

import { startConnectivitySyncListener } from '../api/syncService';

import { NativeAlarmBootstrap } from './NativeAlarmBootstrap';
import { ProfileSyncBootstrap } from './ProfileSyncBootstrap';
import { RailInboxBootstrap } from './RailInboxBootstrap';

/**
 * Démarre l’écoute réseau + synchro Firestore des intentions (arrière-plan).
 */
export function IntentionSyncBootstrap() {
  useEffect(() => {
    return startConnectivitySyncListener();
  }, []);
  return (
    <>
      <NativeAlarmBootstrap />
      <ProfileSyncBootstrap />
      <RailInboxBootstrap />
    </>
  );
}
