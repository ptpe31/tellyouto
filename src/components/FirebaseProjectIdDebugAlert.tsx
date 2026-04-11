import React, { useEffect } from 'react';
import { Alert } from 'react-native';

import { getFirebaseApp } from '../api/firebase';

/**
 * Une fois au démarrage (dev) : confirme le projectId réellement utilisé par le SDK.
 */
export function FirebaseProjectIdDebugAlert() {
  useEffect(() => {
    if (!__DEV__) return;
    const sdkApp = getFirebaseApp();
    const fromSdk = sdkApp?.options?.projectId ?? '(getFirebaseApp = null)';
    const fromEnv =
      process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '(EXPO_PUBLIC_* absent)';
    Alert.alert(
      'Firebase — projectId (debug)',
      `SDK (app.options.projectId) :\n${fromSdk}\n\nEXPO_PUBLIC_FIREBASE_PROJECT_ID :\n${fromEnv}`,
    );
  }, []);
  return null;
}
