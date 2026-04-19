import { getAppPreference, setAppPreference } from '../api/localDb';

export const ARCHIVE_RETENTION_PREF_KEY = 'archive_retention_days';

export type ArchiveRetentionChoice = '7' | '30' | 'never';

export async function getArchiveRetentionChoice(): Promise<ArchiveRetentionChoice> {
  const raw = await getAppPreference(ARCHIVE_RETENTION_PREF_KEY);
  if (raw === '30' || raw === 'never') return raw;
  return '7';
}

export async function setArchiveRetentionChoice(value: ArchiveRetentionChoice): Promise<void> {
  await setAppPreference(ARCHIVE_RETENTION_PREF_KEY, value);
}
