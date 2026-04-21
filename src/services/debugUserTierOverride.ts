import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';

/**
 * Surcharge locale du statut Pro pour tests (quota, paywall) — persistante AsyncStorage.
 * @see {@link DEBUG_USER_TIER_OVERRIDE_CHANGED} — rafraîchissement UI immédiat.
 */
export const DEBUG_USER_TIER_OVERRIDE_KEY = '@tellyouto/is_pro_simulated';

export const DEBUG_USER_TIER_OVERRIDE_CHANGED = 'debugUserTierOverrideChanged';

export type DebugUserTierOverride = 'none' | 'force_free' | 'force_pro';

let cached: DebugUserTierOverride = 'none';

export function getDebugUserTierOverrideCached(): DebugUserTierOverride {
  return cached;
}

function normalize(raw: string | null): DebugUserTierOverride {
  if (raw === 'force_free' || raw === 'force_pro') return raw;
  return 'none';
}

export async function readDebugUserTierOverride(): Promise<DebugUserTierOverride> {
  const raw = await AsyncStorage.getItem(DEBUG_USER_TIER_OVERRIDE_KEY);
  cached = normalize(raw);
  return cached;
}

export async function writeDebugUserTierOverride(value: DebugUserTierOverride): Promise<void> {
  cached = value;
  if (value === 'none') {
    await AsyncStorage.removeItem(DEBUG_USER_TIER_OVERRIDE_KEY);
  } else {
    await AsyncStorage.setItem(DEBUG_USER_TIER_OVERRIDE_KEY, value);
  }
  DeviceEventEmitter.emit(DEBUG_USER_TIER_OVERRIDE_CHANGED, value);
}
