import type { TrankilV2TimelineItemRow } from '../api/trankilV2Db';
import { addDaysYmd, formatYmdLocal } from '../services/TimeSorter';
import { formatCreationSubtitle } from '../utils/timeFormat';
import { isSourcedCaptureParent } from './inboxRootsView';
import {
  formatTravelProjectInboxLine2,
  parseProjectBriefFromMetadataJson,
  resolveTravelProjectMilestoneCount,
} from './travelProjectModel';
import { formatZoomDecomposedInboxLine2 } from './zoomInboxModel';
import { isSourcingShellMetadata } from './sourcingTitle';
import { getTripMetaFromRoot } from './tripTimelineCard';

export type InboxLinePresentation = {
  line1: string;
  line2: string;
};

export type ResolveInboxLineInput = {
  row: TrankilV2TimelineItemRow;
  locale: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  /** Enfants chargés côté accordéon sourcing (prioritaire sur child_ids metadata). */
  sourcingChildCount?: number;
  /** Badge +N étapes visible — masquer le compteur en ligne 2. */
  omitTravelMilestoneInLine2?: boolean;
  /** Progression sous-tâches zoom (ancre décomposée). */
  zoomDecomposeProgress?: { done: number; total: number };
};

function capitalizeFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

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

function parseHm(raw: string | null): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (!/^\d{1,2}:\d{2}$/.test(s)) return null;
  const [hh, mm] = s.split(':').map((n) => Number(n));
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function parseDueDate(raw: string | null | undefined): { date: Date; hasTime: boolean } | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (/^\d{8}$/.test(value)) {
    const y = Number(value.slice(0, 4));
    const m = Number(value.slice(4, 6));
    const d = Number(value.slice(6, 8));
    const date = new Date(y, m - 1, d, 12, 0, 0, 0);
    return Number.isFinite(date.getTime()) ? { date, hasTime: false } : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map((n) => Number(n));
    const date = new Date(y, m - 1, d, 12, 0, 0, 0);
    return Number.isFinite(date.getTime()) ? { date, hasTime: false } : null;
  }
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const hasTime = /T\d{2}:\d{2}/.test(value) || /\d{2}:\d{2}/.test(value);
  return { date: d, hasTime };
}

function isCreatedToday(createdAt: number, now = new Date()): boolean {
  const createdKey = formatYmdLocal(new Date(createdAt));
  const todayKey = formatYmdLocal(now);
  return createdKey === todayKey;
}

function isTripRow(meta: Record<string, unknown> | null): boolean {
  if (getTripMetaFromRoot(meta)) return true;
  if (meta?.logisticsPotential === true) return true;
  const draft = meta?.gemini_universal_draft;
  if (draft && typeof draft === 'object' && !Array.isArray(draft)) {
    const predicted = String((draft as Record<string, unknown>).predictedType ?? '').trim();
    if (predicted === 'TRIP') return true;
  }
  return false;
}

function resolveTripDestination(
  meta: Record<string, unknown> | null,
  trip: Record<string, unknown> | null,
): string {
  return (
    str(trip, 'destination_name') ??
    str(trip, 'destination') ??
    str(meta, 'destination_name') ??
    ''
  );
}

function resolveTripEventTitle(
  row: TrankilV2TimelineItemRow,
  meta: Record<string, unknown> | null,
  trip: Record<string, unknown> | null,
): string {
  const displayTitle = String(row.display_title || '').trim();
  const destination = resolveTripDestination(meta, trip);
  const eventFromTrip = String(trip?.trip_event_label ?? trip?.content ?? '').trim();
  const draft = meta?.gemini_universal_draft;
  let draftTitle = '';
  let draftDest = '';
  if (draft && typeof draft === 'object' && !Array.isArray(draft)) {
    const d = draft as Record<string, unknown>;
    draftTitle = String(d.title ?? '').trim();
    const data = d.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      draftDest = String((data as Record<string, unknown>).destination_name ?? '').trim();
    }
  }

  if (displayTitle && destination && displayTitle.toLowerCase() === destination.toLowerCase()) {
    if (eventFromTrip && eventFromTrip.toLowerCase() !== destination.toLowerCase()) return eventFromTrip;
    if (draftTitle && draftDest && draftTitle.toLowerCase() !== draftDest.toLowerCase()) return draftTitle;
  }
  return displayTitle;
}

