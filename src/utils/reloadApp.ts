import { DevSettings, Platform } from 'react-native';
import * as Updates from 'expo-updates';

/**
 * Recharge le bundle JS (dev : Fast Refresh / reload natif ; prod : expo-updates).
 */
export async function reloadApplication(): Promise<void> {
  if (__DEV__) {
    DevSettings.reload();
    return;
  }
  try {
    await Updates.reloadAsync();
  } catch {
    if (Platform.OS === 'web' && typeof globalThis.location?.reload === 'function') {
      globalThis.location.reload();
      return;
    }
    try {
      DevSettings.reload();
    } catch {
      /* dernier recours : l’utilisateur fermera l’app */
    }
  }
}
