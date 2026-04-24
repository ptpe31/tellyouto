/**
 * Config client Firebase — **uniquement** `process.env.EXPO_PUBLIC_*` (Expo / EAS).
 * Projet GCP / Firebase unique pour ce dépôt (Firestore / Auth : europe-west9 côté console).
 */
export const FIREBASE_PROJECT_ID_EXPECTED = 'tellmeto-4f3c7' as const;

export type FirebaseWebClientConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

export function readExpoPublicFirebaseConfig(): FirebaseWebClientConfig {
  const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '';
  if (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    projectId &&
    projectId !== FIREBASE_PROJECT_ID_EXPECTED
  ) {
    console.warn(
      `[TellYouTo] EXPO_PUBLIC_FIREBASE_PROJECT_ID=${projectId} — attendu uniquement ${FIREBASE_PROJECT_ID_EXPECTED}.`,
    );
  }
  return {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
    projectId,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
  };
}

export function isFirebaseConfigComplete(c: FirebaseWebClientConfig): boolean {
  return Boolean(c.apiKey && c.projectId);
}
