import type { TrankilV2TimelineItemRow } from '../../api';

/** Normalise `due_date` SQLite en YYYY-MM-DD local. */
export function normalizeRowDueYmd(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}

export function isRowPinned(row: TrankilV2TimelineItemRow): boolean {
  return Number(row.is_pinned ?? 0) === 1;
}

export function isRowDueOnYmd(row: TrankilV2TimelineItemRow, ymd: string): boolean {
  const due = normalizeRowDueYmd(row.due_date);
  return Boolean(due && due === ymd);
}

/**
 * Bloc « Rappel » : toutes les intentions épinglées visibles dans la feuille du jour.
 */
export function extractReminderBlockRows(rows: TrankilV2TimelineItemRow[]): TrankilV2TimelineItemRow[] {
  return rows.filter(isRowPinned);
}

/**
 * Segments Matin / AM / Soir : exclure les épinglées sans échéance aujourd'hui.
 * Exception : épinglée avec `due_date` = jour courant → peut aussi apparaître dans son créneau horaire.
 */
export function shouldRowAppearInTimeSegments(row: TrankilV2TimelineItemRow, todayYmd: string): boolean {
  if (!isRowPinned(row)) return true;
  return isRowDueOnYmd(row, todayYmd);
}

function ymdToUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map((x) => Number(x));
  return Date.UTC(y, m - 1, d);
}

/** Jours restants jusqu'à l'échéance (0 = aujourd'hui). */
export function computeDaysUntilDue(dueYmd: string, todayYmd: string): number {
  const diff = ymdToUtcMs(dueYmd) - ymdToUtcMs(todayYmd);
  return Math.round(diff / 86_400_000);
}

/**
 * Tri bloc Rappel :
 * 1. Intentions datées (échéance croissante)
 * 2. Sans date (épinglage manuel, `updated_at` DESC)
 */
export function sortReminderBlockRows(
  rows: TrankilV2TimelineItemRow[],
  _todayYmd: string,
): TrankilV2TimelineItemRow[] {
  const dated: TrankilV2TimelineItemRow[] = [];
  const undated: TrankilV2TimelineItemRow[] = [];
  for (const row of rows) {
    if (normalizeRowDueYmd(row.due_date)) dated.push(row);
    else undated.push(row);
  }
  dated.sort((a, b) => {
    const da = normalizeRowDueYmd(a.due_date) ?? '';
    const db = normalizeRowDueYmd(b.due_date) ?? '';
    if (da !== db) return da.localeCompare(db);
    return Number(b.updated_at ?? b.created_at) - Number(a.updated_at ?? a.created_at);
  });
  undated.sort((a, b) => Number(b.updated_at ?? b.created_at) - Number(a.updated_at ?? a.created_at));
  return [...dated, ...undated];
}

/** Détecte une contrainte « Avant le [date] » (IA ou transcript). */
export function resolveDueConstraintFromCapture(
  data: Record<string, unknown>,
  transcript: string,
): 'BEFORE' | null {
  const raw = String(data.due_constraint ?? data.dueConstraint ?? '').trim().toUpperCase();
  if (raw === 'BEFORE') return 'BEFORE';
  const t = String(transcript ?? '').trim();
  if (!t) return null;
  if (/\b(avant le|avant|before the|by the|d'ici le|au plus tard|no later than)\b/i.test(t)) {
    return 'BEFORE';
  }
  return null;
}

/**
 * Auto-épingle à la persistance : échéance « Avant le » ou deadline future sans heure précise.
 */
export function shouldAutoPinOnCapturePersist(params: {
  data: Record<string, unknown>;
  transcript: string;
  dueDateYmd: string | null;
  timeMarker: 'ALL_DAY' | 'EXACT_TIME';
  dueTimeHm: string | null;
  todayYmd: string;
}): boolean {
  if (resolveDueConstraintFromCapture(params.data, params.transcript) === 'BEFORE') {
    return true;
  }
  const due = params.dueDateYmd;
  if (!due || due <= params.todayYmd) return false;
  if (params.timeMarker === 'EXACT_TIME' && params.dueTimeHm && params.dueTimeHm !== '00:00') {
    return false;
  }
  return true;
}
