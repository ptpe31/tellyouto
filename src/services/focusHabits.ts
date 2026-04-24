import AsyncStorage from '@react-native-async-storage/async-storage';

const QUICK_COMPLETE_STREAK_KEY = 'tellyouto/quick_complete_streak';
/** Après ce nombre de « Fait » sans ouvrir la capsule, l’Allié propose la Capsule. */
export const QUICK_COMPLETE_SUGGEST_THRESHOLD = 3;

export async function getQuickCompleteStreak(): Promise<number> {
  const v = await AsyncStorage.getItem(QUICK_COMPLETE_STREAK_KEY);
  if (v == null || v === '') return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function recordQuickCompleteWithoutCapsule(): Promise<void> {
  const n = await getQuickCompleteStreak();
  await AsyncStorage.setItem(
    QUICK_COMPLETE_STREAK_KEY,
    String(n + 1),
  );
}

/** Appelé à l’ouverture d’une session Capsule (chrono ou pomodoro). */
export async function resetQuickCompleteStreak(): Promise<void> {
  await AsyncStorage.removeItem(QUICK_COMPLETE_STREAK_KEY);
}
