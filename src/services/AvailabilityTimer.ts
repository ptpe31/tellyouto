import AsyncStorage from '@react-native-async-storage/async-storage';

const ACTIVITY_START_KEY = 'trankil.availability.activity_start_ts';
const LAST_INTERACTION_KEY = 'trankil.availability.last_interaction_ts';
const LAST_NUDGE_KEY = 'trankil.availability.last_nudge_ts';

export const AVAILABILITY_TIMEOUT_MS = 20 * 60 * 1000;
const NUDGE_COOLDOWN_MS = 30 * 60 * 1000;

async function getNumber(key: string): Promise<number | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function markAppActiveStart(now = Date.now()): Promise<void> {
  const existing = await getNumber(ACTIVITY_START_KEY);
  if (!existing) {
    await AsyncStorage.setItem(ACTIVITY_START_KEY, String(now));
  }
  const lastInteraction = await getNumber(LAST_INTERACTION_KEY);
  if (!lastInteraction) {
    await AsyncStorage.setItem(LAST_INTERACTION_KEY, String(now));
  }
}

export async function recordAppInteraction(now = Date.now()): Promise<void> {
  await AsyncStorage.setItem(ACTIVITY_START_KEY, String(now));
  await AsyncStorage.setItem(LAST_INTERACTION_KEY, String(now));
}

export async function shouldTriggerAvailabilityNudge(now = Date.now()): Promise<boolean> {
  const [startTs, interactionTs, lastNudgeTs] = await Promise.all([
    getNumber(ACTIVITY_START_KEY),
    getNumber(LAST_INTERACTION_KEY),
    getNumber(LAST_NUDGE_KEY),
  ]);
  const ref = Math.max(startTs ?? 0, interactionTs ?? 0);
  if (!ref) return false;
  if (now - ref < AVAILABILITY_TIMEOUT_MS) return false;
  if (lastNudgeTs && now - lastNudgeTs < NUDGE_COOLDOWN_MS) return false;
  return true;
}

export async function markAvailabilityNudged(now = Date.now()): Promise<void> {
  await AsyncStorage.setItem(LAST_NUDGE_KEY, String(now));
  await AsyncStorage.setItem(LAST_INTERACTION_KEY, String(now));
}

