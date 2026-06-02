import * as IntentLauncher from 'expo-intent-launcher';
import { Alert, Linking, Platform } from 'react-native';

import i18n from '../locales/i18n';

const ANDROID_SET_ALARM = 'android.intent.action.SET_ALARM';
const ANDROID_SHOW_ALARMS = 'android.intent.action.SHOW_ALARMS';

function localHourMinute(unixSec: number): { hour: number; minute: number } {
  const d = new Date(unixSec * 1000);
  return { hour: d.getHours(), minute: d.getMinutes() };
}

function formatHm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function buildSetAlarmExtras(hour: number, minute: number, label?: string): Record<string, string | number | boolean> {
  const extra: Record<string, string | number | boolean> = {
    'android.intent.extra.alarm.HOUR': hour,
    'android.intent.extra.alarm.MINUTES': minute,
    'android.intent.extra.alarm.SKIP_UI': false,
  };
  const trimmed = String(label ?? '').trim();
  if (trimmed) extra['android.intent.extra.alarm.MESSAGE'] = trimmed;
  return extra;
}

async function launchAndroidSetAlarm(hour: number, minute: number, label?: string): Promise<boolean> {
  try {
    await IntentLauncher.startActivityAsync(ANDROID_SET_ALARM, {
      extra: buildSetAlarmExtras(hour, minute, label),
    });
    return true;
  } catch (err) {
    if (__DEV__) console.warn('[AlarmService] SET_ALARM failed', err);
    return false;
  }
}

async function launchAndroidShowAlarms(): Promise<boolean> {
  try {
    await IntentLauncher.startActivityAsync(ANDROID_SHOW_ALARMS);
    return true;
  } catch (err) {
    if (__DEV__) console.warn('[AlarmService] SHOW_ALARMS failed', err);
    return false;
  }
}

function alertAndroidUnavailable(hour: number, minute: number, label?: string): void {
  const time = formatHm(hour, minute);
  Alert.alert(
    i18n.t('tripAlarm.pickerTitle'),
    i18n.t('tripAlarm.androidUnavailable', {
      time,
      label: label || i18n.t('tripAlarm.pickerMessage', { time }),
    }),
  );
}

async function openAndroidAlarmDirect(hour: number, minute: number, label?: string): Promise<boolean> {
  if (await launchAndroidSetAlarm(hour, minute, label)) return true;
  if (await launchAndroidShowAlarms()) return true;
  alertAndroidUnavailable(hour, minute, label);
  return false;
}

async function tryOpenUrl(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

function alertIosManual(hour: number, minute: number, label?: string): void {
  const time = formatHm(hour, minute);
  Alert.alert(
    i18n.t('tripAlarm.pickerTitle'),
    i18n.t('tripAlarm.iosManualHint', {
      time,
      label: label || i18n.t('tripAlarm.pickerMessage', { time }),
    }),
  );
}

async function openIosAlarmDirect(hour: number, minute: number, label?: string): Promise<boolean> {
  const candidates = [
    `clock-alarm://add?hour=${hour}&minute=${minute}`,
    `clock-alarm://create?hour=${hour}&minute=${minute}`,
    'clock-alarm://',
    'clock-worldclock://',
  ];

  for (const url of candidates) {
    try {
      if (await Linking.canOpenURL(url)) {
        if (await tryOpenUrl(url)) return true;
      }
    } catch {
      /* essayer le candidat suivant */
    }
  }

  for (const url of candidates) {
    if (await tryOpenUrl(url)) return true;
  }

  alertIosManual(hour, minute, label);
  return false;
}

/**
 * Ouvre l’app d’horloge native via intent système (Android) ou deep link Horloge (iOS).
 * Aucune modale custom — le OS délègue à l’app Horloge par défaut.
 *
 * @param alarmTimeUnix Timestamp Unix secondes (heure locale cible — voir `resolveElasticDepartureAlarmUnixSec`).
 * @param label Nom suggéré de l’alarme (optionnel — surtout Android / Google Clock).
 */
export async function openAlarmSelection(
  departureTimeUnix: number,
  label?: string,
): Promise<boolean> {
  const unix = Math.floor(Number(departureTimeUnix));
  if (!Number.isFinite(unix) || unix <= 0) {
    if (__DEV__) console.warn('[AlarmService] departureTimeUnix invalide', departureTimeUnix);
    return false;
  }
  const { hour, minute } = localHourMinute(unix);
  const safeLabel = String(label ?? '').trim() || undefined;

  if (Platform.OS === 'android') {
    return openAndroidAlarmDirect(hour, minute, safeLabel);
  }
  if (Platform.OS === 'ios') {
    return openIosAlarmDirect(hour, minute, safeLabel);
  }

  return openAndroidAlarmDirect(hour, minute, safeLabel);
}

export const AlarmService = {
  openAlarmSelection,
};
