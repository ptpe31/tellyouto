/**
 * Implémentation Firebase via le **JS SDK web** (`@firebase/*`, `firebase/*`).
 * Utilisée aujourd'hui sur Expo / Hermes. Sera remplacée ou complétée par
 * `firebaseNativeProvider.ts` (@react-native-firebase) lors de l'Option B.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApps, initializeApp, type FirebaseApp } from '@firebase/app';
import {
  getAuth,
  initializeAuth,
  signInAnonymously,
  type Auth,
  type User,
} from '@firebase/auth';
import {
  addDoc,
  collection,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  type Firestore,
} from 'firebase/firestore';
import { Platform } from 'react-native';

import {
  isFirebaseConfigComplete,
  readExpoPublicFirebaseConfig,
} from './firebaseConfig';
import type { FirebaseProvider } from './firebaseTypes';

function initAuthWithAsyncStoragePersistence(app: FirebaseApp): Auth {
  const { getReactNativePersistence } = require('@firebase/auth') as {
    getReactNativePersistence: (storage: typeof AsyncStorage) => import('@firebase/auth').Persistence;
  };
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage) as import('@firebase/auth').Persistence,
    });
  } catch {
    return getAuth(app);
  }
}

export function createWebJsSdkFirebaseProvider(): FirebaseProvider {
  const firebaseConfig = readExpoPublicFirebaseConfig();

  let app: FirebaseApp | null = null;
  let firebaseInitLogged = false;
  let firestoreDb: Firestore | null = null;
  let firestoreConnectionTestScheduled = false;
  let authInstance: Auth | null = null;
  let anonymousAuthReadyLogged = false;

  function logFirebaseInit(projectId: string, source: 'new' | 'existing'): void {
    if (firebaseInitLogged || !__DEV__) return;
    firebaseInitLogged = true;
    console.log(`[TalkNDone] Firebase initialisé (${source}) — projectId=${projectId} [web-js-sdk]`);
  }

  function logFirebaseMissingEnv(): void {
    if (firebaseInitLogged || !__DEV__) return;
    firebaseInitLogged = true;
    console.warn(
      '[TalkNDone] Firebase non configuré : variables EXPO_PUBLIC_FIREBASE_* absentes au bundle. ' +
        'Copie `env.example` vers `.env` à la racine, renseigne EXPO_PUBLIC_FIREBASE_*, puis relance : npx expo start -c',
    );
  }

  function getApp(): FirebaseApp | null {
    if (getApps().length > 0) {
      const existing = getApps()[0] ?? null;
      if (existing?.options?.projectId) {
        logFirebaseInit(String(existing.options.projectId), 'existing');
      }
      return existing;
    }
    if (!isFirebaseConfigComplete(firebaseConfig)) {
      logFirebaseMissingEnv();
      return null;
    }
    if (!app) {
      app = initializeApp(firebaseConfig);
      logFirebaseInit(firebaseConfig.projectId, 'new');
    }
    return app;
  }

  function getAuthInstance(): Auth | null {
    const firebaseApp = getApp();
    if (!firebaseApp) return null;
    if (authInstance) return authInstance;
    authInstance =
      Platform.OS === 'web' ? getAuth(firebaseApp) : initAuthWithAsyncStoragePersistence(firebaseApp);
    return authInstance;
  }

  function scheduleFirestoreConnectionWriteTest(db: Firestore): void {
    if (firestoreConnectionTestScheduled) return;
    firestoreConnectionTestScheduled = true;
    setTimeout(() => {
      void (async () => {
        try {
          await ensureAnonymousAuth();
          const testRef = collection(db, 'CONNECTION_TESTS');
          await addDoc(testRef, {
            timestamp: Date.now(),
            device: 'App-Mobile',
            status: 'Trying to connect...',
          });
          if (__DEV__) {
            console.log("✅ TEST D'ÉCRITURE RÉUSSI DANS FIRESTORE !");
          }
        } catch (e) {
          if (__DEV__) {
            console.error('❌ ÉCHEC CRITIQUE FIRESTORE:', e);
          }
        }
      })();
    }, 2500);
  }

  function getFirestoreInstance(): Firestore | null {
    const firebaseApp = getApp();
    if (!firebaseApp) return null;
    if (!firestoreDb) {
      try {
        firestoreDb = initializeFirestore(firebaseApp, {
          localCache: memoryLocalCache(),
        });
      } catch {
        firestoreDb = getFirestore(firebaseApp);
      }
      scheduleFirestoreConnectionWriteTest(firestoreDb);
    }
    return firestoreDb;
  }

  async function ensureAnonymousAuth(): Promise<void> {
    const auth = getAuthInstance();
    if (!auth) return;
    const existing: User | null = auth.currentUser;
    if (existing) {
      if (__DEV__ && !anonymousAuthReadyLogged) {
        anonymousAuthReadyLogged = true;
        console.log(
          `[TalkNDone] Auth anonyme prête — uid=${existing.uid} (écritures Firestore autorisées)`,
        );
      }
      return;
    }
    await signInAnonymously(auth);
    const created: User | null = auth.currentUser;
    if (__DEV__ && created && !anonymousAuthReadyLogged) {
      anonymousAuthReadyLogged = true;
      console.log(
        `[TalkNDone] Auth anonyme activée — uid=${created.uid} (écritures Firestore autorisées)`,
      );
    }
  }

  return {
    backend: 'web-js-sdk',
    getApp,
    getAuth: getAuthInstance,
    getFirestore: getFirestoreInstance,
    ensureAnonymousAuth,
  };
}
