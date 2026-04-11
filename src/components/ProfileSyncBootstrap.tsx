import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect } from 'react';

import {
  ensureFirebaseAnonymousAuth,
  getFirebaseAuth,
  getFirestoreDb,
} from '../api/firebase';
import { getOrCreateDeviceId } from '../api/syncService';
import { fetchMergedRemoteProfile } from '../api/userProfile';
import { useUserSpectrum } from '../context/UserSpectrumContext';

/**
 * Au démarrage : aligne le profil depuis Firestore ; en continu : liaison messagerie.
 */
export function ProfileSyncBootstrap() {
  const { mergeRemoteProfile, persist } = useUserSpectrum();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await ensureFirebaseAnonymousAuth();
      const remote = await fetchMergedRemoteProfile();
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
    void (async () => {
      await ensureFirebaseAnonymousAuth();
      const deviceId = await getOrCreateDeviceId();
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
    })();
    return () => {
      unsub?.();
    };
  }, [mergeRemoteProfile]);

  useEffect(() => {
    const db = getFirestoreDb();
    if (!db) return;
    let unsub: (() => void) | undefined;
    void (async () => {
      await ensureFirebaseAnonymousAuth();
      const uid = getFirebaseAuth()?.currentUser?.uid;
      if (!uid) return;
      const ref = doc(db, 'users', uid);
      unsub = onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists()) return;
          const d = snap.data();
          mergeRemoteProfile({
            ad_free_until_ms:
              typeof d.ad_free_until_ms === 'number' &&
              Number.isFinite(d.ad_free_until_ms)
                ? d.ad_free_until_ms
                : 0,
            is_pro_user: d.is_pro_user === true,
          });
          void persist();
        },
        () => {
          /* hors ligne */
        },
      );
    })();
    return () => {
      unsub?.();
    };
  }, [mergeRemoteProfile, persist]);

  return null;
}
