import { kickSentinelAfterActivation } from './sentinelActivation';

const DEFAULT_RETRY_MS = 30_000;

const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleSentinelRecovery(
  intentionId: string,
  reason: string,
  retryMs: number = DEFAULT_RETRY_MS,
): void {
  const id = String(intentionId || '').trim();
  if (!id) return;

  const existing = retryTimers.get(id);
  if (existing) clearTimeout(existing);

  console.warn(
    `[TRIP-SENTINEL-RECOVERY] Scheduling retry in ${retryMs}ms for ${id} (${reason})`,
  );

  const timer = setTimeout(() => {
    retryTimers.delete(id);
    void (async () => {
      try {
        console.log(`[TRIP-SENTINEL-RECOVERY] Retrying Sentinel for ${id} (${reason})`);
        await kickSentinelAfterActivation(id);
      } catch (err) {
        console.warn(`[TRIP-SENTINEL-RECOVERY] Retry failed for ${id}:`, err);
      }
    })();
  }, retryMs);

  retryTimers.set(id, timer);
}

export async function withSentinelDbRetry<T>(
  label: string,
  intentionId: string,
  fn: () => Promise<T>,
  opts?: { retryMs?: number; rethrow?: boolean },
): Promise<T | null> {
  const id = String(intentionId || '').trim();
  try {
    return await fn();
  } catch (err) {
    console.warn(`[TRIP-SENTINEL-RECOVERY] ${label} failed for ${id}:`, err);
    scheduleSentinelRecovery(id, label, opts?.retryMs ?? DEFAULT_RETRY_MS);
    if (opts?.rethrow) throw err;
    return null;
  }
}
