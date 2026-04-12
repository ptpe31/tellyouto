/**
 * Couche unique **SQLite → matériel** (Expo Notifications / rail).
 *
 * **Pourquoi** : centraliser le « rafraîchir les alarmes » évite d’oublier une étape après un `INSERT`
 * et garantit que le téléphone reste aligné sur la base locale.
 *
 * **Quand appeler** : après toute mutation d’intention pouvant changer créneau, alarme ou ancrage.
 *
 * **Quand ne pas appeler** : depuis {@link setIntentionLocalNotificationId} (écriture déclenchée par
 * `alarmManager` → risque de boucle infinie).
 *
 * @param reason Chaîne de diagnostic optionnelle (logs dev).
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
