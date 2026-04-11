import type { IntentionRow } from '../api/localDb';
import { useCalendarIntegration } from '../context/CalendarIntegrationContext';
import type { FocusCapsuleMode } from '../navigation/types';
import { slotOverlapsBusyIntervals } from '../services/agentLogic';

/**
 * Détecte si une session focus démarrée « maintenant » chevauche un créneau
 * calendrier (données locales uniquement).
 */
export function useFocusCalendarConflict() {
  const { connectEnabled, busyIntervals } = useCalendarIntegration();

  const shouldWarnForLaunch = (
    mode: FocusCapsuleMode,
    intention: IntentionRow,
  ): boolean => {
    if (!connectEnabled || busyIntervals.length === 0) return false;
    const now = new Date();
    const startM = now.getHours() * 60 + now.getMinutes();
    const dur =
      mode === 'pomodoro'
        ? 25
        : Math.max(1, Math.round(intention.estimated_duration));
    return slotOverlapsBusyIntervals(
      startM,
      startM + dur,
      busyIntervals,
    );
  };

  return { shouldWarnForLaunch };
}
