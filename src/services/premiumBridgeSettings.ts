import AsyncStorage from '@react-native-async-storage/async-storage';

/** Préférence courante (Mode Passerelle). */
export const AUTO_ARCHIVE_ON_CALENDAR_SYNC_KEY =
  '@tellyouto/auto_archive_on_calendar_sync';

const LEGACY_AUTO_ARCHIVE_AFTER_CALENDAR_SYNC_KEY =
  '@tellyouto/auto_archive_after_calendar_sync';

export async function getAutoArchiveAfterCalendarSync(): Promise<boolean> {
  let value = await AsyncStorage.getItem(AUTO_ARCHIVE_ON_CALENDAR_SYNC_KEY);
  if (value == null) {
    const legacy = await AsyncStorage.getItem(LEGACY_AUTO_ARCHIVE_AFTER_CALENDAR_SYNC_KEY);
    value = legacy;
    if (legacy != null) {
      await AsyncStorage.setItem(AUTO_ARCHIVE_ON_CALENDAR_SYNC_KEY, legacy);
    }
  }
  return value === '1';
}

export async function setAutoArchiveAfterCalendarSync(enabled: boolean): Promise<void> {
  const v = enabled ? '1' : '0';
  await AsyncStorage.setItem(AUTO_ARCHIVE_ON_CALENDAR_SYNC_KEY, v);
  await AsyncStorage.setItem(LEGACY_AUTO_ARCHIVE_AFTER_CALENDAR_SYNC_KEY, v);
}
