import { withTrankilV2Database, insertUserActivityLog } from '../../api/trankilV2Db';
import { VERBOSE_DEBUG } from '../../config/verboseDebug';
import i18n from '../../locales/i18n';
import { computeNewtonWindow } from './TrafficEngine';
import { getForegroundOriginSnapshot } from './SentinelLocationService';
import { SentinelNotificationManager } from './TrafficNotificationService';

export const INNER_SAFETY_MARGIN_SEC = 300;
export const CRITICAL_BUFFER_MIN = 5;
export const INTERNAL_TICK_MS = 60_000;
export const UI_LAZY_DRIFT_MS = 5 * 60 * 1000;
export const VFLOW_INIT_SEC_PER_MIN = 10;
export const VFLOW_CAP_SEC_PER_MIN = 30;
export const CACHE_TTL_MS = 15 * 60 * 1000;

export type TrafficTaskStatus = 'ACTIVE' | 'PAUSED' | 'DONE' | 'ERROR';

export type ScanReason = 'SCAN1_INITIAL' | 'SCAN2_ENTRY_ORANGE' | 'SCAN2_RETRY' | 'SCAN3_CRITICAL';
export type FlowMode = 'REAL' | 'EXTRAPOLATED';

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
  fromCache?: boolean;
  cacheKey?: string;
  latencyMs?: number;
};

export type MapsService = {
  fetchTrafficSample(task: TripTaskRowV4): Promise<TrafficSample>;
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
};

