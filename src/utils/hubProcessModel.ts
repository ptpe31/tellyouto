import type { TrankilV2TimelineItemRow } from '../api/trankilV2Db';
import { parseProjectBriefFromMetadataJson } from './travelProjectModel';
import { getTripMetaFromRoot } from './tripTimelineCard';

/** Contexte hub Smart Clusters → surface de traitement unifiée (`IdeaBankModal`). */
export type HubContext =
  | { kind: 'inbox' }
  | { kind: 'box' }
  | { kind: 'shop' }
  | { kind: 'routine' }
  | { kind: 'block' };

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

function isYmd(value: string | null): boolean {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

/** Intention planifiée (colonne SQLite ou metadata / TRIP / brief voyage). */
export function resolveRowIsScheduled(row: TrankilV2TimelineItemRow): boolean {
  if (String(row.due_date ?? '').trim()) return true;

  const meta = safeParseJsonObject(row.metadata_json);
  if (!meta) return false;

  const rootYmd = str(meta, 'dueDateYmd');
  if (isYmd(rootYmd)) return true;
  if (str(meta, 'dueDateTime')) return true;

  const trip = getTripMetaFromRoot(meta);
  if (trip) {
    if (isYmd(str(trip, 'dueDateYmd'))) return true;
    if (str(trip, 'dueDateTime')) return true;
    if (str(trip, 'arrivalDue')) return true;
  }

  const brief = parseProjectBriefFromMetadataJson(row.metadata_json);
  if (brief?.departure_ymd && isYmd(String(brief.departure_ymd).slice(0, 10))) return true;

  return false;
}

/** Exclut du stock Box les lignes planifiées en metadata mais pas encore en colonne `due_date`. */
export function filterUnscheduledBoxStockRows(rows: TrankilV2TimelineItemRow[]): TrankilV2TimelineItemRow[] {
  return rows.filter((row) => !resolveRowIsScheduled(row));
}

export function resolveHubProcessPool(params: {
  hubContext: HubContext;
  hubBlockItems: TrankilV2TimelineItemRow[] | null;
  inboxTodayItems: TrankilV2TimelineItemRow[];
  boxStockRows: TrankilV2TimelineItemRow[];
  shopClusterRows: TrankilV2TimelineItemRow[];
}): TrankilV2TimelineItemRow[] {
  if (params.hubBlockItems) return params.hubBlockItems;
  switch (params.hubContext.kind) {
    case 'inbox':
      return params.inboxTodayItems;
    case 'shop':
      return params.shopClusterRows;
    case 'box':
      return params.boxStockRows;
    default:
      return params.boxStockRows;
  }
}

export function resolveHubModalDefaultTitle(
  hubContext: HubContext,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  switch (hubContext.kind) {
    case 'inbox':
      return t('timeline.smartClusters.inbox');
    case 'box':
      return t('timeline.box.title');
    case 'shop':
      return t('timeline.ideaBank.shopTitle');
    case 'routine':
      return t('timeline.routines.title');
    default:
      return t('timeline.ideaBank.title');
  }
}
