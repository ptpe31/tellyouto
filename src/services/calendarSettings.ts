import AsyncStorage from '@react-native-async-storage/async-storage';

export const CALENDAR_CONNECT_KEY = '@tellyouto/calendar_connect_enabled';
export const CALENDAR_HIDE_ON_RAIL_KEY = '@tellyouto/calendar_hide_on_rail';

export async function getCalendarConnectEnabled(): Promise<boolean> {
  const v = await AsyncStorage.getItem(CALENDAR_CONNECT_KEY);
  return v === '1';
}

export async function setCalendarConnectEnabled(value: boolean): Promise<void> {
  await AsyncStorage.setItem(CALENDAR_CONNECT_KEY, value ? '1' : '0');
}

export async function getCalendarHideOnRail(): Promise<boolean> {
  const v = await AsyncStorage.getItem(CALENDAR_HIDE_ON_RAIL_KEY);
  return v === '1';
}

export async function setCalendarHideOnRail(value: boolean): Promise<void> {
  await AsyncStorage.setItem(CALENDAR_HIDE_ON_RAIL_KEY, value ? '1' : '0');
}
