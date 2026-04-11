import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  getFirestore,
  type Firestore,
} from 'firebase/firestore';
import { Platform } from 'react-native';

import {
  isFirebaseConfigComplete,
  readExpoPublicFirebaseConfig,
} from '../config/firebaseConfig';

/** Entrée RN du SDK — les .d.ts « navigateur » n’exportent pas getReactNativePersistence. */
function initAuthWithAsyncStoragePersistence(app: FirebaseApp): Auth {
  const {
    initializeAuth,
    getAuth: getAuthMod,
    getReactNativePersistence,
  } = require('firebase/auth') as {
    initializeAuth: (
      a: FirebaseApp,
      opts: { persistence: unknown },
    ) => Auth;
    getAuth: (a: FirebaseApp) => Auth;
    getReactNativePersistence: (storage: typeof AsyncStorage) => unknown;
  };
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuthMod(app);
  }
}

/**
 * Configuration Firebase — uniquement via `process.env.EXPO_PUBLIC_*` (`.env` / EAS).
 * Projet GCP officiel : `tellmeto-4f3c7` (ne pas confondre avec le slug d’app `tellyouto`).
 */
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};

let app: FirebaseApp | null = null;
/** Évite de spammer Metro : un seul log par session. */
let firebaseInitLogged = false;

function logFirebaseInit(projectId: string, source: 'new' | 'existing'): void {
  if (firebaseInitLogged || !__DEV__) return;
  firebaseInitLogged = true;
  console.log(
    `[TellYouTo] Firebase initialisé (${source}) — projectId=${projectId}`,
  );
}

function logFirebaseMissingEnv(): void {
  if (firebaseInitLogged || !__DEV__) return;
  firebaseInitLogged = true;
  console.warn(
    '[TellYouTo] Firebase non configuré : variables EXPO_PUBLIC_FIREBASE_* absentes au bundle. ' +
      'Renomme la racine `env` → `.env` (Expo ne lit que `.env`), puis relance : npx expo start -c',
  );
}

export function getFirebaseApp(): FirebaseApp | null {
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

let firestoreDb: Firestore | null = null;
/** Témoin unique par session — écriture diagnostic `CONNECTION_TESTS`. */
let firestoreConnectionTestScheduled = false;

/** Auth avec persistance disque (RN) — évite le warning « memory persistence ». */
let authInstance: Auth | null = null;

/** Un seul log dev par session pour confirmer l’auth anonyme avant les écritures Firestore. */
let anonymousAuthReadyLogged = false;

export function getFirebaseAuth(): Auth | null {
  const app = getFirebaseApp();
  if (!app) return null;
  if (authInstance) return authInstance;
  authInstance =
    Platform.OS === 'web' ? getAuth(app) : initAuthWithAsyncStoragePersistence(app);
  return authInstance;
}

function scheduleFirestoreConnectionWriteTest(db: Firestore): void {
  if (firestoreConnectionTestScheduled) return;
  firestoreConnectionTestScheduled = true;
  /** Hors chemin critique TTI : laisser le premier rendu / SQLite / navigation passer avant réseau. */
  setTimeout(() => {
    void (async () => {
      try {
        await ensureFirebaseAnonymousAuth();
        const testRef = collection(db, 'CONNECTION_TESTS');
        await addDoc(testRef, {
          timestamp: Date.now(),
          device: 'App-Mobile',
          status: 'Trying to connect...',
        });
        console.log("✅ TEST D'ÉCRITURE RÉUSSI DANS FIRESTORE !");
      } catch (e) {
        console.error('❌ ÉCHEC CRITIQUE FIRESTORE:', e);
      }
    })();
  }, 2500);
}

export function getFirestoreDb(): Firestore | null {
  const app = getFirebaseApp();
  if (!app) return null;
  if (!firestoreDb) {
    firestoreDb = getFirestore(app);
    scheduleFirestoreConnectionWriteTest(firestoreDb);
  }
  return firestoreDb;
}

/**
 * Firestore (règles du type `request.auth != null`) exige un utilisateur Firebase.
 * Sans ça, les écritures client échouent en permission denied.
 */
export async function ensureFirebaseAnonymousAuth(): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) return;
  const existing: User | null = auth.currentUser;
  if (existing) {
    if (__DEV__ && !anonymousAuthReadyLogged) {
      anonymousAuthReadyLogged = true;
      console.log(
        `[TellYouTo] Auth anonyme prête — uid=${existing.uid} (écritures Firestore autorisées)`,
      );
    }
    return;
  }
  await signInAnonymously(auth);
  const created: User | null = auth.currentUser;
  if (__DEV__ && created && !anonymousAuthReadyLogged) {
    anonymousAuthReadyLogged = true;
    console.log(
      `[TellYouTo] Auth anonyme activée — uid=${created.uid} (écritures Firestore autorisées)`,
    );
  }
}
