import AsyncStorage from '@react-native-async-storage/async-storage';

export type DebugUserTierOverride = 'force_free' | 'force_pro' | null;

const DEBUG_USER_TIER_OVERRIDE_KEY = 'debug_user_tier_override_v1';

let cachedOverride: DebugUserTierOverride = null;
let hydrated = false;

function normalizeOverride(value: unknown): DebugUserTierOverride {
  if (value === 'force_free' || value === 'force_pro') return value;
  return null;
}

export function getDebugUserTierOverrideCached(): DebugUserTierOverride {
  return cachedOverride;
}

export async function hydrateDebugUserTierOverride(): Promise<DebugUserTierOverride> {
  if (hydrated) return cachedOverride;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(DEBUG_USER_TIER_OVERRIDE_KEY);
    cachedOverride = normalizeOverride(raw);
  } catch {
    cachedOverride = null;
  }
  return cachedOverride;
}

export async function setDebugUserTierOverride(value: DebugUserTierOverride): Promise<void> {
  cachedOverride = normalizeOverride(value);
  hydrated = true;
  try {
    if (cachedOverride) {
      await AsyncStorage.setItem(DEBUG_USER_TIER_OVERRIDE_KEY, cachedOverride);
    } else {
      await AsyncStorage.removeItem(DEBUG_USER_TIER_OVERRIDE_KEY);
    }
  } catch {
    /* best effort */
  }
}
