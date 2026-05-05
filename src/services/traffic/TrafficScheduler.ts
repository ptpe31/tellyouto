import { withTrankilV2Database } from '../../api/trankilV2Db';
import { getNotifications } from '../notifications';
import {
  calculateNextJump,
  executeWatch4MeInternalScan,
  type ExecuteTrafficScanOutput,
  type TrafficScanSession,
} from './TrafficEngine';
import { SentinelNotificationManager } from './TrafficNotificationService';
import i18n from '../../locales/i18n';

/** Marge invisible anti-risque: depart 5 min avant le point critique. */
export const INNER_SAFETY_MARGIN_SEC = 300;
/** Au-dela de 4h: demande explicite utilisateur avant scans API. */
export const CONFIRMATION_GATE_HOURS = 4;
/** Saut de securite en cas d'erreur reseau/API. */
export const SAFETY_JUMP_MS = 5 * 60 * 1000;

export type TrafficTaskStatus =
  | 'PENDING_CONFIRMATION'
  | 'ACTIVE'
  | 'PAUSED'
  | 'DONE'
  | 'ERROR';

export type TripTaskRow = {
  id: string;
  destination: string;
  arrivalAtMs: number;
  status: TrafficTaskStatus;
  sentinelMode: 'SENTINEL' | 'STATIC';
  targetDurationSec: number;
  lastTrafficDuration: number;
  internalScanCount: number;
  nextCheckAt: number | null;
  gatePromptedAt: number | null;
  lastErrorAt: number | null;
  tOptimisteMs: number | null;
  tPessimisteMs: number | null;
  vigilanceStatus: string | null;
};

/** Resultat simplifie de l'appel cartographie (injection externe). */
export type TrafficSample = {
  trafficDurationSec: number;
  staticDurationSec?: number;
  simulatedNowMs?: number;
  timeWarpFactor?: number;
};

/** Service externe: le scheduler ne va pas chercher le trafic lui-meme. */
export type MapsService = {
  fetchTrafficSample(task: TripTaskRow): Promise<TrafficSample>;
};

/** Notifications decouplees: implementables via expo-notifications ou natif. */
export type TrafficNotificationService = {
  askSurveillanceActivation(task: TripTaskRow): Promise<void>;
  notifySurveillanceReminder(task: TripTaskRow): Promise<void>;
  triggerTopDepart(task: TripTaskRow, output: ExecuteTrafficScanOutput): Promise<void>;
  notifyVigilanceOrange(task: TripTaskRow, output: ExecuteTrafficScanOutput): Promise<void>;
  notifyVigilanceRed(task: TripTaskRow, output: ExecuteTrafficScanOutput): Promise<void>;
};

export type TrafficMonitoringSnapshot = {
  tripTaskId: string;
  simulatedNowMs: number;
  rawTrafficDurationSec: number;
  nextJumpMs: number;
  stabilizedTrafficDurationSec: number;
  status: 'VIGILANCE_BLUE' | 'VIGILANCE_ORANGE' | 'VIGILANCE_RED' | 'FINISHED';
  bufferSafetyMin: number;
};

type TrafficSchedulerOptions = {
  simulationMode?: boolean;
  onMonitoringSnapshot?: (snapshot: TrafficMonitoringSnapshot) => void;
};

