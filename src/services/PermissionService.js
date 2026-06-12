import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';
import { ensureNotificationPermissions } from './notifications';

/** Local-first : mémorise qu’on a déjà sollicité l’exclusion batterie (évite le spam Fast Refresh). */
export const BATTERY_PERMISSION_REQUESTED_KEY = '@trankil_battery_permission_requested';

function getAndroidPackageName() {
  return (
    Constants.expoConfig?.android?.package ||
    Constants.easConfig?.projectId ||
    'com.trankil.talkndone'
  );
}

export async function clearBatteryPermissionRequestedFlag() {
  await AsyncStorage.removeItem(BATTERY_PERMISSION_REQUESTED_KEY);
}

export async function requestNotificationPermissionForForeground() {
  try {
    return await ensureNotificationPermissions();
  } catch (error) {
    console.warn('[PermissionService] notification permission failed', error);
    return false;
  }
}

/**
 * Ouvre l'écran Android pour exclure l'app de l'optimisation batterie.
 * Certains OEM ignorent l'intent explicite ; fallback sur paramètres système.
 * Ne demande qu'une fois (clé AsyncStorage {@link BATTERY_PERMISSION_REQUESTED_KEY}).
 */
export async function requestIgnoreBatteryOptimizationAndroid() {
  if (Platform.OS !== 'android') return true;

  try {
    const alreadyRequested = await AsyncStorage.getItem(BATTERY_PERMISSION_REQUESTED_KEY);
    if (alreadyRequested === 'true') return true;
  } catch {
    /* lecture AsyncStorage best-effort */
  }

  const packageName = getAndroidPackageName();
  const deepLink = `package:${packageName}`;
  let prompted = false;
  try {
    const opened = await Linking.sendIntent(
      'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      [{ key: 'package', value: deepLink }],
    );
    if (opened) prompted = true;
  } catch {
    /* silencieux : OEM / API / absence d’activité — évite le spam Metro */
  }

  if (!prompted) {
    try {
      await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
      prompted = true;
    } catch {
      /* intent indisponible */
    }
  }

  try {
    await AsyncStorage.setItem(BATTERY_PERMISSION_REQUESTED_KEY, 'true');
  } catch {
    /* persistance best-effort */
  }

  return prompted;
}

export async function requestBackgroundExecutionPermissions() {
  const notificationsGranted = await requestNotificationPermissionForForeground();
  const batteryPromptOpened = await requestIgnoreBatteryOptimizationAndroid();
  return { notificationsGranted, batteryPromptOpened };
}
