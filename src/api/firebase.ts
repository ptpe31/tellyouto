/**
 * Façade de compatibilité — préférer `src/config/firebase` pour les nouveaux imports.
 *
 * @deprecated Import depuis `../config/firebase` (ou `@/config/firebase` selon alias).
 */
export {
  ensureFirebaseAnonymousAuth,
  getActiveFirebaseBackend,
  getFirebaseApp,
  getFirebaseAuth,
  getFirebaseProvider,
  getFirestoreDb,
} from '../config/firebase';

export type { Auth, FirebaseApp, FirebaseBackendId, FirebaseProvider, Firestore, User } from '../config/firebase';
