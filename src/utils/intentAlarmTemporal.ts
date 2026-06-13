import type { TrankilV2TimelineItemRow } from '../api';
import { formatYmdLocal } from '../services/TimeSorter';
import { parseRowTemporalMeta } from '../features/livingHub/parseRowTemporalMeta';
import {
  resolveElasticDepartureAlarmUnixSec,
  type TripElasticCapsuleModel,
} from './tripElasticCapsuleModel';

export const INTENT_ALARM_WITNESS_GRACE_MS = 15 * 60 * 1000;

function safeParseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  } catch {
    return null;
  }
}

function str(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function parseDueDateYmd(due_date: string | null | undefined): string | null {
  const raw = String(due_date ?? '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return null;
  return formatYmdLocal(d);
}

function extractYmdFromIso(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Jour effectif `YYYY-MM-DD` (due_date SQLite ou metadata). */
export function resolveIntentionDueYmd(row: TrankilV2TimelineItemRow): string | null {
  const meta = safeParseJsonObject(row.metadata_json);
  const trip =
    meta?.trip && typeof meta.trip === 'object' && !Array.isArray(meta.trip)
      ? (meta.trip as Record<string, unknown>)
      : null;
  return (
    parseDueDateYmd(row.due_date) ??
    str(meta, 'dueDateYmd') ??
    str(meta, 'due_date') ??
    str(trip, 'dueDateYmd') ??
    extractYmdFromIso(str(meta, 'dueDateTime')) ??
    extractYmdFromIso(str(trip, 'dueDateTime')) ??
    extractYmdFromIso(str(trip, 'arrivalDue'))
  );
}

export function isIntentionDueToday(row: TrankilV2TimelineItemRow, now: Date = new Date()): boolean {
  const ymd = resolveIntentionDueYmd(row);
  if (!ymd) return false;
  return ymd === formatYmdLocal(now);
}

export function readIntentionAlarmSetFlag(metadataJson: string | null | undefined): boolean {
  const meta = safeParseJsonObject(metadataJson);
  return meta?.is_alarm_set === true;
}

export function mergeMetadataJsonString(
  current: string | null | undefined,
  patch: Record<string, unknown>,
): string {
  const root = safeParseJsonObject(current) ?? {};
  return JSON.stringify({ ...root, ...patch });
}

export function formatHmFromUnix(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

type ResolveAlarmOpts = {
  tripCapsuleModel?: TripElasticCapsuleModel | null;
};

/**
 * Horodatage ms de l’événement effectif (heure du rappel ou fin de journée si toute la journée).
 */
export function resolveIntentionEffectiveEventMs(
  row: TrankilV2TimelineItemRow,
  opts?: ResolveAlarmOpts,
): number | null {
  if (opts?.tripCapsuleModel) {
    const unix = resolveElasticDepartureAlarmUnixSec(
      opts.tripCapsuleModel.startMs,
      opts.tripCapsuleModel.endMs,
    );
    if (unix != null) return unix * 1000;
  }

  const ymd = resolveIntentionDueYmd(row);
  if (!ymd) return null;

  const { hasStrictTime, dueTimeHm } = parseRowTemporalMeta(row);
  const [y, m, d] = ymd.split('-').map((n) => Number(n));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;

  if (hasStrictTime && dueTimeHm) {
    const [hh, mm] = dueTimeHm.split(':').map((n) => Number(n));
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
  }

  return new Date(y, m - 1, d, 23, 59, 0, 0).getTime();
}

/** Timestamp Unix (s) local pour `AlarmService.openAlarmSelection`. */
export function resolveIntentionAlarmUnixSec(
  row: TrankilV2TimelineItemRow,
  opts?: ResolveAlarmOpts,
): number | null {
  const ms = resolveIntentionEffectiveEventMs(row, opts);
  if (ms == null || ms <= 0) return null;
  return Math.floor(ms / 1000);
}

/** Intention avec date d'échéance résolue (TASK, TRIP, HABIT, etc.). */
export function hasIntentionSchedulableDueDate(row: TrankilV2TimelineItemRow): boolean {
  return resolveIntentionDueYmd(row) != null;
}

/**
 * ISO 8601 pour planification notification — reconstruit depuis `dueDateYmd` + `dueTimeHm`
 * si `dueDateTime` est absent en métadonnées.
 */
export function resolveIntentionDueDateTimeIso(
  row: TrankilV2TimelineItemRow,
  opts?: ResolveAlarmOpts,
): string | null {
  const ms = resolveIntentionEffectiveEventMs(row, opts);
  if (ms == null || ms <= 0) return null;
  return new Date(ms).toISOString();
}

export function isIntentionAlarmWitnessVisible(
  metadataJson: string | null | undefined,
  row: TrankilV2TimelineItemRow,
  nowMs: number,
  opts?: ResolveAlarmOpts,
): boolean {
  if (!readIntentionAlarmSetFlag(metadataJson)) return false;
  const effectiveMs = resolveIntentionEffectiveEventMs(row, opts);
  if (effectiveMs == null) return true;
  return nowMs < effectiveMs + INTENT_ALARM_WITNESS_GRACE_MS;
}

/** Diagnostic DEV — comprendre pourquoi le bouton « Planifier une alarme » est masqué. */
export function buildIntentAlarmVisibilityDebug(
  row: TrankilV2TimelineItemRow | null | undefined,
  opts?: ResolveAlarmOpts,
): Record<string, unknown> {
  if (!row) {
    return { intentionId: null, hasDueDate: false, reason: 'no_row' };
  }
  const meta = safeParseJsonObject(row.metadata_json);
  const trip =
    meta?.trip && typeof meta.trip === 'object' && !Array.isArray(meta.trip)
      ? (meta.trip as Record<string, unknown>)
      : null;
  const { hasStrictTime, dueTimeHm, timeMarker } = parseRowTemporalMeta(row);
  const resolvedDueYmd = resolveIntentionDueYmd(row);
  return {
    intentionId: row.id,
    type: row.type,
    hasDueDate: resolvedDueYmd != null,
    resolvedDueYmd,
    sources: {
      sqliteDueDate: row.due_date ?? null,
      metaDueDateYmd: str(meta, 'dueDateYmd'),
      metaDueDateLower: str(meta, 'due_date'),
      metaDueDateTime: str(meta, 'dueDateTime'),
      tripDueDateYmd: str(trip, 'dueDateYmd'),
      tripArrivalDue: str(trip, 'arrivalDue'),
    },
    temporal: {
      timeMarker,
      hasStrictTime,
      dueTimeHm,
      alarmUnixSec: resolveIntentionAlarmUnixSec(row, opts),
      dueDateTimeIso: resolveIntentionDueDateTimeIso(row, opts),
    },
  };
}
