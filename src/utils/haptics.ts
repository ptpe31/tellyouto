import * as Haptics from 'expo-haptics';

import { Platform as RPlatform } from './rnPlatform';

export type HapticType = 'light' | 'medium' | 'success';

/** Haptique légère (touch T=0) — no-op sur web. */
export async function safeLightHaptic(): Promise<void> {
  try {
    if (RPlatform.OS === 'web') return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    /* ignore */
  }
}

/** Haptique medium (annulation / undo). */
export async function safeMediumHaptic(): Promise<void> {
  try {
    if (RPlatform.OS === 'web') return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    /* ignore */
  }
}

/** Haptique succès (validation). */
export async function safeSuccessHaptic(): Promise<void> {
  try {
    if (RPlatform.OS === 'web') return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    /* ignore */
  }
}

/** Dispatch haptique typé pour `PressableScale`. */
export async function safeHaptic(type: HapticType): Promise<void> {
  switch (type) {
    case 'light':
      await safeLightHaptic();
      break;
    case 'medium':
      await safeMediumHaptic();
      break;
    case 'success':
      await safeSuccessHaptic();
      break;
  }
}
