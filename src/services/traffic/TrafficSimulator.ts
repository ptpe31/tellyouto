import type { TripTaskRow, TrafficSample } from './TrafficScheduler';

export const SIM_TIME_WARP_FACTOR = 60;
export const SIM_INNER_SAFETY_MARGIN_SEC = 300;

export type TrafficSimulationLogRow = {
  SimTime: string;
  RealDuration: number;
  StabilizedDuration: number;
  NextJump: number;
  BufferSafety: number;
};

/**
 * Banc d'essai local:
 * - 1s reel = 1min simulee
 * - base 25 min
 * - "accident" +15 min apres 30s reelles
 */
export class TrafficSimulator {
  private readonly baseTrafficSec = 25 * 60;
  private readonly accidentDeltaSec = 15 * 60;
  private readonly accidentAfterRealSec = 30;
  private realStartedAtMs = 0;
  private simStartedAtMs = 0;
  private dumped = false;
  private readonly logs: TrafficSimulationLogRow[] = [];

  start(simStartMs = Date.now()): void {
    this.realStartedAtMs = Date.now();
    this.simStartedAtMs = simStartMs;
    this.dumped = false;
    this.logs.length = 0;
  }

  getCurrentSimulatedNowMs(): number {
    if (this.realStartedAtMs <= 0) return this.simStartedAtMs || Date.now();
    const elapsedRealMs = Date.now() - this.realStartedAtMs;
    return this.simStartedAtMs + elapsedRealMs * SIM_TIME_WARP_FACTOR;
  }

  /**
   * Source mock pour le scheduler (remplace Maps).
   */
  async getNextMockTraffic(task: TripTaskRow): Promise<TrafficSample> {
    const nowSimMs = this.getCurrentSimulatedNowMs();
    const elapsedRealSec = (Date.now() - this.realStartedAtMs) / 1000;
    const hasAccident = elapsedRealSec >= this.accidentAfterRealSec;
    const trafficDurationSec = hasAccident
      ? this.baseTrafficSec + this.accidentDeltaSec
      : this.baseTrafficSec;

    const criticalDepartureAtMs =
      task.arrivalAtMs - (trafficDurationSec + SIM_INNER_SAFETY_MARGIN_SEC) * 1000;
    const bufferSafetyMin = (criticalDepartureAtMs - nowSimMs) / 60_000;
    if (bufferSafetyMin <= 0 && !this.dumped) {
      this.dumped = true;
      this.dumpSimulationLogs();
    }

    return {
      trafficDurationSec,
      staticDurationSec: this.baseTrafficSec,
      simulatedNowMs: nowSimMs,
      timeWarpFactor: SIM_TIME_WARP_FACTOR,
    };
  }

  /**
   * Capture un point de monitoring pour partage IA.
   */
  recordLog(input: {
    simulatedNowMs: number;
    realDurationSec: number;
    stabilizedDurationSec: number;
    nextJumpMs: number;
    arrivalAtMs: number;
  }): void {
    const criticalDepartureAtMs =
      input.arrivalAtMs - (input.stabilizedDurationSec + SIM_INNER_SAFETY_MARGIN_SEC) * 1000;
    const bufferSafetyMin = (criticalDepartureAtMs - input.simulatedNowMs) / 60_000;
    this.logs.push({
      SimTime: new Date(input.simulatedNowMs).toISOString(),
      RealDuration: Math.round(input.realDurationSec),
      StabilizedDuration: Math.round(input.stabilizedDurationSec),
      NextJump: Math.round(input.nextJumpMs),
      BufferSafety: Number(bufferSafetyMin.toFixed(2)),
    });
  }

  /**
   * Rapport final, format Markdown (partageable facilement).
   */
  dumpSimulationLogs(): string {
    const header =
      '| SimTime | RealDuration | StabilizedDuration | NextJump | BufferSafety |\n' +
      '|---|---:|---:|---:|---:|';
    const lines = this.logs.map(
      (r) =>
        `| ${r.SimTime} | ${r.RealDuration} | ${r.StabilizedDuration} | ${r.NextJump} | ${r.BufferSafety} |`
    );
    const report = [header, ...lines].join('\n');
    console.log('[TrafficSimulator] dumpSimulationLogs\n' + report);
    return report;
  }
}

