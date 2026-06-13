/**
 * Parse les dates Pass 1 (`YYYY-MM-DD HH:mm`) pour React Native / Hermes.
 * Le format avec espace peut produire `Invalid Date` sur certains moteurs JS.
 *
 * @module pass1DueDateParse
 */

export type Pass1DueParseResult = {
  dueDateTime: string | null;
  dueDateYmd: string | null;
  dueTimeHm: string | null;
  timeMarker: 'ALL_DAY' | 'EXACT_TIME';
};

export function parsePass1DueDateTime(raw: string): Pass1DueParseResult {
  const empty: Pass1DueParseResult = {
    dueDateTime: null,
    dueDateYmd: null,
    dueTimeHm: null,
    timeMarker: 'ALL_DAY',
  };
  const trimmed = String(raw || '').trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') return empty;

  const ymdHm = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (ymdHm) {
    const [, ymd, hhRaw, mmRaw] = ymdHm;
    const hh = String(Math.min(23, Math.max(0, parseInt(hhRaw, 10)))).padStart(2, '0');
    const mm = String(Math.min(59, Math.max(0, parseInt(mmRaw, 10)))).padStart(2, '0');
    const dueTimeHm = `${hh}:${mm}`;
    const localIso = `${ymd}T${hh}:${mm}:00`;
    const dt = new Date(localIso);
    const dueDateTime = Number.isNaN(dt.getTime()) ? null : dt.toISOString();
    const isMidnight = hh === '00' && mm === '00';
    return {
      dueDateTime,
      dueDateYmd: ymd,
      dueTimeHm: isMidnight ? null : dueTimeHm,
      timeMarker: isMidnight ? 'ALL_DAY' : 'EXACT_TIME',
    };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { ...empty, dueDateYmd: trimmed, timeMarker: 'ALL_DAY' };
  }

  const safeForDate = trimmed.includes(' ') && !trimmed.includes('T') ? trimmed.replace(' ', 'T') : trimmed;
  const dt = new Date(safeForDate);
  if (Number.isNaN(dt.getTime())) return empty;

  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const hasExplicitTime = /[ T]\d{1,2}:\d{2}/.test(trimmed);
  const isMidnight = hh === '00' && mm === '00';
  const timeMarker = hasExplicitTime && !isMidnight ? 'EXACT_TIME' : 'ALL_DAY';
  return {
    dueDateTime: dt.toISOString(),
    dueDateYmd: `${y}-${m}-${d}`,
    dueTimeHm: timeMarker === 'EXACT_TIME' ? `${hh}:${mm}` : null,
    timeMarker,
  };
}

export function applyPass1DueFields(target: Record<string, unknown>, rawDue: string): Pass1DueParseResult {
  const parsed = parsePass1DueDateTime(rawDue);
  if (parsed.dueDateTime) target.dueDateTime = parsed.dueDateTime;
  if (parsed.dueDateYmd) target.dueDateYmd = parsed.dueDateYmd;
  if (parsed.dueTimeHm) target.dueTimeHm = parsed.dueTimeHm;
  target.arrivalDue = rawDue.trim();
  target.timeMarker = parsed.timeMarker;
  target.is_all_day = parsed.timeMarker === 'ALL_DAY' ? 1 : 0;
  return parsed;
}
