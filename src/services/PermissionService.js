import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';
import { ensureNotificationPermissions } from './notifications';

function getAndroidPackageName() {
  return (
    Constants.expoConfig?.android?.package ||
    Constants.easConfig?.projectId ||
    'com.trankil.talkndone'
  );
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
 */
export async function requestIgnoreBatteryOptimizationAndroid() {
  if (Platform.OS !== 'android') return true;

  const packageName = getAndroidPackageName();
  const deepLink = `package:${packageName}`;
  try {
    const opened = await Linking.sendIntent(
      'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      [{ key: 'package', value: deepLink }],
    );
    if (opened) return true;
  } catch {
    /* silencieux : OEM / API / absence d’activité — évite le spam Metro */
  }

  try {
    await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
    return true;
  } catch {
    return false;
  }
}

export async function requestBackgroundExecutionPermissions() {
  const notificationsGranted = await requestNotificationPermissionForForeground();
  const batteryPromptOpened = await requestIgnoreBatteryOptimizationAndroid();
  return { notificationsGranted, batteryPromptOpened };
}
