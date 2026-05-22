/**
 * Point d'entrée **unique** Firebase pour tout le code métier et les services.
 *
 * ## Architecture (préparation Option B)
 *
 * ```
 * code métier / services
 *        ↓
 *  src/config/firebase.ts          ← getFirebaseApp, getFirebaseAuth, …
 *        ↓
 *  FirebaseProvider (interface)
 *        ↓
 *  firebaseWebProvider.ts         ← actuel : @firebase/* JS SDK
 *  firebaseNativeProvider.ts      ← futur : @react-native-firebase/*
 * ```
 *
 * Basculer vers `@react-native-firebase` (Option B) :
 * 1. Ajouter `google-services.json` / `GoogleService-Info.plist` + config Expo prebuild.
 * 2. Implémenter `createNativeFirebaseProvider()` dans `firebaseNativeProvider.ts`.
 * 3. Définir `EXPO_PUBLIC_FIREBASE_BACKEND=react-native-firebase` (ou auto-detect natif).
 * 4. Migrer Remote Config vers `@react-native-firebase/remote-config` dans le provider natif.
 *
 * Le reste du code (Firestore `doc/getDoc`, Auth linking, proxy Gemini) reste inchangé tant que
 * les types `Auth` / `Firestore` / `FirebaseApp` restent compatibles ou sont adaptés dans le provider.
 *
 * @module config/firebase
 */

import { createNativeFirebaseProvider } from './firebaseNativeProvider';
import { createWebJsSdkFirebaseProvider } from './firebaseWebProvider';
import type { FirebaseBackendId, FirebaseProvider } from './firebaseTypes';
import { readFirebaseBackendFromEnv } from './firebaseTypes';

export type { FirebaseBackendId, FirebaseProvider } from './firebaseTypes';
export type { FirebaseApp } from '@firebase/app';
export type { Auth, User } from '@firebase/auth';
export type { Firestore } from 'firebase/firestore';

let cachedBackend: FirebaseBackendId | null = null;
let cachedProvider: FirebaseProvider | null = null;

function resolveFirebaseBackend(): FirebaseBackendId {
  if (cachedBackend) return cachedBackend;
  cachedBackend = readFirebaseBackendFromEnv();
  return cachedBackend;
}

function createProviderForBackend(backend: FirebaseBackendId): FirebaseProvider {
  switch (backend) {
    case 'web-js-sdk':
      return createWebJsSdkFirebaseProvider();
    case 'react-native-firebase':
      return createNativeFirebaseProvider();
    default: {
      const _exhaustive: never = backend;
      return _exhaustive;
    }
  }
}

/** Backend actif (env ou défaut `web-js-sdk`). */
export function getActiveFirebaseBackend(): FirebaseBackendId {
  return resolveFirebaseBackend();
}

/** Provider singleton — point d'extension pour diagnostics et migration RC. */
export function getFirebaseProvider(): FirebaseProvider {
  if (!cachedProvider) {
    cachedProvider = createProviderForBackend(resolveFirebaseBackend());
    if (__DEV__) {
      console.log(`[TalkNDone] Firebase backend=${cachedProvider.backend}`);
    }
  }
  return cachedProvider;
}

export function getFirebaseApp(): ReturnType<FirebaseProvider['getApp']> {
  return getFirebaseProvider().getApp();
}

export function getFirebaseAuth(): ReturnType<FirebaseProvider['getAuth']> {
  return getFirebaseProvider().getAuth();
}

export function getFirestoreDb(): ReturnType<FirebaseProvider['getFirestore']> {
  return getFirebaseProvider().getFirestore();
}

export async function ensureFirebaseAnonymousAuth(): Promise<void> {
  await getFirebaseProvider().ensureAnonymousAuth();
}