type TemporalParts = { dayLabel: string | null; timeLabel: string | null };

function buildTemporalParts(
  row: TrankilV2TimelineItemRow,
  meta: Record<string, unknown> | null,
  trip: Record<string, unknown> | null,
  t: ResolveInboxLineInput['t'],
  locale: string,
): TemporalParts {
  const now = new Date();
  const todayKey = formatYmdLocal(now);
  const tomorrowKey = addDaysYmd(now, 1);

  const rootDueIso = str(meta, 'dueDateTime');
  const rootYmd = str(meta, 'dueDateYmd');
  const rootHm = parseHm(str(meta, 'dueTimeHm'));
  const tripArrivalIso = str(trip, 'arrivalDue');
  const tripDueIso = str(trip, 'dueDateTime');
  const tripYmd = str(trip, 'dueDateYmd');
  const tripHm = parseHm(str(trip, 'dueTimeHm'));

  const baseParsed = parseDueDate(row.due_date);
  const isoSource = tripArrivalIso || tripDueIso || rootDueIso;
  const parsedIso = isoSource ? parseDueDate(isoSource) : null;
  const dueRef =
    parsedIso?.date ??
    (tripYmd ? parseDueDate(tripYmd)?.date : null) ??
    (rootYmd ? parseDueDate(rootYmd)?.date : null) ??
    baseParsed?.date ??
    null;

  if (!dueRef) {
    return { dayLabel: null, timeLabel: null };
  }

  const dueKey = formatYmdLocal(dueRef);
  const dayLabel =
    dueKey === todayKey
      ? t('horizons.today')
      : dueKey === tomorrowKey
        ? t('horizons.tomorrow')
        : capitalizeFirst(new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(dueRef));
  const isoTimeLabel =
    parsedIso?.hasTime && parsedIso.date
      ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(parsedIso.date)
      : null;
  const baseTimeLabel =
    baseParsed?.hasTime && baseParsed.date
      ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(baseParsed.date)
      : null;
  const timeLabel = tripHm || isoTimeLabel || rootHm || baseTimeLabel;
  return { dayLabel, timeLabel };
}

function joinParts(parts: Array<string | null | undefined>, sep = ' · '): string {
  return parts.map((p) => String(p ?? '').trim()).filter(Boolean).join(sep);
}

function countListItems(meta: Record<string, unknown> | null): number | null {
  const list = meta?.list;
  if (!list || typeof list !== 'object' || Array.isArray(list)) return null;
  const cats = (list as Record<string, unknown>).categories;
  if (!Array.isArray(cats)) return null;
  let total = 0;
  for (const cat of cats) {
    if (!cat || typeof cat !== 'object' || Array.isArray(cat)) continue;
    const items = (cat as Record<string, unknown>).items;
    if (Array.isArray(items)) total += items.length;
  }
  return total > 0 ? total : null;
}

function resolveSourcingChildCount(row: TrankilV2TimelineItemRow, override?: number): number {
  if (typeof override === 'number' && override > 0) return override;
  const fromMeta = row.sourcing_v1?.child_ids?.length ?? 0;
  return fromMeta;
}

function buildTaskMomentLine2(
  row: TrankilV2TimelineItemRow,
  meta: Record<string, unknown> | null,
  trip: Record<string, unknown> | null,
  t: ResolveInboxLineInput['t'],
  locale: string,
): string {
  const hint = String(row.sourcing_v1?.source_hint ?? '').trim();
  const seriesLen = row.sourcing_v1?.event_series_v1?.slots?.length ?? 0;
  if (seriesLen >= 2) {
    return `${seriesLen} créneaux`;
  }

  const { dayLabel, timeLabel } = buildTemporalParts(row, meta, trip, t, locale);
  if (dayLabel && timeLabel) return `${dayLabel} · ${timeLabel}`;
  if (dayLabel) return `${dayLabel} · ${t('timeline.allDuration')}`;
  if (hint) return hint;
  if (isCreatedToday(Number(row.created_at))) {
    return t('timeline.newBadge', { defaultValue: 'NEW' });
  }
  return '';
}