const DEFAULT_NOTIFICATION_SERVICE: TrafficNotificationService = {
  async askSurveillanceActivation(task) {
    const n = getNotifications();
    if (!n) return;
    await n.scheduleNotificationAsync({
      content: {
        title: 'Surveillance trajet',
        body: `Souhaitez-vous activer la surveillance pour ${task.destination} ?`,
        data: { kind: 'traffic_confirmation_gate', tripTaskId: task.id },
      },
      trigger: null,
    });
  },
  async notifySurveillanceReminder(task) {
    const n = getNotifications();
    if (!n) return;
    await n.scheduleNotificationAsync({
      content: {
        title: 'Surveillance active',
        body: `Surveillance en cours vers ${task.destination}.`,
        data: { kind: 'traffic_surveillance_reminder', tripTaskId: task.id },
      },
      trigger: null,
    });
  },
  async triggerTopDepart(task) {
    const n = getNotifications();
    if (!n) return;
    await n.scheduleNotificationAsync({
      content: {
        title: 'TOP DEPART',
        body: `C'est le moment de partir pour ${task.destination}.`,
        sound: 'default',
        data: { kind: 'traffic_top_depart', tripTaskId: task.id },
      },
      trigger: null,
    });
  },
  async notifyVigilanceOrange(task) {
    const n = getNotifications();
    if (!n) return;
    await n.scheduleNotificationAsync({
      content: {
        title: 'Fenêtre ouverte',
        body: `La fenêtre de départ est ouverte pour ${task.destination}.`,
        data: { kind: 'traffic_vigilance_orange', tripTaskId: task.id },
      },
      trigger: null,
    });
  },
  async notifyVigilanceRed(task) {
    const n = getNotifications();
    if (!n) return;
    await n.scheduleNotificationAsync({
      content: {
        title: 'TOP DÉPART CRITIQUE',
        body: `Départ critique pour ${task.destination}.`,
        sound: 'default',
        data: { kind: 'traffic_vigilance_red', tripTaskId: task.id },
      },
      trigger: null,
    });
  },
};

function sessionFromTask(task: TripTaskRow): TrafficScanSession {
  return {
    status: task.status === 'ACTIVE' ? 'active' : task.status === 'DONE' ? 'finished' : 'cancelled',
    durationTargetSec: task.targetDurationSec,
    lastTrafficDurationSec: task.lastTrafficDuration,
    internalScanCount: task.internalScanCount,
  };
}

function remainingMinutesUntilArrival(arrivalAtMs: number, nowMs: number): number {
  return Math.max(0, (arrivalAtMs - nowMs) / 60_000);
}

function computeCriticalDepartureAtMs(arrivalAtMs: number, stabilizedTrafficSec: number): number {
  return arrivalAtMs - (Math.max(0, stabilizedTrafficSec) + INNER_SAFETY_MARGIN_SEC) * 1000;
}

/**
 * Orchestrateur runtime:
 * - lit/ecrit SQLite pour les trip tasks
 * - applique la serrure de validation > 4h
 * - planifie les checks avec saut elastique
 */
