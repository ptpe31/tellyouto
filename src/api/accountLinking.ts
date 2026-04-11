import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import {
  GoogleAuthProvider,
  OAuthProvider,
  linkWithCredential,
  type User,
} from 'firebase/auth';

import { ensureFirebaseAnonymousAuth, getFirebaseAuth } from './firebase';

export class AccountLinkingRequiredError extends Error {
  readonly code = 'ACCOUNT_LINKING_REQUIRED' as const;

  constructor(
    message = 'Lie un compte Google ou Apple pour conserver ton abonnement entre appareils.',
  ) {
    super(message);
    this.name = 'AccountLinkingRequiredError';
  }
}

export function isFirebaseUserAnonymous(): boolean {
  return getFirebaseAuth()?.currentUser?.isAnonymous === true;
}

/**
 * À appeler avant un achat Pro ou une écriture d’entitlement critique :
 * lève `AccountLinkingRequiredError` tant que le compte est strictement anonyme.
 */
export async function ensureAuthenticatedUser(): Promise<void> {
  await ensureFirebaseAnonymousAuth();
  if (isFirebaseUserAnonymous()) {
    throw new AccountLinkingRequiredError();
  }
}

export async function linkAnonymousWithGoogleIdToken(
  idToken: string,
): Promise<User> {
  const auth = getFirebaseAuth();
  if (!auth?.currentUser) {
    throw new Error('NO_AUTH_USER');
  }
  const cred = GoogleAuthProvider.credential(idToken);
  const { user } = await linkWithCredential(auth.currentUser, cred);
  return user;
}

/**
 * Sign in with Apple (iOS) puis liaison au compte anonyme Firebase courant.
 */
export async function linkAnonymousWithApple(): Promise<User> {
  if (Platform.OS !== 'ios') {
    throw new Error('APPLE_IOS_ONLY');
  }
  const auth = getFirebaseAuth();
  if (!auth?.currentUser) {
    throw new Error('NO_AUTH_USER');
  }
  const AppleAuthentication = await import('expo-apple-authentication');
  const available = await AppleAuthentication.isAvailableAsync();
  if (!available) {
    throw new Error('APPLE_UNAVAILABLE');
  }
  const rawNonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );
  const apple = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });
  if (!apple.identityToken) {
    throw new Error('APPLE_NO_IDENTITY_TOKEN');
  }
  const provider = new OAuthProvider('apple.com');
  const oauthCred = provider.credential({
    idToken: apple.identityToken,
    rawNonce,
  });
  const { user } = await linkWithCredential(auth.currentUser, oauthCred);
  return user;
}
