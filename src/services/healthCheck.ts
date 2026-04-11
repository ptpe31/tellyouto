import * as Notifications from 'expo-notifications';

import { getFirebaseApp } from '../api/firebase';
import { getLocalDatabase } from '../api/localDb';

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
 */
export async function runStartupHealthCheck(): Promise<HealthCheckResult> {
  const warnings: HealthWarningKey[] = [];

  const firebaseConfigured = getFirebaseApp() !== null;
  if (!firebaseConfigured) {
    warnings.push('health.warnFirebase');
  }

  let sqliteOk = false;
  try {
    const db = await getLocalDatabase();
    const row = await db.getFirstAsync<{ ok: number }>('SELECT 1 AS ok');
    sqliteOk = row?.ok === 1;
  } catch {
    sqliteOk = false;
  }
  if (!sqliteOk) {
    warnings.push('health.warnSqlite');
  }

  let notificationsGranted = false;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    notificationsGranted = status === 'granted';
  } catch {
    notificationsGranted = false;
  }
  if (!notificationsGranted) {
    warnings.push('health.warnNotifications');
  }

  return {
    firebaseConfigured,
    sqliteOk,
    notificationsGranted,
    warnings,
  };
}
