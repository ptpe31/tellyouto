import AsyncStorage from '@react-native-async-storage/async-storage';

export const CALENDAR_CONNECT_KEY = '@tellyouto/calendar_connect_enabled';
/** @deprecated Préférer les réglages par calendrier (`calendar_device_configs_v1`). */
export const CALENDAR_HIDE_ON_RAIL_KEY = '@tellyouto/calendar_hide_on_rail';

const CALENDAR_DEVICE_CONFIGS_KEY = '@tellyouto/calendar_device_configs_v1';

export type CalendarDeviceConfig = {
  /** Si faux, ce calendrier est ignoré (aucun événement lu). */
  connected: boolean;
  /** Si connecté : afficher les événements sur le rail ; sinon blocage agent uniquement. */
  railVisible: boolean;
};

export async function getCalendarConnectEnabled(): Promise<boolean> {
  const v = await AsyncStorage.getItem(CALENDAR_CONNECT_KEY);
  return v === '1';
}

export async function setCalendarConnectEnabled(value: boolean): Promise<void> {
  await AsyncStorage.setItem(CALENDAR_CONNECT_KEY, value ? '1' : '0');
}

/** @deprecated */
export async function getCalendarHideOnRail(): Promise<boolean> {
  const v = await AsyncStorage.getItem(CALENDAR_HIDE_ON_RAIL_KEY);
  return v === '1';
}

/** @deprecated */
export async function setCalendarHideOnRail(value: boolean): Promise<void> {
  await AsyncStorage.setItem(CALENDAR_HIDE_ON_RAIL_KEY, value ? '1' : '0');
}

export async function getCalendarDeviceConfigs(): Promise<
  Record<string, CalendarDeviceConfig>
> {
  const raw = await AsyncStorage.getItem(CALENDAR_DEVICE_CONFIGS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, CalendarDeviceConfig>;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

export async function setCalendarDeviceConfigs(
  map: Record<string, CalendarDeviceConfig>,
): Promise<void> {
  await AsyncStorage.setItem(CALENDAR_DEVICE_CONFIGS_KEY, JSON.stringify(map));
}

/** Ajoute les IDs manquants avec défaut : déconnecté, visible sur rail si connecté plus tard. */
export function mergeConfigsWithDeviceList(
  deviceIds: string[],
  existing: Record<string, CalendarDeviceConfig>,
): Record<string, CalendarDeviceConfig> {
  const out: Record<string, CalendarDeviceConfig> = { ...existing };
  for (const id of deviceIds) {
    if (!(id in out)) {
      out[id] = { connected: false, railVisible: true };
    }
  }
  return out;
}

export async function patchCalendarDeviceConfig(
  calendarId: string,
  patch: Partial<CalendarDeviceConfig>,
): Promise<Record<string, CalendarDeviceConfig>> {
  const cur = await getCalendarDeviceConfigs();
  const prev = cur[calendarId] ?? { connected: false, railVisible: true };
  const next = { ...cur, [calendarId]: { ...prev, ...patch } };
  await setCalendarDeviceConfigs(next);
  return next;
}
