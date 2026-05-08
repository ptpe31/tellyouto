import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { withTrankilV2Database } from '../../api/trankilV2Db';
import { DistanceMatrixMapsService } from './DistanceMatrixMapsService';
import { TrafficSchedulerV4 } from './TrafficSchedulerV4';

const SENTINEL_BACKGROUND_TASK = 'TALKNDONE_SENTINEL_V4_BACKGROUND_TASK';

async function listActiveTripTaskIds(): Promise<string[]> {
  return withTrankilV2Database(async (db) => {
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM sentinel_trips WHERE status IN ('ACTIVE','ERROR')`,
    );
    return rows.map((r) => String(r.id || '').trim()).filter(Boolean);
  });
}

if (!TaskManager.isTaskDefined(SENTINEL_BACKGROUND_TASK)) {
  TaskManager.defineTask(SENTINEL_BACKGROUND_TASK, async () => {
    try {
      const ids = await listActiveTripTaskIds();
      if (!ids.length) return BackgroundFetch.BackgroundFetchResult.NoData;
      const maps = new DistanceMatrixMapsService();
      const scheduler = new TrafficSchedulerV4(maps, { disableTimers: true, disableRealScans: true });
      for (const id of ids.slice(0, 3)) {
        await scheduler.tickNow(id);
      }
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch {
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

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
      minimumInterval: 15 * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  }
}