function fmtHm(ms: number): string {
  if (!Number.isFinite(Number(ms))) return '--:--';
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function computeFingerprint(task: TripTaskRowV4): string {
  const dLat = task.destLat == null ? 'na' : String(Math.round(task.destLat * 10_000) / 10_000);
  const dLng = task.destLng == null ? 'na' : String(Math.round(task.destLng * 10_000) / 10_000);
  const mode = String(task.transportMode || 'driving');
  return `${dLat},${dLng}|${Math.round(task.arrivalAtMs)}|${mode}`;
}

function computeCriticalDepartureAtMs(arrivalAtMs: number, stabilizedTrafficSec: number): number {
  return arrivalAtMs - (Math.max(0, stabilizedTrafficSec) + INNER_SAFETY_MARGIN_SEC) * 1000;
}

function shouldUpdateUi(params: {
  scanHappened: boolean;
  criticalBreak: boolean;
  displayedStartMs: number | null;
  displayedEndMs: number | null;
  internalStartMs: number;
  internalEndMs: number;
}): boolean {
  if (params.scanHappened) return true;
  if (params.criticalBreak) return true;
  if (params.displayedStartMs == null || params.displayedEndMs == null) return true;
  const drift = Math.max(
    Math.abs(params.displayedStartMs - params.internalStartMs),
    Math.abs(params.displayedEndMs - params.internalEndMs),
  );
  return drift >= UI_LAZY_DRIFT_MS;
}

function predictScan3AtMs(params: {
  scan2AtMs: number;
  baseTPessimisteMs: number;
  vFlowSecPerMin: number;
  nowMs: number;
}): number | null {
  const denom = 60_000 + Math.max(0, params.vFlowSecPerMin) * 1000;
  const numer = params.baseTPessimisteMs - params.scan2AtMs - CRITICAL_BUFFER_MIN * 60_000;
  if (!Number.isFinite(numer) || numer <= 0) return params.nowMs;
  const x = numer / denom;
  if (!Number.isFinite(x) || x <= 0) return params.nowMs;
  return Math.max(params.nowMs, Math.round(params.scan2AtMs + x * 60_000));
}

async function tryAddColumn(db: { execAsync: (sql: string) => Promise<void> }, sql: string) {
  try {
    await db.execAsync(sql);
  } catch {}
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
  }

  async cancelTask(taskId: string): Promise<void> {
    this.clearTimer(taskId);
    await this.notificationManager.cancel(taskId);
  }

  private async runTick(taskId: string): Promise<void> {
    const wallNowMs = Date.now();
    const task = await this.getTaskById(taskId);
    if (!task || task.status !== 'ACTIVE') return;

    const result = await this.computeTick(task, wallNowMs);
    if (Object.keys(result.patch).length > 0) {
      await this.persistPatch(taskId, result.patch);
    }
    if (result.ui) {
      const vigilance = String(result.patch.vigilanceStatus ?? task.vigilanceStatus ?? 'VIGILANCE_BLUE');
      const safety = Boolean(result.patch.modeSafety ?? task.modeSafety);
      const trafficLabel =
        task.sentinelMode === 'STATIC'
          ? i18n.t('sentinel.notifStatusStatic')
          : vigilance === 'VIGILANCE_ORANGE'
            ? i18n.t('sentinel.notifStatusOrange')
            : vigilance === 'VIGILANCE_RED'
              ? i18n.t('sentinel.notifStatusRed')
              : i18n.t('sentinel.notifStatusBlue');
      await this.notificationManager.update({
        tripTaskId: taskId,
        stateVersion: result.ui.stateVersion,
        destination: task.destination,
        targetArrivalMs: task.arrivalAtMs,
        nowMs: wallNowMs,
        tOptimisteMs: result.ui.internalStartMs,
        displayedWindowStartMs: result.ui.displayedStartMs,
        displayedWindowEndMs: result.ui.displayedEndMs,
        nextRealUpdateAtMs: result.ui.nextRealScanAtMs,
        vigilanceStatus: vigilance,
        trafficLabel,
        lat: task.destLat ?? undefined,
        lng: task.destLng ?? undefined,
        modeSafety: safety,
      });
    }
    await this.trace(task, result.trace, wallNowMs, result.traceForce);
    if (result.done) {
      await this.notificationManager.cancel(taskId);
      this.clearTimer(taskId);
      return;
    }

    const refreshed = await this.getTaskById(taskId);
    if (refreshed && refreshed.status === 'ACTIVE') await this.planNext(refreshed);
  }

  private async computeTick(task: TripTaskRowV4, nowMs: number): Promise<TickResult> {
    const patch: Partial<TripTaskRowV4> = {};

    if (nowMs >= task.arrivalAtMs) {
      patch.status = 'DONE';
      patch.vigilanceStatus = 'FINISHED';
      patch.nextRealScanAtMs = null;
      patch.nextRealScanReason = null;
      return {
        patch,
        ui: null,
        trace: {
          displayedStartMs: task.displayedTOptimisteMs,
          displayedEndMs: task.displayedTPessimisteMs,
          internalStartMs: task.displayedTOptimisteMs ?? nowMs,
          internalEndMs: task.displayedTPessimisteMs ?? nowMs,
          flowMode: 'EXTRAPOLATED',
          vFlowSecPerMin: task.vFlowSecPerMin,
          nextRealScanAtMs: null,
          nextRealScanReason: null,
          apiCallsTotal: task.apiCallsTotal,
          apiCallsAvoidedCache: task.apiCallsAvoidedCache,
          apiCallsAvoidedExtrapolation: task.apiCallsAvoidedExtrapolation,
        },
        traceForce: true,
        done: true,
      };
    }

    const computedFp = computeFingerprint(task);
    const storedFp = String(task.fingerprint || '');
    if (!storedFp || storedFp !== computedFp) {
      patch.fingerprint = computedFp;
      patch.scanCount = 0;
      patch.flowCalibrated = false;
      patch.vFlowSecPerMin = VFLOW_INIT_SEC_PER_MIN;
      patch.lastRealScanAtMs = null;
      patch.scan1AtMs = null;
      patch.scan1DurationSec = null;
      patch.scan2AtMs = null;
      patch.scan2DurationSec = null;
      patch.baseTOptimisteMs = null;
      patch.baseTPessimisteMs = null;
      patch.internalTPessimisteMs = null;
      patch.nextRealScanAtMs = nowMs;
      patch.nextRealScanReason = 'SCAN1_INITIAL';
      patch.modeSafety = false;
      patch.lastErrorAt = null;
      patch.stateVersion = task.stateVersion + 1;
      return {
        patch,
        ui: {
          stateVersion: patch.stateVersion,
          displayedStartMs: task.displayedTOptimisteMs ?? nowMs,
          displayedEndMs: task.displayedTPessimisteMs ?? nowMs,
          internalStartMs: task.displayedTOptimisteMs ?? nowMs,
          internalEndMs: task.displayedTPessimisteMs ?? nowMs,
          flowMode: 'EXTRAPOLATED',
          vFlowSecPerMin: patch.vFlowSecPerMin,
          nextRealScanAtMs: nowMs,
          nextRealScanReason: patch.nextRealScanReason,
          apiCallsTotal: task.apiCallsTotal,
          apiCallsAvoidedCache: task.apiCallsAvoidedCache,
          apiCallsAvoidedExtrapolation: task.apiCallsAvoidedExtrapolation,
        },
        trace: {
          displayedStartMs: task.displayedTOptimisteMs,
          displayedEndMs: task.displayedTPessimisteMs,
          internalStartMs: task.displayedTOptimisteMs ?? nowMs,
          internalEndMs: task.displayedTPessimisteMs ?? nowMs,
          flowMode: 'EXTRAPOLATED',
          vFlowSecPerMin: patch.vFlowSecPerMin,
          nextRealScanAtMs: nowMs,
          nextRealScanReason: patch.nextRealScanReason,
          apiCallsTotal: task.apiCallsTotal,
          apiCallsAvoidedCache: task.apiCallsAvoidedCache,
          apiCallsAvoidedExtrapolation: task.apiCallsAvoidedExtrapolation,
        },
        traceForce: true,
        done: false,
      };
    }

    const scanCount = Math.max(0, Math.round(task.scanCount));
    const baseTOpt = task.baseTOptimisteMs ?? task.tOptimisteMs ?? null;
    const baseTPess = task.baseTPessimisteMs ?? task.tPessimisteMs ?? null;

    const needsScan1 = scanCount === 0;
    const needsScan2 = scanCount === 1 && baseTOpt != null && nowMs >= baseTOpt;

    const vFlowSecPerMin = clamp(Number(task.vFlowSecPerMin || VFLOW_INIT_SEC_PER_MIN), 0, VFLOW_CAP_SEC_PER_MIN);
    const lastScanAtMs = task.lastRealScanAtMs ?? task.scan2AtMs ?? task.scan1AtMs ?? null;

    const elapsedMin = lastScanAtMs == null ? 0 : Math.max(0, (nowMs - lastScanAtMs) / 60_000);
    const degradationSec = elapsedMin * vFlowSecPerMin;

    const internalStartMs = baseTOpt ?? computeCriticalDepartureAtMs(task.arrivalAtMs, task.lastTrafficDuration);
    const basePessMs = baseTPess ?? computeCriticalDepartureAtMs(task.arrivalAtMs, task.lastTrafficDuration);
    const computedInternalEndMs = Math.round(basePessMs - degradationSec * 1000);
    const g1EndMs = Math.max(computedInternalEndMs, nowMs);
    const previousInternalEndMs = task.internalTPessimisteMs;
    const g3EndMs =
      previousInternalEndMs == null ? g1EndMs : Math.min(Number(previousInternalEndMs), g1EndMs);

    const bufferSafetyMin = (g3EndMs - nowMs) / 60_000;
    const criticalBreak = bufferSafetyMin <= CRITICAL_BUFFER_MIN;
    const needsScan3 = scanCount >= 2 && scanCount < 3 && criticalBreak;

    const scanReason: ScanReason | null = needsScan1
      ? 'SCAN1_INITIAL'
      : needsScan2
        ? 'SCAN2_ENTRY_ORANGE'
        : needsScan3
          ? 'SCAN3_CRITICAL'
          : null;

    const willRealScan =
      scanReason !== null && task.sentinelMode === 'SENTINEL' && this.options?.disableRealScans !== true;

    if (task.sentinelMode === 'STATIC') {
      patch.vigilanceStatus = nowMs >= internalStartMs ? 'VIGILANCE_ORANGE' : 'VIGILANCE_BLUE';
      patch.internalTPessimisteMs = g3EndMs;
      patch.nextRealScanAtMs = null;
      patch.nextRealScanReason = null;
    }

    if (willRealScan) {
      return this.computeRealScanTick(task, nowMs, scanReason);
    }

    if (baseTOpt != null && scanCount === 1) {
      patch.nextRealScanAtMs = baseTOpt;
      patch.nextRealScanReason = 'SCAN2_ENTRY_ORANGE';
    } else if (scanCount >= 2 && scanCount < 3 && baseTPess != null && task.scan2AtMs != null) {
      patch.nextRealScanAtMs = predictScan3AtMs({
        scan2AtMs: task.scan2AtMs,
        baseTPessimisteMs: baseTPess,
        vFlowSecPerMin,
        nowMs,
      });
      patch.nextRealScanReason = 'SCAN3_CRITICAL';
    } else {
      patch.nextRealScanAtMs = null;
      patch.nextRealScanReason = null;
    }

    patch.internalTPessimisteMs = g3EndMs;
    patch.vFlowSecPerMin = vFlowSecPerMin;
    patch.vigilanceStatus =
      nowMs >= task.arrivalAtMs
        ? 'FINISHED'
        : nowMs >= g3EndMs
          ? 'VIGILANCE_RED'
          : nowMs >= internalStartMs
            ? 'VIGILANCE_ORANGE'
            : 'VIGILANCE_BLUE';

    const displayedStartMs = task.displayedTOptimisteMs;
    const displayedEndMs = task.displayedTPessimisteMs;
    const doUi = shouldUpdateUi({
      scanHappened: false,
      criticalBreak,
      displayedStartMs,
      displayedEndMs,
      internalStartMs,
      internalEndMs: g3EndMs,
    });
    if (!doUi) {
      if (task.vigilanceStatus === 'VIGILANCE_ORANGE' || task.vigilanceStatus === 'VIGILANCE_RED') {
        patch.apiCallsAvoidedExtrapolation = task.apiCallsAvoidedExtrapolation + 1;
      }
      return {
        patch,
        ui: null,
        trace: {
          displayedStartMs: task.displayedTOptimisteMs,
          displayedEndMs: task.displayedTPessimisteMs,
          internalStartMs,
          internalEndMs: g3EndMs,
          flowMode: 'EXTRAPOLATED',
          vFlowSecPerMin,
          nextRealScanAtMs: patch.nextRealScanAtMs ?? null,
          nextRealScanReason: patch.nextRealScanReason ?? null,
          apiCallsTotal: task.apiCallsTotal,
          apiCallsAvoidedCache: task.apiCallsAvoidedCache,
          apiCallsAvoidedExtrapolation: patch.apiCallsAvoidedExtrapolation ?? task.apiCallsAvoidedExtrapolation,
        },
        traceForce: criticalBreak,
        done: false,
      };
    }

    patch.displayedTOptimisteMs = internalStartMs;
    patch.displayedTPessimisteMs = g3EndMs;
    patch.lastUiUpdateAtMs = nowMs;
    patch.stateVersion = task.stateVersion + 1;
    const ui = {
      stateVersion: patch.stateVersion,
      displayedStartMs: internalStartMs,
      displayedEndMs: g3EndMs,
      internalStartMs,
      internalEndMs: g3EndMs,
      flowMode: 'EXTRAPOLATED' as const,
      vFlowSecPerMin,
      nextRealScanAtMs: patch.nextRealScanAtMs ?? null,
      nextRealScanReason: patch.nextRealScanReason ?? null,
      apiCallsTotal: task.apiCallsTotal,
      apiCallsAvoidedCache: task.apiCallsAvoidedCache,
      apiCallsAvoidedExtrapolation: patch.apiCallsAvoidedExtrapolation ?? task.apiCallsAvoidedExtrapolation,
    };
    if (criticalBreak && scanCount >= 2 && scanCount < 3) {
      patch.nextRealScanAtMs = nowMs;
      patch.nextRealScanReason = 'SCAN3_CRITICAL';
    }
    if (task.vigilanceStatus === 'VIGILANCE_ORANGE' || task.vigilanceStatus === 'VIGILANCE_RED') {
      patch.apiCallsAvoidedExtrapolation = (patch.apiCallsAvoidedExtrapolation ?? task.apiCallsAvoidedExtrapolation) + 1;
      ui.apiCallsAvoidedExtrapolation = patch.apiCallsAvoidedExtrapolation;
    }
    return {
      patch,
      ui,
      trace: {
        displayedStartMs: internalStartMs,
        displayedEndMs: g3EndMs,
        internalStartMs,
        internalEndMs: g3EndMs,
        flowMode: 'EXTRAPOLATED',
        vFlowSecPerMin,
        nextRealScanAtMs: patch.nextRealScanAtMs ?? null,
        nextRealScanReason: patch.nextRealScanReason ?? null,
        apiCallsTotal: task.apiCallsTotal,
        apiCallsAvoidedCache: task.apiCallsAvoidedCache,
        apiCallsAvoidedExtrapolation: ui.apiCallsAvoidedExtrapolation,
      },
      traceForce: true,
      done: false,
    };
  }

  private async computeRealScanTick(
    task: TripTaskRowV4,
    nowMs: number,
    reason: ScanReason,
  ): Promise<TickResult> {
    const patch: Partial<TripTaskRowV4> = {};
    const scanCount = Math.max(0, Math.round(task.scanCount));

    let originLat = task.originLat;
    let originLng = task.originLng;
    if ((originLat == null || originLng == null) && reason === 'SCAN1_INITIAL') {
      try {
        const pos = await getForegroundOriginSnapshot({ maxAgeMs: 60_000 });
        originLat = pos.lat;
        originLng = pos.lng;
        patch.originLat = originLat;
        patch.originLng = originLng;
      } catch {
        patch.lastErrorAt = nowMs;
        patch.status = 'ERROR';
        patch.modeSafety = true;
        patch.vigilanceStatus = 'VIGILANCE_RED';
        patch.stateVersion = task.stateVersion + 1;
        patch.displayedTOptimisteMs = task.displayedTOptimisteMs ?? nowMs;
        patch.displayedTPessimisteMs = task.displayedTPessimisteMs ?? nowMs;
        patch.lastUiUpdateAtMs = nowMs;
        return {
          patch,
          ui: {
            stateVersion: patch.stateVersion,
            displayedStartMs: patch.displayedTOptimisteMs,
            displayedEndMs: patch.displayedTPessimisteMs,
            internalStartMs: patch.displayedTOptimisteMs,
            internalEndMs: patch.displayedTPessimisteMs,
            flowMode: 'REAL',
            vFlowSecPerMin: task.vFlowSecPerMin,
            nextRealScanAtMs: null,
            nextRealScanReason: null,
            apiCallsTotal: task.apiCallsTotal,
            apiCallsAvoidedCache: task.apiCallsAvoidedCache,
            apiCallsAvoidedExtrapolation: task.apiCallsAvoidedExtrapolation,
          },
          trace: {
            displayedStartMs: patch.displayedTOptimisteMs,
            displayedEndMs: patch.displayedTPessimisteMs,
            internalStartMs: patch.displayedTOptimisteMs,
            internalEndMs: patch.displayedTPessimisteMs,
            flowMode: 'REAL',
            vFlowSecPerMin: task.vFlowSecPerMin,
            nextRealScanAtMs: null,
            nextRealScanReason: null,
            apiCallsTotal: task.apiCallsTotal,
            apiCallsAvoidedCache: task.apiCallsAvoidedCache,
            apiCallsAvoidedExtrapolation: task.apiCallsAvoidedExtrapolation,
          },
          traceForce: true,
          done: false,
        };
      }
    }

    if (
      originLat == null ||
      originLng == null ||
      task.destLat == null ||
      task.destLng == null ||
      !Number.isFinite(originLat) ||
      !Number.isFinite(originLng) ||
      !Number.isFinite(task.destLat) ||
      !Number.isFinite(task.destLng)
    ) {
      patch.lastErrorAt = nowMs;
      patch.status = 'ERROR';
      patch.modeSafety = true;
      patch.vigilanceStatus = 'VIGILANCE_RED';
      patch.stateVersion = task.stateVersion + 1;
      patch.displayedTOptimisteMs = task.displayedTOptimisteMs ?? nowMs;
      patch.displayedTPessimisteMs = task.displayedTPessimisteMs ?? nowMs;
      patch.lastUiUpdateAtMs = nowMs;
      return {
        patch,
        ui: {
          stateVersion: patch.stateVersion,
          displayedStartMs: patch.displayedTOptimisteMs,
          displayedEndMs: patch.displayedTPessimisteMs,
          internalStartMs: patch.displayedTOptimisteMs,
          internalEndMs: patch.displayedTPessimisteMs,
          flowMode: 'REAL',
          vFlowSecPerMin: task.vFlowSecPerMin,
          nextRealScanAtMs: null,
          nextRealScanReason: null,
          apiCallsTotal: task.apiCallsTotal,
          apiCallsAvoidedCache: task.apiCallsAvoidedCache,
          apiCallsAvoidedExtrapolation: task.apiCallsAvoidedExtrapolation,
        },
        trace: {
          displayedStartMs: patch.displayedTOptimisteMs,
          displayedEndMs: patch.displayedTPessimisteMs,
          internalStartMs: patch.displayedTOptimisteMs,
          internalEndMs: patch.displayedTPessimisteMs,
          flowMode: 'REAL',
          vFlowSecPerMin: task.vFlowSecPerMin,
          nextRealScanAtMs: null,
          nextRealScanReason: null,
          apiCallsTotal: task.apiCallsTotal,
          apiCallsAvoidedCache: task.apiCallsAvoidedCache,
          apiCallsAvoidedExtrapolation: task.apiCallsAvoidedExtrapolation,
        },
        traceForce: true,
        done: false,
      };
    }

    try {
      const sample = await this.mapsService.fetchTrafficSample({
        ...task,
        originLat,
        originLng,
      });
      const fromCache = sample.fromCache === true;
      patch.apiCallsAvoidedCache = task.apiCallsAvoidedCache + (fromCache ? 1 : 0);
      patch.apiCallsTotal = task.apiCallsTotal + (fromCache ? 0 : 1);

      const durationSec = Math.max(0, Number(sample.trafficDurationSec) || 0);
      const { tOptimisteMs, tPessimisteMs } = computeNewtonWindow(task.arrivalAtMs, durationSec);

      patch.lastRealScanAtMs = nowMs;
      patch.lastErrorAt = null;
      patch.status = 'ACTIVE';
      patch.modeSafety = false;
      patch.baseTOptimisteMs = tOptimisteMs;
      patch.baseTPessimisteMs = tPessimisteMs;
      patch.internalTPessimisteMs = null;
      patch.tOptimisteMs = tOptimisteMs;
      patch.tPessimisteMs = tPessimisteMs;
      patch.lastTrafficDuration = durationSec;
      patch.vigilanceStatus =
        nowMs >= task.arrivalAtMs
          ? 'FINISHED'
          : nowMs >= tPessimisteMs
            ? 'VIGILANCE_RED'
            : nowMs >= tOptimisteMs
              ? 'VIGILANCE_ORANGE'
              : 'VIGILANCE_BLUE';

      if (reason === 'SCAN1_INITIAL') {
        patch.scanCount = 1;
        patch.scan1AtMs = nowMs;
        patch.scan1DurationSec = durationSec;
        patch.vFlowSecPerMin = VFLOW_INIT_SEC_PER_MIN;
        patch.flowCalibrated = false;
        patch.nextRealScanAtMs = tOptimisteMs;
        patch.nextRealScanReason = 'SCAN2_ENTRY_ORANGE';
      } else if (reason === 'SCAN2_ENTRY_ORANGE' || reason === 'SCAN2_RETRY') {
        patch.scanCount = 2;
        patch.scan2AtMs = nowMs;
        patch.scan2DurationSec = durationSec;
        const scan1AtMs = task.scan1AtMs ?? nowMs;
        const scan1DurationSec = task.scan1DurationSec ?? durationSec;
        const deltaTrafficSec = Math.max(0, durationSec - scan1DurationSec);
        const deltaMin = Math.max(0.1, (nowMs - scan1AtMs) / 60_000);
        const computedSecPerMin = deltaTrafficSec / deltaMin;
        patch.vFlowSecPerMin = clamp(computedSecPerMin, 0, VFLOW_CAP_SEC_PER_MIN);
        patch.flowCalibrated = true;
        patch.nextRealScanAtMs = predictScan3AtMs({
          scan2AtMs: nowMs,
          baseTPessimisteMs: tPessimisteMs,
          vFlowSecPerMin: patch.vFlowSecPerMin,
          nowMs,
        });
        patch.nextRealScanReason = 'SCAN3_CRITICAL';
      } else if (reason === 'SCAN3_CRITICAL') {
        patch.scanCount = 3;
        patch.nextRealScanAtMs = null;
        patch.nextRealScanReason = null;
      }

      const internalStartMs = tOptimisteMs;
      const internalEndMs = tPessimisteMs;
      patch.displayedTOptimisteMs = internalStartMs;
      patch.displayedTPessimisteMs = internalEndMs;
      patch.lastUiUpdateAtMs = nowMs;
      patch.stateVersion = task.stateVersion + 1;

      const ui = {
        stateVersion: patch.stateVersion,
        displayedStartMs: internalStartMs,
        displayedEndMs: internalEndMs,
        internalStartMs,
        internalEndMs,
        flowMode: 'REAL' as const,
        vFlowSecPerMin: patch.vFlowSecPerMin ?? task.vFlowSecPerMin,
        nextRealScanAtMs: patch.nextRealScanAtMs ?? null,
        nextRealScanReason: patch.nextRealScanReason ?? null,
        apiCallsTotal: patch.apiCallsTotal ?? task.apiCallsTotal,
        apiCallsAvoidedCache: patch.apiCallsAvoidedCache ?? task.apiCallsAvoidedCache,
        apiCallsAvoidedExtrapolation: task.apiCallsAvoidedExtrapolation,
      };
      return {
        patch,
        ui,
        trace: {
          displayedStartMs: internalStartMs,
          displayedEndMs: internalEndMs,
          internalStartMs,
          internalEndMs,
          flowMode: 'REAL',
          vFlowSecPerMin: ui.vFlowSecPerMin,
          nextRealScanAtMs: ui.nextRealScanAtMs,
          nextRealScanReason: ui.nextRealScanReason,
          apiCallsTotal: ui.apiCallsTotal,
          apiCallsAvoidedCache: ui.apiCallsAvoidedCache,
          apiCallsAvoidedExtrapolation: ui.apiCallsAvoidedExtrapolation,
        },
        traceForce: true,
        done: patch.vigilanceStatus === 'FINISHED',
      };
    } catch {
      patch.lastErrorAt = nowMs;
      patch.status = 'ERROR';
      patch.nextRealScanAtMs =
        reason === 'SCAN2_ENTRY_ORANGE' && task.scan2AtMs == null ? nowMs + 3 * 60_000 : task.nextRealScanAtMs;
      patch.nextRealScanReason =
        reason === 'SCAN2_ENTRY_ORANGE' && task.scan2AtMs == null ? 'SCAN2_RETRY' : task.nextRealScanReason;
      if (reason === 'SCAN3_CRITICAL') {
        patch.modeSafety = true;
        patch.vigilanceStatus = 'VIGILANCE_RED';
        patch.displayedTOptimisteMs = task.displayedTOptimisteMs ?? nowMs;
        patch.displayedTPessimisteMs = task.displayedTPessimisteMs ?? nowMs;
        patch.lastUiUpdateAtMs = nowMs;
        patch.stateVersion = task.stateVersion + 1;
        return {
          patch,
          ui: {
            stateVersion: patch.stateVersion,
            displayedStartMs: patch.displayedTOptimisteMs,
            displayedEndMs: patch.displayedTPessimisteMs,
            internalStartMs: patch.displayedTOptimisteMs,
            internalEndMs: patch.displayedTPessimisteMs,
            flowMode: 'REAL',
            vFlowSecPerMin: task.vFlowSecPerMin,
            nextRealScanAtMs: patch.nextRealScanAtMs ?? null,
            nextRealScanReason: patch.nextRealScanReason ?? null,
            apiCallsTotal: task.apiCallsTotal,
            apiCallsAvoidedCache: task.apiCallsAvoidedCache,
            apiCallsAvoidedExtrapolation: task.apiCallsAvoidedExtrapolation,
          },
          trace: {
            displayedStartMs: patch.displayedTOptimisteMs,
            displayedEndMs: patch.displayedTPessimisteMs,
            internalStartMs: patch.displayedTOptimisteMs,
            internalEndMs: patch.displayedTPessimisteMs,
            flowMode: 'REAL',
            vFlowSecPerMin: task.vFlowSecPerMin,
            nextRealScanAtMs: patch.nextRealScanAtMs ?? null,
            nextRealScanReason: patch.nextRealScanReason ?? null,
            apiCallsTotal: task.apiCallsTotal,
            apiCallsAvoidedCache: task.apiCallsAvoidedCache,
            apiCallsAvoidedExtrapolation: task.apiCallsAvoidedExtrapolation,
          },
          traceForce: true,
          done: false,
        };
      }
      return {
        patch,
        ui: null,
        trace: {
          displayedStartMs: task.displayedTOptimisteMs,
          displayedEndMs: task.displayedTPessimisteMs,
          internalStartMs: task.displayedTOptimisteMs ?? nowMs,
          internalEndMs: task.displayedTPessimisteMs ?? nowMs,
          flowMode: 'REAL',
          vFlowSecPerMin: task.vFlowSecPerMin,
          nextRealScanAtMs: patch.nextRealScanAtMs ?? task.nextRealScanAtMs,
          nextRealScanReason: patch.nextRealScanReason ?? task.nextRealScanReason,
          apiCallsTotal: task.apiCallsTotal,
          apiCallsAvoidedCache: task.apiCallsAvoidedCache,
          apiCallsAvoidedExtrapolation: task.apiCallsAvoidedExtrapolation,
        },
        traceForce: true,
        done: false,
      };
    }
  }

  private async planNext(task: TripTaskRowV4): Promise<void> {
    if (this.options?.disableTimers === true) return;
    const nowMs = Date.now();
    if (task.status !== 'ACTIVE') return;
    const baseTOpt = task.baseTOptimisteMs ?? task.tOptimisteMs ?? null;
    const scanCount = Math.max(0, Math.round(task.scanCount));
    const nextRealScanAtMs =
      scanCount === 0
        ? nowMs
        : scanCount === 1 && baseTOpt != null
          ? baseTOpt
          : task.nextRealScanAtMs;
    const nextAt = Math.min(
      nowMs + INTERNAL_TICK_MS,
      nextRealScanAtMs != null ? Math.max(nowMs, nextRealScanAtMs) : nowMs + INTERNAL_TICK_MS,
    );
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
    await withTrankilV2Database(async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS sentinel_trips (
          id TEXT PRIMARY KEY NOT NULL,
          destination TEXT NOT NULL,
          arrival_at_ms INTEGER NOT NULL,
          status TEXT NOT NULL,
          sentinel_mode TEXT NOT NULL DEFAULT 'SENTINEL',
          target_duration_sec INTEGER NOT NULL DEFAULT 0,
          last_traffic_duration INTEGER NOT NULL DEFAULT 0,
          internal_scan_count INTEGER NOT NULL DEFAULT 0,
          next_check_at INTEGER,
          gate_prompted_at INTEGER,
          last_error_at INTEGER,
          t_optimiste_ms INTEGER,
          t_pessimiste_ms INTEGER,
          vigilance_status TEXT,
          updated_at INTEGER NOT NULL DEFAULT 0,
          is_dirty INTEGER NOT NULL DEFAULT 0 CHECK (is_dirty IN (0, 1)),
          server_version INTEGER NOT NULL DEFAULT 0
        );
      `);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN state_version INTEGER NOT NULL DEFAULT 0;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN fingerprint TEXT;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN scan_count INTEGER NOT NULL DEFAULT 0;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN flow_calibrated INTEGER NOT NULL DEFAULT 0;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN v_flow_sec_per_min REAL NOT NULL DEFAULT 10;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN last_real_scan_at_ms INTEGER;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN scan1_at_ms INTEGER;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN scan1_duration_sec REAL;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN scan2_at_ms INTEGER;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN scan2_duration_sec REAL;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN base_t_optimiste_ms INTEGER;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN base_t_pessimiste_ms INTEGER;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN internal_t_pessimiste_ms INTEGER;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN displayed_t_optimiste_ms INTEGER;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN displayed_t_pessimiste_ms INTEGER;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN last_ui_update_at_ms INTEGER;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN mode_safety INTEGER NOT NULL DEFAULT 0;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN next_real_scan_at_ms INTEGER;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN next_real_scan_reason TEXT;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN api_calls_total INTEGER NOT NULL DEFAULT 0;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN api_calls_avoided_cache INTEGER NOT NULL DEFAULT 0;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN api_calls_avoided_extrapolation INTEGER NOT NULL DEFAULT 0;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN origin_lat REAL;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN origin_lng REAL;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN dest_lat REAL;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN dest_lng REAL;`);
      await tryAddColumn(db, `ALTER TABLE sentinel_trips ADD COLUMN transport_mode TEXT;`);
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_sentinel_trips_status ON sentinel_trips (status);`);
    });
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
    vFlowSecPerMin: Number(row.v_flow_sec_per_min ?? VFLOW_INIT_SEC_PER_MIN),
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
