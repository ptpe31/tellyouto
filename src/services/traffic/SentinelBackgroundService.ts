import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { withTrankilV2Database } from '../../api/trankilV2Db';
import { getSentinelScheduler, startSentinelRuntime } from './sentinelRuntime';

const SENTINEL_BACKGROUND_TASK = 'TALKNDONE_SENTINEL_V4_BACKGROUND_TASK';

/** Marge OS : exécuter la sonde si son heure est passée ou dans la minute. */
const PROBE_DUE_GRACE_MS = 60_000;

async function listDueProbeTripTaskIds(nowMs: number): Promise<string[]> {
  const deadlineMs = nowMs + PROBE_DUE_GRACE_MS;
  return withTrankilV2Database(async (db) => {
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM sentinel_trips
       WHERE status = 'ACTIVE'
         AND next_real_scan_at_ms IS NOT NULL
         AND next_real_scan_at_ms <= ?
       ORDER BY next_real_scan_at_ms ASC
       LIMIT 3`,
      [deadlineMs],
    );
    return rows.map((r) => String(r.id || '').trim()).filter(Boolean);
  });
}

if (!TaskManager.isTaskDefined(SENTINEL_BACKGROUND_TASK)) {
  TaskManager.defineTask(SENTINEL_BACKGROUND_TASK, async () => {
    try {
      const nowMs = Date.now();
      const ids = await listDueProbeTripTaskIds(nowMs);
      if (!ids.length) {
        return BackgroundFetch.BackgroundFetchResult.NoData;
      }

      console.log(`[TRIP-SENTINEL] 🌙 Background wake — due probes: ${ids.join(', ')}`);
      const scheduler = getSentinelScheduler() ?? (await startSentinelRuntime());
      for (const id of ids) {
        await scheduler.tickNow(id);
      }
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch {
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

/**
 * Filet de sécurité OS uniquement (app tuée / suspendue).
 * Aucun polling : le handler ne fait un tick que si `next_real_scan_at_ms` est échu.
 * En foreground, les sondes sont programmées via `setTimeout` dans TrafficSchedulerV4.
 */
export async function configureSentinelBackgroundTask(): Promise<void> {
  if (Platform.OS === 'web') return;
  const status = await BackgroundFetch.getStatusAsync();
  if (
    status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
    status === BackgroundFetch.BackgroundFetchStatus.Denied
  ) {
    return;
  }
  const registered = await TaskManager.isTaskRegisteredAsync(SENTINEL_BACKGROUND_TASK);
  if (!registered) {
    await BackgroundFetch.registerTaskAsync(SENTINEL_BACKGROUND_TASK, {
      minimumInterval: 60 * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  }
}
