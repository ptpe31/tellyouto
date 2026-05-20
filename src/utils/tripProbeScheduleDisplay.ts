import { formatHmLocal } from './tripTimeHelpers';

/** Fenêtre avant l'heure planifiée où l'on bascule vers « Scan en cours… ». */
export const PROBE_SCHEDULE_IMMINENT_MS = 60_000;

export type ProbeScheduleLabelState = 'scheduled' | 'inProgress';

export function resolveProbeScheduleState(
  nextProbeAtMs: number | null | undefined,
  nowMs: number = Date.now(),
): ProbeScheduleLabelState {
  const at = Number(nextProbeAtMs);
  if (!Number.isFinite(at) || at <= 0) return 'inProgress';
  if (at <= nowMs + PROBE_SCHEDULE_IMMINENT_MS) return 'inProgress';
  return 'scheduled';
}

/** Libellé badge Timeline / sheet pour PROBE1 pending. */
export function resolveProbeScheduleLabel(input: {
  nextProbeAtMs: number | null | undefined;
  locale: string;
  nowMs?: number;
  t: (key: string, opts?: Record<string, unknown>) => string;
}): string {
  const nowMs = Number(input.nowMs ?? Date.now());
  const state = resolveProbeScheduleState(input.nextProbeAtMs, nowMs);
  if (state === 'inProgress') {
    return input.t('timeline.scanTrafficInProgress');
  }
  const at = Number(input.nextProbeAtMs);
  const time = formatHmLocal(at, input.locale);
  return input.t('timeline.scanTrafficScheduled', { time: time || '—' });
}

/** @deprecated Préférer resolveProbeScheduleLabel */
export function formatNextProbeScheduleLabel(
  nextProbeAtMs: number | null | undefined,
  locale: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
  nowMs?: number,
): string {
  return resolveProbeScheduleLabel({ nextProbeAtMs, locale, nowMs, t });
}
