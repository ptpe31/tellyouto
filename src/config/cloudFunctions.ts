/**
 * Base HTTPS des Cloud Functions Gen2 (Western Europe — Paris).
 * Surcharge possible : EXPO_PUBLIC_CLOUD_FUNCTIONS_BASE dans .env / EAS.
 */
const DEFAULT_CLOUD_FUNCTIONS_BASE =
  'https://europe-west9-tellmeto-4f3c7.cloudfunctions.net';

export function getCloudFunctionsBaseUrl(): string {
  const raw =
    process.env.EXPO_PUBLIC_CLOUD_FUNCTIONS_BASE?.trim() ||
    DEFAULT_CLOUD_FUNCTIONS_BASE;
  return raw.replace(/\/$/, '');
}

/** URL complète de la fonction `disconnectMessenger` (déconnexion messagerie). */
export function getDisconnectMessengerUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_DISCONNECT_MESSENGER_URL?.trim();
  if (explicit) return explicit;
  return `${getCloudFunctionsBaseUrl()}/disconnectMessenger`;
}
