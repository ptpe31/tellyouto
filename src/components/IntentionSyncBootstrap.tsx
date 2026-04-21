import { useEffect } from 'react';

import NetInfo from '@react-native-community/netinfo';
import { startConnectivitySyncListener } from '../api/syncService';
import {
  notifyOfflineAudioPendingAnalysis,
  purgeProcessedQueue,
} from '../services/intention/offlineAudioQueue';

import { NativeAlarmBootstrap } from './NativeAlarmBootstrap';
import { ProfileSyncBootstrap } from './ProfileSyncBootstrap';

/**
 * Démarre l’écoute réseau + synchro Firestore des intentions (arrière-plan).
 */
export function IntentionSyncBootstrap() {
  useEffect(() => {
    void purgeProcessedQueue();
    void NetInfo.fetch().then((state) => {
      if (state.isConnected === true && state.isInternetReachable === true) {
        void notifyOfflineAudioPendingAnalysis();
      }
    });
    return startConnectivitySyncListener();
  }, []);
  return (
    <>
      <NativeAlarmBootstrap />
      <ProfileSyncBootstrap />
    </>
  );
}
