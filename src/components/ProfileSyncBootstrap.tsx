import { useEffect } from 'react';

import { fetchDeviceProfileFromFirestore } from '../api/userProfile';
import { useUserSpectrum } from '../context/UserSpectrumContext';

/**
 * Au démarrage / retour réseau : aligne prénom et quota depuis Firestore.
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

  return null;
}
