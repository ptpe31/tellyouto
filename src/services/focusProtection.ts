/**
 * Simulation du mode Protection (Capsule active).
 * Remplace par des appels réels à expo-notifications (canaux, désactivation temporaire, etc.).
 */
export function simulatedSetNotificationSuppression(active: boolean): void {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.info(
      `[TellYouTo] Focus protection: notifications ${active ? 'supprimées (simulation)' : 'rétablies'}`,
    );
  }
}
