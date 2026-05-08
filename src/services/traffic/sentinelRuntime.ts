import { DistanceMatrixMapsService } from './DistanceMatrixMapsService';
import { TrafficSchedulerV4 } from './TrafficSchedulerV4';

let scheduler: TrafficSchedulerV4 | null = null;
let startPromise: Promise<TrafficSchedulerV4> | null = null;

export async function startSentinelRuntime(): Promise<TrafficSchedulerV4> {
  if (scheduler) return scheduler;
  if (startPromise) return startPromise;
  startPromise = (async () => {
    const maps = new DistanceMatrixMapsService();
    const s = new TrafficSchedulerV4(maps);
    await s.start();
    scheduler = s;
    return s;
  })();
  return startPromise;
}

export function getSentinelScheduler(): TrafficSchedulerV4 | null {
  return scheduler;
}

