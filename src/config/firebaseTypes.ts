import type { FirebaseApp } from '@firebase/app';
import type { Auth } from '@firebase/auth';
import type { Firestore } from 'firebase/firestore';

/**
 * Backends Firebase supportés par l'app.
 *
 * - `web-js-sdk` : `@firebase/app` + modules web (état actuel, Expo / Hermes).
 * - `react-native-firebase` : modules natifs (@react-native-firebase/*) — Option B, session future.
 */
export type FirebaseBackendId = 'web-js-sdk' | 'react-native-firebase';

/**
 * Contrat d'initialisation Firebase — une implémentation par backend.
 * Le code métier consomme uniquement {@link getFirebaseApp} / {@link getFirebaseAuth} / etc.
 * via `src/config/firebase.ts`, pas le SDK directement.
 */
export interface FirebaseProvider {
  readonly backend: FirebaseBackendId;
  getApp(): FirebaseApp | null;
  getAuth(): Auth | null;
  getFirestore(): Firestore | null;
  ensureAnonymousAuth(): Promise<void>;
}

/** Valeurs lues depuis `process.env.EXPO_PUBLIC_FIREBASE_BACKEND`. */
export function readFirebaseBackendFromEnv(): FirebaseBackendId {
  const raw = process.env.EXPO_PUBLIC_FIREBASE_BACKEND?.trim();
  if (raw === 'react-native-firebase') return 'react-native-firebase';
  return 'web-js-sdk';
}
