import { Alert } from 'react-native';

import { getFirebaseApp } from '../api/firebase';
import i18n from '../locales/i18n';

/**
 * Affiche le projectId SDK vs EXPO_PUBLIC — à appeler depuis l’écran Debug uniquement
 * (plus d’alerte au démarrage).
 */
export function showFirebaseProjectIdDebugAlert(): void {
  const sdkApp = getFirebaseApp();
  const fromSdk =
    sdkApp?.options?.projectId ?? i18n.t('debug.firebaseSdkNullLabel');
  const fromEnv =
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ??
    i18n.t('debug.firebaseEnvAbsentLabel');
  Alert.alert(
    i18n.t('debug.firebaseProjectIdTitle'),
    i18n.t('debug.firebaseProjectIdBody', { sdk: fromSdk, env: fromEnv }),
  );
}
