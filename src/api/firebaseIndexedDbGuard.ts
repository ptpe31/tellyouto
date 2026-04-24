import { Platform } from 'react-native';

/**
 * Le SDK Firebase **Remote Config** (`@firebase/remote-config`) sélectionne `IndexedDbStorage` lorsque
 * `typeof indexedDB === 'object'`. En React Native / Hermes, `indexedDB` est souvent absent, `null`, ou
 * incomplet — ce qui provoque des erreurs du type « Property 'indexedDB' doesn't exist » à l’ouverture.
 *
 * Il n’existe pas d’API équivalente à `initializeAuth(..., getReactNativePersistence)` pour Remote Config :
 * on force donc un contexte où la sonde échoue proprement pour que le SDK utilise **`InMemoryStorage`**
 * (cache mémoire uniquement, acceptable sur mobile).
 *
 * Importer ce module **avant** le premier `getRemoteConfig()` (via `index.ts` et/ou `firebase.ts`).
 */
let firebaseJsIndexedDbGuardApplied = false;

function applyFirebaseJsIndexedDbGuard(): void {
  if (firebaseJsIndexedDbGuardApplied) return;
  firebaseJsIndexedDbGuardApplied = true;
  if (Platform.OS === 'web') return;

  try {
    const current = (globalThis as Record<string, unknown>).indexedDB;
    const openFn = current != null && typeof current === 'object' ? (current as { open?: unknown }).open : null;
    const usable = typeof openFn === 'function';
    if (usable) return;
  } catch {
    /* continuer : environnement incompatible IDB */
  }

  try {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      enumerable: false,
      get(): undefined {
        return undefined;
      },
      set: () => {
        /* no-op : évite qu’un polyfill tiers réactive IDB cassé */
      },
    });
  } catch {
    try {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    } catch {
      /* */
    }
  }
}

applyFirebaseJsIndexedDbGuard();