export function resolveInboxLinePresentation(input: ResolveInboxLineInput): InboxLinePresentation {
  const { row, locale, t, sourcingChildCount, omitTravelMilestoneInLine2, zoomDecomposeProgress } = input;
  const meta = safeParseJsonObject(row.metadata_json);
  const trip = getTripMetaFromRoot(meta);
  const untitled = t('timeline.untitled');

  if (isSourcedCaptureParent(row) && isSourcingShellMetadata(row.metadata_json)) {
    const count = resolveSourcingChildCount(row, sourcingChildCount);
    return {
      line1: String(row.display_title || '').trim() || untitled,
      line2:
        count > 0
          ? t('timeline.sourcingBatchBadge', {
              count,
              defaultValue: `${count} actions extraites`,
            })
          : String(row.sourcing_v1?.source_hint ?? '').trim(),
    };
  }

  if (isTripRow(meta)) {
    const destination = resolveTripDestination(meta, trip);
    const line1 = resolveTripEventTitle(row, meta, trip) || untitled;
    const { dayLabel, timeLabel } = buildTemporalParts(row, meta, trip, t, locale);
    const line2 = joinParts([destination, dayLabel, timeLabel]);
    return {
      line1,
      line2: line2 || formatCreationSubtitle(Number(row.created_at), t, locale),
    };
  }

  if (row.type === 'HABIT' || row.type === 'RECURRING_TASK') {
    const cadence =
      str(meta, 'cadenceDescription') ??
      (meta?.recurring_task && typeof meta.recurring_task === 'object'
        ? str(meta.recurring_task as Record<string, unknown>, 'cadenceDescription')
        : null);
    return {
      line1: String(row.display_title || '').trim() || untitled,
      line2: cadence || formatCreationSubtitle(Number(row.created_at), t, locale),
    };
  }

  if (row.type === 'LIST') {
    const itemCount = countListItems(meta);
    return {
      line1: String(row.display_title || '').trim() || untitled,
      line2:
        itemCount != null
          ? t('timeline.inboxListItemCount', {
              count: itemCount,
              defaultValue: `${itemCount} éléments`,
            })
          : formatCreationSubtitle(Number(row.created_at), t, locale),
    };
  }

  if (row.type === 'PROJECT' || row.type === 'NOTE') {
    if (zoomDecomposeProgress && zoomDecomposeProgress.total > 0) {
      return {
        line1: String(row.display_title || '').trim() || untitled,
        line2: formatZoomDecomposedInboxLine2({
          done: zoomDecomposeProgress.done,
          total: zoomDecomposeProgress.total,
          t,
        }),
      };
    }
  }

  if (row.type === 'PROJECT') {
    const brief = parseProjectBriefFromMetadataJson(row.metadata_json);
    const milestoneCount = resolveTravelProjectMilestoneCount(row.metadata_json);
    const dueYmd =
      String(row.due_date ?? '').trim().slice(0, 10) ||
      brief?.departure_ymd ||
      null;
    const travelLine2 =
      brief || milestoneCount != null || dueYmd
        ? formatTravelProjectInboxLine2({
            brief,
            milestoneCount,
            dueYmd: dueYmd && /^\d{4}-\d{2}-\d{2}/.test(dueYmd) ? dueYmd.slice(0, 10) : null,
            locale,
            t,
            omitMilestoneInLine2: omitTravelMilestoneInLine2,
          })
        : null;
    if (travelLine2) {
      return {
        line1: String(row.display_title || '').trim() || untitled,
        line2: travelLine2,
      };
    }
    const itemCount = countListItems(meta);
    return {
      line1: String(row.display_title || '').trim() || untitled,
      line2:
        itemCount != null
          ? t('timeline.inboxProjectItemCount', {
              count: itemCount,
              defaultValue: `${itemCount} étapes`,
            })
          : t('timeline.inboxProjectLabel', { defaultValue: 'Projet' }),
    };
  }

  const hint = String(row.sourcing_v1?.source_hint ?? '').trim();
  const momentPart = buildTaskMomentLine2(row, meta, trip, t, locale);
  let line2 = momentPart;
  if (hint && momentPart) {
    line2 = `${hint} · ${momentPart}`;
  } else if (hint) {
    line2 = hint;
  } else if (!momentPart) {
    line2 = formatCreationSubtitle(Number(row.created_at), t, locale);
  }

  return {
    line1: String(row.display_title || '').trim() || untitled,
    line2,
  };
}
