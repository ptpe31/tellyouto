import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect } from 'react';

import { getFirestoreDb } from '../api/firebase';
import { getOrCreateDeviceId } from '../api/syncService';
import { fetchDeviceProfileFromFirestore } from '../api/userProfile';
import { useUserSpectrum } from '../context/UserSpectrumContext';

/**
 * Au démarrage : aligne le profil depuis Firestore ; en continu : liaison messagerie.
 */
export function ProfileSyncBootstrap() {
  const { mergeRemoteProfile, persist } = useUserSpectrum();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const remote = await fetchDeviceProfileFromFirestore();
      if (cancelled || !remote) return;
      mergeRemoteProfile(remote);
      await persist();
    })();
    return () => {
      cancelled = true;
    };
  }, [mergeRemoteProfile, persist]);

  useEffect(() => {
    const db = getFirestoreDb();
    if (!db) return;
    let unsub: (() => void) | undefined;
    void getOrCreateDeviceId().then((deviceId) => {
      const ref = doc(db, 'devices', deviceId);
      unsub = onSnapshot(ref, (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        mergeRemoteProfile({
          last_messenger_channel:
            typeof d.last_messenger_channel === 'string'
              ? d.last_messenger_channel
              : d.last_messenger_channel === null
                ? null
                : undefined,
          last_messenger_user_id:
            typeof d.last_messenger_user_id === 'string'
              ? d.last_messenger_user_id
              : d.last_messenger_user_id === null
                ? null
                : undefined,
        });
      });
    });
    return () => {
      unsub?.();
    };
  }, [mergeRemoteProfile]);

  return null;
}
