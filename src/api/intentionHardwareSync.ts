/**
 * Couche unique SQLite ↔ matériel (Expo Notifications / rail).
 *
 * Toute mutation d’intention qui peut changer créneau, alarme ou ancrage doit se terminer par
 * `syncNativeRailAlarmsAfterIntentionWrite` pour recalculer les notifications natives.
 *
 * Ne pas appeler depuis `setIntentionLocalNotificationId` (écriture déclenchée par alarmManager → risque de boucle).
 */

export async function syncNativeRailAlarmsAfterIntentionWrite(
  reason?: string,
): Promise<void> {
  try {
    const { refreshRailAlarmsAfterLocalDbChange } = await import(
      '../services/alarmManager'
    );
    await refreshRailAlarmsAfterLocalDbChange();
  } catch (e) {
    if (__DEV__) {
      console.warn(
        `[TellYouTo] intentionHardwareSync${reason ? ` ← ${reason}` : ''}`,
        e,
      );
    }
  }
}
