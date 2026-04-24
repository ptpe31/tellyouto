import type { IntentionRow } from '../api/localDb';
import { useCalendarIntegration } from '../context/CalendarIntegrationContext';
import type { FocusCapsuleMode } from '../navigation/types';
import { slotOverlapsBusyIntervals } from '../services/agentLogic';

/**
 * Hook **sans état serveur** : compare une session focus « maintenant » aux
 * intervalles occupés du calendrier connecté (contexte d’intégration local).
 *
 * @returns Objet `{ shouldWarnForLaunch }` : fonction utilitaire pour savoir
 *   s’il faut avertir l’utilisateur avant de lancer une capsule focus.
 */
export function useFocusCalendarConflict() {
  const { connectEnabled, busyIntervals } = useCalendarIntegration();

  /**
   * Indique si le lancement immédiat d’une capsule chevauche un créneau « busy ».
   *
   * @param mode — `pomodoro` (25 min) ou chrono basé sur `estimated_duration`.
   * @param intention — Intention SQLite source de la durée estimée.
   * @returns `true` si l’utilisateur devrait voir un message de conflit calendrier.
   */
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
