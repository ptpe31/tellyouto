import { getFirebaseApp } from '../api/firebase';
import { withLocalDatabase } from '../api/localDb';

import { getNotifications } from './notifications';

export type HealthWarningKey =
  | 'health.warnFirebase'
  | 'health.warnSqlite'
  | 'health.warnNotifications';

export type HealthCheckResult = {
  firebaseConfigured: boolean;
  sqliteOk: boolean;
  notificationsGranted: boolean;
  warnings: HealthWarningKey[];
};

/**
 * Vérifications légères au démarrage : config Firebase, SQLite, droits notifications.
 * Sous Expo Go, les notifications ne sont pas vérifiées (module non chargé — évite erreurs console).
 */
export async function runStartupHealthCheck(): Promise<HealthCheckResult> {
  const warnings: HealthWarningKey[] = [];

  const firebaseConfigured = getFirebaseApp() !== null;
  if (!firebaseConfigured) {
    warnings.push('health.warnFirebase');
  }

  let sqliteOk = false;
  try {
    sqliteOk = await withLocalDatabase(async (db) => {
      const row = await db.getFirstAsync<{ ok: number }>('SELECT 1 AS ok');
      return row?.ok === 1;
    });
  } catch {
    sqliteOk = false;
  }
  if (!sqliteOk) {
    warnings.push('health.warnSqlite');
  }

  let notificationsGranted = true;
  const n = getNotifications();
  if (n) {
    try {
      const { status } = await n.getPermissionsAsync();
      notificationsGranted = status === 'granted';
      if (!notificationsGranted) {
        warnings.push('health.warnNotifications');
      }
    } catch {
      notificationsGranted = false;
      warnings.push('health.warnNotifications');
    }
  }

  return {
    firebaseConfigured,
    sqliteOk,
    notificationsGranted,
    warnings,
  };
}
