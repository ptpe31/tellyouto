import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';

import {
  dangerouslyResetDatabase,
  DATABASE_RESET_COMPLETE_EVENT,
} from '../api/localDb';
import { syncPendingIntentions } from '../api/syncService';
import { runStartupHealthCheck } from './healthCheck';
import { cancelAllLocalScheduledNotifications } from './notifications';

/**
 * SQLite + AsyncStorage + événement global + notifications + santé + synchro agent.
 * La navigation vers l’onboarding est à faire ensuite via `resetProfileToOnboarding`.
 */
export async function executeFactoryResetDataPlane(): Promise<{
  health: Awaited<ReturnType<typeof runStartupHealthCheck>>;
}> {
  await dangerouslyResetDatabase();
  await AsyncStorage.clear();
  DeviceEventEmitter.emit(DATABASE_RESET_COMPLETE_EVENT);
  await cancelAllLocalScheduledNotifications();
  const health = await runStartupHealthCheck();
  await syncPendingIntentions();
  return { health };
}
