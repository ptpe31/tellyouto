import { Alert } from 'react-native';

import { getFirebaseApp } from '../api/firebase';

/**
 * Affiche le projectId SDK vs EXPO_PUBLIC — à appeler depuis l’écran Debug uniquement
 * (plus d’alerte au démarrage).
 */
export function showFirebaseProjectIdDebugAlert(): void {
  const sdkApp = getFirebaseApp();
  const fromSdk = sdkApp?.options?.projectId ?? '(getFirebaseApp = null)';
  const fromEnv =
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '(EXPO_PUBLIC_* absent)';
  Alert.alert(
    'Firebase — projectId (debug)',
    `SDK (app.options.projectId) :\n${fromSdk}\n\nEXPO_PUBLIC_FIREBASE_PROJECT_ID :\n${fromEnv}`,
  );
}
