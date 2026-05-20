import { withTrankilV2Database, insertUserActivityLog } from '../../api/trankilV2Db';
import { VERBOSE_DEBUG } from '../../config/verboseDebug';
import { clearAllDepartureNotifications, syncDepartureContractForIntention } from '../NotificationService';
import { SentinelNotificationManager } from './TrafficNotificationService';
import type { ElasticProbeReason } from './sentinelElasticProbes';
import { loadTripMetaForIntention, syncTripProbeScheduleMetadata } from './sentinelElasticTripMetadata';
import { ensureSentinelTripsSchema } from './sentinelActivation';
import { runElasticSchedulerTick } from './trafficSchedulerElasticTick';

export type TrafficTaskStatus = 'ACTIVE' | 'PAUSED' | 'DONE' | 'ERROR';

export type ScanReason = ElasticProbeReason;
export type FlowMode = 'REAL' | 'SCHEDULED';

export type TripTaskRowV4 = {
  id: string;
  destination: string;
  arrivalAtMs: number;
  status: TrafficTaskStatus;
  sentinelMode: 'SENTINEL' | 'STATIC';
  lastTrafficDuration: number;
  tOptimisteMs: number | null;
  tPessimisteMs: number | null;
  transportMode: string | null;
  destLat: number | null;
  destLng: number | null;
  originLat: number | null;
  originLng: number | null;
  fingerprint: string | null;
  stateVersion: number;
  scanCount: number;
  flowCalibrated: boolean;
  vFlowSecPerMin: number;
  lastRealScanAtMs: number | null;
  scan1AtMs: number | null;
  scan1DurationSec: number | null;
  scan2AtMs: number | null;
  scan2DurationSec: number | null;
  baseTOptimisteMs: number | null;
  baseTPessimisteMs: number | null;
  internalTPessimisteMs: number | null;
  displayedTOptimisteMs: number | null;
  displayedTPessimisteMs: number | null;
  lastUiUpdateAtMs: number | null;
  vigilanceStatus: string | null;
  modeSafety: boolean;
  nextRealScanAtMs: number | null;
  nextRealScanReason: string | null;
  apiCallsTotal: number;
  apiCallsAvoidedCache: number;
  apiCallsAvoidedExtrapolation: number;
  lastErrorAt: number | null;
};

export type TrafficSample = {
  trafficDurationSec: number;
  staticDurationSec?: number;
  /** Distance route (mètres) — fallback T_ideal à 50 km/h. */
  distanceM?: number;
  fromCache?: boolean;
  cacheKey?: string;
  latencyMs?: number;
};

export type FetchTrafficSampleOptions = {
  departureTimeUnix?: number;
};

export type MapsService = {
  fetchTrafficSample(
    task: TripTaskRowV4,
    opts?: FetchTrafficSampleOptions,
  ): Promise<TrafficSample>;
};

type TickResult = {
  patch: Partial<TripTaskRowV4>;
  ui: null | {
    stateVersion: number;
    displayedStartMs: number;
    displayedEndMs: number;
    internalStartMs: number;
    internalEndMs: number;
    flowMode: FlowMode;
    vFlowSecPerMin: number;
    nextRealScanAtMs: number | null;
    nextRealScanReason: string | null;
    apiCallsTotal: number;
    apiCallsAvoidedCache: number;
    apiCallsAvoidedExtrapolation: number;
  };
  trace: {
    displayedStartMs: number | null;
    displayedEndMs: number | null;
    internalStartMs: number;
    internalEndMs: number;
    flowMode: FlowMode;
    vFlowSecPerMin: number;
    nextRealScanAtMs: number | null;
    nextRealScanReason: string | null;
    apiCallsTotal: number;
    apiCallsAvoidedCache: number;
    apiCallsAvoidedExtrapolation: number;
  };
  traceForce: boolean;
  done: boolean;
  goNoGo?: { variant: 'smooth' | 'leave_now'; departInMin: number } | null;
  probe3Unavailable?: { destination: string } | null;
};

