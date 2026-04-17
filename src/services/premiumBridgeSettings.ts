import AsyncStorage from '@react-native-async-storage/async-storage';

export const AUTO_ARCHIVE_AFTER_CALENDAR_SYNC_KEY =
  '@tellyouto/auto_archive_after_calendar_sync';

export async function getAutoArchiveAfterCalendarSync(): Promise<boolean> {
  const value = await AsyncStorage.getItem(AUTO_ARCHIVE_AFTER_CALENDAR_SYNC_KEY);
  return value === '1';
}

export async function setAutoArchiveAfterCalendarSync(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(
    AUTO_ARCHIVE_AFTER_CALENDAR_SYNC_KEY,
    enabled ? '1' : '0',
  );
}
