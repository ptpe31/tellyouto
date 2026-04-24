import { DevSettings } from 'react-native';

/**
 * Recharge le bundle JS (dev : Fast Refresh / reload natif).
 */
export async function reloadApplication(): Promise<void> {
  if (__DEV__) {
    DevSettings.reload();
    return;
  }
  console.log('[reloadApplication] disabled in release build');
}
