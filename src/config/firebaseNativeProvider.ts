/**
 * Provider Firebase natif — **Option B** (@react-native-firebase).
 *
 * Non implémenté : session dédiée avec :
 * - `@react-native-firebase/app`, `/auth`, `/firestore`, `/remote-config`
 * - `google-services.json` (Android) + `GoogleService-Info.plist` (iOS)
 * - Expo prebuild / dev client natif
 *
 * Une fois prêt, brancher ici et activer via `EXPO_PUBLIC_FIREBASE_BACKEND=react-native-firebase`
 * dans `src/config/firebase.ts` → `createProviderForBackend`.
 */

import type { FirebaseProvider } from './firebaseTypes';

export function createNativeFirebaseProvider(): FirebaseProvider {
  throw new Error(
    '[Firebase] createNativeFirebaseProvider() : implémenter Option B (@react-native-firebase) — voir firebaseNativeProvider.ts',
  );
}