function fmtHm(ms: number): string {
  if (!Number.isFinite(Number(ms))) return '--:--';
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function computeFingerprint(task: TripTaskRowV4): string {
  const dLat = task.destLat == null ? 'na' : String(Math.round(task.destLat * 10_000) / 10_000);
  const dLng = task.destLng == null ? 'na' : String(Math.round(task.destLng * 10_000) / 10_000);
  const mode = String(task.transportMode || 'driving');
  return `${dLat},${dLng}|${Math.round(task.arrivalAtMs)}|${mode}`;
}

export class TrafficSchedulerV4 {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly tableName = 'sentinel_trips';
  private readonly notificationManager = new SentinelNotificationManager();
  private readonly lastTraceAtByTrip = new Map<string, number>();

  constructor(
    private readonly mapsService: MapsService,
    private readonly options?: { disableTimers?: boolean; disableRealScans?: boolean },
  ) {}

  async start(): Promise<void> {
    await this.ensureSchema();
    const tasks = await this.listActiveTasks();
    for (const task of tasks) {
      await this.planNext(task);
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  async tickNow(taskId: string): Promise<void> {
    await this.runTick(taskId);
  }

  async refreshTask(taskId: string): Promise<void> {
    const task = await this.getTaskById(taskId);
    if (!task) return;
    if (task.status === 'ACTIVE') {
      await this.planNext(task);
      return;
    }
    this.clearTimer(taskId);
    await this.notificationManager.cancel(taskId);
    await clearAllDepartureNotifications(taskId);
  }

  async cancelTask(taskId: string): Promise<void> {
    this.clearTimer(taskId);
    await this.notificationManager.cancel(taskId);
    await clearAllDepartureNotifications(taskId);
  }

  private async syncDepartureNotifications(taskId: string, destination: string): Promise<void> {
    const tripMeta = await loadTripMetaForIntention(taskId);
    const trip =
      tripMeta && typeof tripMeta === 'object' && !Array.isArray(tripMeta)
        ? (tripMeta as Record<string, unknown>)
        : null;
    await syncDepartureContractForIntention(taskId, {
      destination,
      trip,
      nowMs: Date.now(),
    });
  }

  private async runTick(taskId: string): Promise<void> {
    const wallNowMs = Date.now();
    const task = await this.getTaskById(taskId);
    if (!task || task.status !== 'ACTIVE') return;

    const result = await this.computeTick(task, wallNowMs);
    if (Object.keys(result.patch).length > 0) {
      await this.persistPatch(taskId, result.patch);
      if (
        result.patch.nextRealScanAtMs !== undefined ||
        result.patch.nextRealScanReason !== undefined
      ) {
        const synced = await this.getTaskById(taskId);
        const { withSentinelDbRetry } = await import('./sentinelDbRetry');
        await withSentinelDbRetry('sync probe schedule after tick', taskId, () =>
          syncTripProbeScheduleMetadata(
            taskId,
            synced?.nextRealScanAtMs ?? null,
            synced?.nextRealScanReason ?? null,
          ),
        );
      }
    }
    if (result.goNoGo) {
      await this.notificationManager.sendGoNoGoPush({
        tripTaskId: taskId,
        destination: task.destination,
        variant: result.goNoGo.variant,
        departInMin: result.goNoGo.departInMin,
        lat: task.destLat ?? undefined,
        lng: task.destLng ?? undefined,
      });
    }
    if (result.probe3Unavailable) {
      await this.notificationManager.sendProbeUnavailablePush({
        tripTaskId: taskId,
        destination: result.probe3Unavailable.destination,
      });
    }
    await this.trace(task, result.trace, wallNowMs, result.traceForce);
    if (result.done) {
      await this.notificationManager.cancel(taskId);
      await clearAllDepartureNotifications(taskId);
      this.clearTimer(taskId);
      return;
    }

    await this.syncDepartureNotifications(taskId, task.destination);

    const refreshed = await this.getTaskById(taskId);
    if (refreshed && refreshed.status === 'ACTIVE') await this.planNext(refreshed);
  }

  private async computeTick(task: TripTaskRowV4, nowMs: number): Promise<TickResult> {
    const tripMeta = await loadTripMetaForIntention(task.id);
    const elastic = await runElasticSchedulerTick({
      task,
      tripMeta,
      nowMs,
      mapsService: this.mapsService,
      disableRealScans: this.options?.disableRealScans,
    });
    return {
      patch: elastic.patch,
      ui: null,
      goNoGo: elastic.goNoGo,
      probe3Unavailable: elastic.probe3Unavailable,
      trace: elastic.trace,
      traceForce: elastic.traceForce,
      done: elastic.done,
    };
  }

  private async planNext(task: TripTaskRowV4): Promise<void> {
    if (this.options?.disableTimers === true) return;
    const nowMs = Date.now();
    if (task.status !== 'ACTIVE') return;
    const nextAt = task.nextRealScanAtMs;
    if (nextAt == null) return;
    const delay = Math.max(250, nextAt - nowMs);
    this.clearTimer(task.id);
    const timer = setTimeout(() => {
      void this.runTick(task.id);
    }, delay);
    this.timers.set(task.id, timer);
  }

  private clearTimer(taskId: string): void {
    const t = this.timers.get(taskId);
    if (t) clearTimeout(t);
    this.timers.delete(taskId);
  }

  private async ensureSchema(): Promise<void> {
    await ensureSentinelTripsSchema();
  }

  private async listActiveTasks(): Promise<TripTaskRowV4[]> {
    return withTrankilV2Database(async (db) => {
      const rows = await db.getAllAsync<Record<string, unknown>>(
        `SELECT * FROM ${this.tableName} WHERE status IN ('ACTIVE','ERROR')`,
      );
      return rows.map(this.rowToTask);
    });
  }

  private async getTaskById(taskId: string): Promise<TripTaskRowV4 | null> {
    return withTrankilV2Database(async (db) => {
      const row = await db.getFirstAsync<Record<string, unknown>>(
        `SELECT * FROM ${this.tableName} WHERE id = ?`,
        [taskId],
      );
      return row ? this.rowToTask(row) : null;
    });
  }

  private async persistPatch(taskId: string, patch: Partial<TripTaskRowV4>): Promise<void> {
    const cols: Array<[string, unknown]> = [];
    const add = (col: string, v: unknown) => cols.push([col, v]);
    if (patch.status != null) add('status', patch.status);
    if (patch.sentinelMode != null) add('sentinel_mode', patch.sentinelMode);
    if (patch.lastTrafficDuration != null) add('last_traffic_duration', patch.lastTrafficDuration);
    if (patch.tOptimisteMs !== undefined) add('t_optimiste_ms', patch.tOptimisteMs);
    if (patch.tPessimisteMs !== undefined) add('t_pessimiste_ms', patch.tPessimisteMs);
    if (patch.internalTPessimisteMs !== undefined) add('internal_t_pessimiste_ms', patch.internalTPessimisteMs);
    if (patch.baseTOptimisteMs !== undefined) add('base_t_optimiste_ms', patch.baseTOptimisteMs);
    if (patch.baseTPessimisteMs !== undefined) add('base_t_pessimiste_ms', patch.baseTPessimisteMs);
    if (patch.vigilanceStatus !== undefined) add('vigilance_status', patch.vigilanceStatus);
    if (patch.lastErrorAt !== undefined) add('last_error_at', patch.lastErrorAt);
    if (patch.stateVersion !== undefined) add('state_version', patch.stateVersion);
    if (patch.fingerprint !== undefined) add('fingerprint', patch.fingerprint);
    if (patch.scanCount !== undefined) add('scan_count', patch.scanCount);
    if (patch.flowCalibrated !== undefined) add('flow_calibrated', patch.flowCalibrated ? 1 : 0);
    if (patch.vFlowSecPerMin !== undefined) add('v_flow_sec_per_min', patch.vFlowSecPerMin);
    if (patch.lastRealScanAtMs !== undefined) add('last_real_scan_at_ms', patch.lastRealScanAtMs);
    if (patch.scan1AtMs !== undefined) add('scan1_at_ms', patch.scan1AtMs);
    if (patch.scan1DurationSec !== undefined) add('scan1_duration_sec', patch.scan1DurationSec);
    if (patch.scan2AtMs !== undefined) add('scan2_at_ms', patch.scan2AtMs);
    if (patch.scan2DurationSec !== undefined) add('scan2_duration_sec', patch.scan2DurationSec);
    if (patch.displayedTOptimisteMs !== undefined) add('displayed_t_optimiste_ms', patch.displayedTOptimisteMs);
    if (patch.displayedTPessimisteMs !== undefined) add('displayed_t_pessimiste_ms', patch.displayedTPessimisteMs);
    if (patch.lastUiUpdateAtMs !== undefined) add('last_ui_update_at_ms', patch.lastUiUpdateAtMs);
    if (patch.modeSafety !== undefined) add('mode_safety', patch.modeSafety ? 1 : 0);
    if (patch.nextRealScanAtMs !== undefined) add('next_real_scan_at_ms', patch.nextRealScanAtMs);
    if (patch.nextRealScanReason !== undefined) add('next_real_scan_reason', patch.nextRealScanReason);
    if (patch.apiCallsTotal !== undefined) add('api_calls_total', patch.apiCallsTotal);
    if (patch.apiCallsAvoidedCache !== undefined) add('api_calls_avoided_cache', patch.apiCallsAvoidedCache);
    if (patch.apiCallsAvoidedExtrapolation !== undefined)
      add('api_calls_avoided_extrapolation', patch.apiCallsAvoidedExtrapolation);
    if (patch.originLat !== undefined) add('origin_lat', patch.originLat);
    if (patch.originLng !== undefined) add('origin_lng', patch.originLng);
    if (patch.destLat !== undefined) add('dest_lat', patch.destLat);
    if (patch.destLng !== undefined) add('dest_lng', patch.destLng);
    if (patch.transportMode !== undefined) add('transport_mode', patch.transportMode);
    if (cols.length === 0) return;
    const sets = cols.map(([c]) => `${c} = ?`).join(', ');
    const values = cols.map(([, v]) => v);
    await withTrankilV2Database(async (db) => {
      await db.runAsync(
        `UPDATE ${this.tableName} SET ${sets} WHERE id = ?`,
        [...values, taskId] as any[],
      );
    });
  }

  private rowToTask = (row: Record<string, unknown>): TripTaskRowV4 => ({
    id: String(row.id ?? ''),
    destination: String(row.destination ?? ''),
    arrivalAtMs: Number(row.arrival_at_ms ?? 0),
    status: String(row.status ?? 'PAUSED') as TrafficTaskStatus,
    sentinelMode:
      String(row.sentinel_mode ?? 'SENTINEL').toUpperCase() === 'STATIC' ? 'STATIC' : 'SENTINEL',
    lastTrafficDuration: Number(row.last_traffic_duration ?? 0),
    tOptimisteMs: row.t_optimiste_ms == null ? null : Number(row.t_optimiste_ms),
    tPessimisteMs: row.t_pessimiste_ms == null ? null : Number(row.t_pessimiste_ms),
    transportMode: row.transport_mode == null ? null : String(row.transport_mode),
    destLat: row.dest_lat == null ? null : Number(row.dest_lat),
    destLng: row.dest_lng == null ? null : Number(row.dest_lng),
    originLat: row.origin_lat == null ? null : Number(row.origin_lat),
    originLng: row.origin_lng == null ? null : Number(row.origin_lng),
    fingerprint: row.fingerprint == null ? null : String(row.fingerprint),
    stateVersion: Number(row.state_version ?? 0),
    scanCount: Number(row.scan_count ?? 0),
    flowCalibrated: Number(row.flow_calibrated ?? 0) === 1,
    vFlowSecPerMin: Number(row.v_flow_sec_per_min ?? 10),
    lastRealScanAtMs: row.last_real_scan_at_ms == null ? null : Number(row.last_real_scan_at_ms),
    scan1AtMs: row.scan1_at_ms == null ? null : Number(row.scan1_at_ms),
    scan1DurationSec: row.scan1_duration_sec == null ? null : Number(row.scan1_duration_sec),
    scan2AtMs: row.scan2_at_ms == null ? null : Number(row.scan2_at_ms),
    scan2DurationSec: row.scan2_duration_sec == null ? null : Number(row.scan2_duration_sec),
    baseTOptimisteMs: row.base_t_optimiste_ms == null ? null : Number(row.base_t_optimiste_ms),
    baseTPessimisteMs: row.base_t_pessimiste_ms == null ? null : Number(row.base_t_pessimiste_ms),
    internalTPessimisteMs:
      row.internal_t_pessimiste_ms == null ? null : Number(row.internal_t_pessimiste_ms),
    displayedTOptimisteMs:
      row.displayed_t_optimiste_ms == null ? null : Number(row.displayed_t_optimiste_ms),
    displayedTPessimisteMs:
      row.displayed_t_pessimiste_ms == null ? null : Number(row.displayed_t_pessimiste_ms),
    lastUiUpdateAtMs: row.last_ui_update_at_ms == null ? null : Number(row.last_ui_update_at_ms),
    vigilanceStatus: row.vigilance_status == null ? null : String(row.vigilance_status),
    modeSafety: Number(row.mode_safety ?? 0) === 1,
    nextRealScanAtMs: row.next_real_scan_at_ms == null ? null : Number(row.next_real_scan_at_ms),
    nextRealScanReason: row.next_real_scan_reason == null ? null : String(row.next_real_scan_reason),
    apiCallsTotal: Number(row.api_calls_total ?? 0),
    apiCallsAvoidedCache: Number(row.api_calls_avoided_cache ?? 0),
    apiCallsAvoidedExtrapolation: Number(row.api_calls_avoided_extrapolation ?? 0),
    lastErrorAt: row.last_error_at == null ? null : Number(row.last_error_at),
  });

  private async trace(
    task: TripTaskRowV4,
    trace: TickResult['trace'],
    nowMs: number,
    force: boolean,
  ): Promise<void> {
    const lastAt = this.lastTraceAtByTrip.get(task.id) ?? 0;
    const shouldPersist = VERBOSE_DEBUG || force || nowMs - lastAt >= 10 * 60_000;
    if (!shouldPersist) return;
    this.lastTraceAtByTrip.set(task.id, nowMs);
    const payload = {
      tripTaskId: task.id,
      uiWindow:
        trace.displayedStartMs != null && trace.displayedEndMs != null
          ? `${fmtHm(trace.displayedStartMs)}-${fmtHm(trace.displayedEndMs)}`
          : null,
      internalWindow: `${fmtHm(trace.internalStartMs)}-${fmtHm(trace.internalEndMs)}`,
      vFlowSecPerMin: trace.vFlowSecPerMin,
      flowMode: trace.flowMode,
      nextRealScanAt: trace.nextRealScanAtMs ? fmtHm(trace.nextRealScanAtMs) : null,
      nextRealScanReason: trace.nextRealScanReason,
      apiCallsTotal: trace.apiCallsTotal,
      apiCallsAvoidedCache: trace.apiCallsAvoidedCache,
      apiCallsAvoidedExtrapolation: trace.apiCallsAvoidedExtrapolation,
    };
    if (VERBOSE_DEBUG) {
      console.log('[SENTINEL_V4][trace]', payload);
    }
    try {
      await insertUserActivityLog({
        action_type: 'SENTINEL_TRACE',
        points_delta: 0,
        created_at: nowMs,
        meta_json: JSON.stringify(payload),
      });
    } catch {}
  }
}