export class TrafficScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private simulationMode = false;
  private readonly onMonitoringSnapshot?: (snapshot: TrafficMonitoringSnapshot) => void;
  private readonly tableName = 'sentinel_trips';
  private readonly notificationManager = new SentinelNotificationManager();

  constructor(
    private readonly mapsService: MapsService,
    private readonly notificationService: TrafficNotificationService = DEFAULT_NOTIFICATION_SERVICE,
    options?: TrafficSchedulerOptions
  ) {
    this.simulationMode = options?.simulationMode === true;
    this.onMonitoringSnapshot = options?.onMonitoringSnapshot;
  }

  async start(): Promise<void> {
    await this.ensureSchema();
    const tasks = await this.listScannableTasks();
    for (const task of tasks) {
      await this.planTask(task);
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  setSimulationMode(enabled: boolean): void {
    this.simulationMode = enabled;
  }

  async upsertTripTask(input: {
    id: string;
    destination: string;
    arrivalAtMs: number;
    status?: TrafficTaskStatus;
    sentinelMode?: 'SENTINEL' | 'STATIC';
    targetDurationSec: number;
    lastTrafficDuration?: number;
    internalScanCount?: number;
    nextCheckAt?: number | null;
    tOptimisteMs?: number | null;
    tPessimisteMs?: number | null;
    vigilanceStatus?: string | null;
  }): Promise<void> {
    await this.ensureSchema();
    await withTrankilV2Database(async (db) => {
      await db.runAsync(
        `INSERT OR REPLACE INTO ${this.tableName} (
          id, destination, arrival_at_ms, status, sentinel_mode, target_duration_sec, last_traffic_duration,
          internal_scan_count, next_check_at, gate_prompted_at, last_error_at,
          t_optimiste_ms, t_pessimiste_ms, vigilance_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
        [
          input.id,
          input.destination,
          input.arrivalAtMs,
          input.status ?? 'ACTIVE',
          input.sentinelMode ?? 'SENTINEL',
          input.targetDurationSec,
          input.lastTrafficDuration ?? 0,
          input.internalScanCount ?? 0,
          input.nextCheckAt ?? null,
          input.tOptimisteMs ?? null,
          input.tPessimisteMs ?? null,
          input.vigilanceStatus ?? null,
        ]
      );
    });
  }

  async approveSurveillance(taskId: string): Promise<void> {
    await this.updateTaskStatus(taskId, 'ACTIVE');
    const task = await this.getTaskById(taskId);
    if (task) await this.planTask(task);
  }

  async rejectSurveillance(taskId: string): Promise<void> {
    await this.updateTaskStatus(taskId, 'PAUSED');
    this.clearTaskTimer(taskId);
    await this.notificationManager.cancel(taskId);
  }

  /**
   * Tick principal:
   * - fetch trafic via MapsService injecte
   * - traitement via TrafficEngine
   * - event handling + persistance SQLite
   */
  async performTrafficCheck(taskId: string): Promise<void> {
    const wallNowMs = Date.now();
    const task = await this.getTaskById(taskId);
    if (!task || task.status !== 'ACTIVE') return;

    try {
      if (task.sentinelMode === 'STATIC') {
        const nowMs = wallNowMs;
        if (nowMs >= task.arrivalAtMs) {
          await this.persistAfterScan(task.id, {
            status: 'DONE',
            lastErrorAt: null,
            vigilanceStatus: 'FINISHED',
          });
          await this.notificationManager.cancel(task.id);
          this.clearTaskTimer(task.id);
          return;
        }

        const durationMs = Math.max(0, Number(task.lastTrafficDuration) || 0) * 1000;
        const departureAtMs =
          task.tPessimisteMs ?? Math.round(task.arrivalAtMs - durationMs - 5 * 60 * 1000);
        await this.notificationManager.update({
          tripTaskId: task.id,
          destination: task.destination,
          targetArrivalMs: task.arrivalAtMs,
          nowMs,
          tOptimisteMs: task.tOptimisteMs ?? departureAtMs,
          vigilanceStatus: String(task.vigilanceStatus ?? 'VIGILANCE_BLUE'),
          staticDepartureAtMs: departureAtMs,
          trafficLabel: i18n.t('sentinel.notifStatusStatic'),
        });
        await this.planTask(task);
        return;
      }

      const sample = await this.mapsService.fetchTrafficSample(task);
      const nowMs =
        this.simulationMode && Number.isFinite(Number(sample.simulatedNowMs))
          ? Number(sample.simulatedNowMs)
          : wallNowMs;
      const output = executeWatch4MeInternalScan({
        session: sessionFromTask(task),
        currentTrafficDurationSec: sample.trafficDurationSec,
        previousTrafficDurationSec: task.lastTrafficDuration,
        targetArrivalMs: task.arrivalAtMs,
        nowMs,
      });

      const bufferSafetyMin = (output.tPessimisteMs - nowMs) / 60_000;
      const nextVigilanceStatus = output.evaluation.status;

      if (task.vigilanceStatus !== 'VIGILANCE_ORANGE' && nextVigilanceStatus === 'VIGILANCE_ORANGE') {
        await this.notificationService.notifyVigilanceOrange(task, output);
      } else if (task.vigilanceStatus !== 'VIGILANCE_RED' && nextVigilanceStatus === 'VIGILANCE_RED') {
        await this.notificationService.notifyVigilanceRed(task, output);
      }

      const nextJumpMs = output.evaluation.nextJumpMs;
      this.onMonitoringSnapshot?.({
        tripTaskId: task.id,
        simulatedNowMs: nowMs,
        rawTrafficDurationSec: sample.trafficDurationSec,
        nextJumpMs,
        stabilizedTrafficDurationSec: output.stabilizedTrafficDurationSec,
        status: nextVigilanceStatus,
        bufferSafetyMin,
      });
      await this.persistAfterScan(task.id, {
        lastTrafficDuration: output.stabilizedTrafficDurationSec,
        internalScanCount: output.nextSession.internalScanCount,
        nextCheckAt: nowMs + nextJumpMs,
        status:
          nextVigilanceStatus === 'FINISHED' || nowMs >= task.arrivalAtMs ? 'DONE' : 'ACTIVE',
        lastErrorAt: null,
        tOptimisteMs: output.tOptimisteMs,
        tPessimisteMs: output.tPessimisteMs,
        vigilanceStatus: nextVigilanceStatus,
      });
      if (nextVigilanceStatus === 'FINISHED') {
        await this.notificationManager.cancel(task.id);
      } else {
        const trafficLabel =
          nextVigilanceStatus === 'VIGILANCE_BLUE'
            ? i18n.t('sentinel.notifStatusBlue')
            : nextVigilanceStatus === 'VIGILANCE_ORANGE'
              ? i18n.t('sentinel.notifStatusOrange')
              : nextVigilanceStatus === 'VIGILANCE_RED'
                ? i18n.t('sentinel.notifStatusRed')
                : String(nextVigilanceStatus);
        await this.notificationManager.update({
          tripTaskId: task.id,
          destination: task.destination,
          targetArrivalMs: task.arrivalAtMs,
          nowMs,
          tOptimisteMs: output.tOptimisteMs,
          vigilanceStatus: nextVigilanceStatus,
          trafficLabel,
        });
      }

      const refreshed = await this.getTaskById(task.id);
      if (refreshed && refreshed.status === 'ACTIVE') {
        await this.planTask(refreshed, sample.timeWarpFactor);
      } else {
        this.clearTaskTimer(task.id);
      }
    } catch {
      await this.persistAfterScan(task.id, {
        nextCheckAt: wallNowMs + SAFETY_JUMP_MS,
        status: 'ERROR',
        lastErrorAt: wallNowMs,
      });
      const refreshed = await this.getTaskById(task.id);
      if (refreshed) {
        await this.persistAfterScan(task.id, { status: 'ACTIVE' });
        await this.planTask({ ...refreshed, status: 'ACTIVE' });
      }
    }
  }

  private async planTask(task: TripTaskRow, timeWarpFactor?: number): Promise<void> {
    const nowMs = Date.now();
    const gapMin = remainingMinutesUntilArrival(task.arrivalAtMs, nowMs);
    const isFar = gapMin > CONFIRMATION_GATE_HOURS * 60;

    if (task.sentinelMode === 'SENTINEL' && isFar && task.status !== 'PENDING_CONFIRMATION') {
      await this.persistAfterScan(task.id, {
        status: 'PENDING_CONFIRMATION',
        gatePromptedAt: nowMs,
        nextCheckAt: null,
      });
      await this.notificationService.askSurveillanceActivation(task);
      this.clearTaskTimer(task.id);
      return;
    }

    if (task.status !== 'ACTIVE') return;

    const nextJumpMs =
      task.sentinelMode === 'STATIC'
        ? Math.max(60_000, Math.min(60 * 60 * 1000, task.arrivalAtMs - nowMs))
        : calculateNextJump({
            nowMs,
            targetArrivalMs: task.arrivalAtMs,
            stabilizedDurationSec: task.lastTrafficDuration,
          });
    const targetAt = task.nextCheckAt ?? nowMs + nextJumpMs;
    const rawDelay = Math.max(500, targetAt - nowMs);
    const warp =
      this.simulationMode && Number.isFinite(Number(timeWarpFactor))
        ? Math.max(1, Number(timeWarpFactor))
        : 1;
    const delay = Math.max(200, Math.floor(rawDelay / warp));
    this.clearTaskTimer(task.id);
    const timer = setTimeout(() => {
      void this.performTrafficCheck(task.id);
    }, delay);
    this.timers.set(task.id, timer);
  }

  private clearTaskTimer(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) clearTimeout(timer);
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
        CREATE INDEX IF NOT EXISTS idx_sentinel_trips_status
          ON sentinel_trips (status);
        CREATE INDEX IF NOT EXISTS idx_sentinel_trips_dirty_updated
          ON sentinel_trips (is_dirty, updated_at DESC);
      `);
    });
  }

  private async listScannableTasks(): Promise<TripTaskRow[]> {
    return withTrankilV2Database(async (db) => {
      const rows = await db.getAllAsync<Record<string, unknown>>(
        `SELECT * FROM ${this.tableName} WHERE status IN ('ACTIVE','PENDING_CONFIRMATION','ERROR')`
      );
      return rows.map(this.rowToTask);
    });
  }

  private async getTaskById(taskId: string): Promise<TripTaskRow | null> {
    return withTrankilV2Database(async (db) => {
      const row = await db.getFirstAsync<Record<string, unknown>>(
        `SELECT * FROM ${this.tableName} WHERE id = ?`,
        [taskId]
      );
      return row ? this.rowToTask(row) : null;
    });
  }

  private async updateTaskStatus(taskId: string, status: TrafficTaskStatus): Promise<void> {
    await withTrankilV2Database(async (db) => {
      await db.runAsync(`UPDATE ${this.tableName} SET status = ? WHERE id = ?`, [status, taskId]);
    });
  }

  private async persistAfterScan(
    taskId: string,
    patch: Partial<{
      lastTrafficDuration: number;
      internalScanCount: number;
      nextCheckAt: number | null;
      status: TrafficTaskStatus;
      gatePromptedAt: number | null;
      lastErrorAt: number | null;
      tOptimisteMs: number | null;
      tPessimisteMs: number | null;
      vigilanceStatus: string | null;
    }>
  ): Promise<void> {
    await withTrankilV2Database(async (db) => {
      await db.runAsync(
        `UPDATE ${this.tableName}
           SET last_traffic_duration = COALESCE(?, last_traffic_duration),
               internal_scan_count = COALESCE(?, internal_scan_count),
               next_check_at = COALESCE(?, next_check_at),
               status = COALESCE(?, status),
               gate_prompted_at = COALESCE(?, gate_prompted_at),
               last_error_at = ?,
               t_optimiste_ms = COALESCE(?, t_optimiste_ms),
               t_pessimiste_ms = COALESCE(?, t_pessimiste_ms),
               vigilance_status = COALESCE(?, vigilance_status),
               target_duration_sec = target_duration_sec
         WHERE id = ?`,
        [
          patch.lastTrafficDuration ?? null,
          patch.internalScanCount ?? null,
          patch.nextCheckAt ?? null,
          patch.status ?? null,
          patch.gatePromptedAt ?? null,
          patch.lastErrorAt ?? null,
          patch.tOptimisteMs ?? null,
          patch.tPessimisteMs ?? null,
          patch.vigilanceStatus ?? null,
          taskId,
        ]
      );
    });
  }

  private rowToTask = (row: Record<string, unknown>): TripTaskRow => ({
    id: String(row.id ?? ''),
    destination: String(row.destination ?? ''),
    arrivalAtMs: Number(row.arrival_at_ms ?? 0),
    status: String(row.status ?? 'PAUSED') as TrafficTaskStatus,
    sentinelMode:
      String(row.sentinel_mode ?? 'SENTINEL').toUpperCase() === 'STATIC' ? 'STATIC' : 'SENTINEL',
    targetDurationSec: Number(row.target_duration_sec ?? 0),
    lastTrafficDuration: Number(row.last_traffic_duration ?? 0),
    internalScanCount: Number(row.internal_scan_count ?? 0),
    nextCheckAt: row.next_check_at == null ? null : Number(row.next_check_at),
    gatePromptedAt: row.gate_prompted_at == null ? null : Number(row.gate_prompted_at),
    lastErrorAt: row.last_error_at == null ? null : Number(row.last_error_at),
    tOptimisteMs: row.t_optimiste_ms == null ? null : Number(row.t_optimiste_ms),
    tPessimisteMs: row.t_pessimiste_ms == null ? null : Number(row.t_pessimiste_ms),
    vigilanceStatus: row.vigilance_status == null ? null : String(row.vigilance_status),
  });
}
