import { getRemoteConfig, getValue, fetchAndActivate } from 'firebase/remote-config';

import { getFirebaseApp } from '../api/firebase';

export const DEFAULT_SENTINEL_INITIAL_FREE_QUOTA = 6;

export async function fetchInitialSentinelFreeQuota(): Promise<number> {
  const app = getFirebaseApp();
  if (!app) return DEFAULT_SENTINEL_INITIAL_FREE_QUOTA;
  try {
    const rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = __DEV__ ? 0 : 6 * 60 * 60 * 1000;
    rc.defaultConfig = {
      initial_free_quota: DEFAULT_SENTINEL_INITIAL_FREE_QUOTA,
    };
    try {
      await fetchAndActivate(rc);
    } catch {
      /* ignore */
    }
    const raw = getValue(rc, 'initial_free_quota');
    const n = Number(raw.asString());
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : DEFAULT_SENTINEL_INITIAL_FREE_QUOTA;
  } catch {
    return DEFAULT_SENTINEL_INITIAL_FREE_QUOTA;
  }
}

