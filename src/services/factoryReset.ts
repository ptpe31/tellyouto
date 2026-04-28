import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearAllAppPreferences } from '../api/localDb';
import { runStartupHealthCheck } from './healthCheck';
import { cancelAllLocalScheduledNotifications } from './notifications';

/**
 * SQLite + AsyncStorage + événement global + notifications + santé + synchro agent.
 * La navigation vers l’onboarding est à faire ensuite via `resetProfileToOnboarding`.
 */
export async function executeFactoryResetDataPlane(): Promise<{
  health: Awaited<ReturnType<typeof runStartupHealthCheck>>;
}> {
  await clearAllAppPreferences();
  await AsyncStorage.clear();
  await cancelAllLocalScheduledNotifications();
  const health = await runStartupHealthCheck();
  return { health };
}
