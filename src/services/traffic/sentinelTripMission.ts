import { getTrankilV2IntentionById, patchMetadata, withTrankilV2Database } from '../../api/trankilV2Db';
import { getSentinelScheduler } from './sentinelRuntime';

function safeParseTripMeta(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const meta = JSON.parse(raw) as Record<string, unknown>;
    const trip = meta.trip;
    if (!trip || typeof trip !== 'object' || Array.isArray(trip)) return null;
    return trip as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Annule timers scheduler + sondes PROBE2/PROBE3 planifiées pour ce TRIP. */
export async function cancelTripMission(intentionId: string): Promise<void> {
  const id = String(intentionId || '').trim();
  if (!id) return;

  const scheduler = getSentinelScheduler();
  if (scheduler) {
    await scheduler.cancelTask(id);
  }

  const nowMs = Date.now();
  await withTrankilV2Database(async (db) => {
    await db.runAsync(
      `UPDATE sentinel_trips SET
        status = 'PAUSED',
        next_real_scan_at_ms = NULL,
        next_real_scan_reason = NULL,
        scan_count = 0,
        scan2_at_ms = NULL,
        scan2_duration_sec = NULL,
        updated_at = ?
      WHERE id = ?`,
      [nowMs, id],
    );
  });

  console.log(`[TRIP-SENTINEL] 🛑 Mission cancelled for ${id}`);
}

export async function clearTripElasticProbeMetadata(intentionId: string): Promise<void> {
  const id = String(intentionId || '').trim();
  if (!id) return;
  const row = await getTrankilV2IntentionById(id);
  if (!row) return;
  const trip = safeParseTripMeta(row.metadata_json);
  if (!trip) return;

  await patchMetadata(
    id,
    {
      trip: {
        ...trip,
        standard_duration_min: null,
        elastic_approximate: null,
        elastic_shifted: null,
        elastic_start_ms: null,
        elastic_end_ms: null,
        elastic_buffer_min: null,
        last_traffic_duration: null,
      },
    },
    { silent: true },
  );
}
