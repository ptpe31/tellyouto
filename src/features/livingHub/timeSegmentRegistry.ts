/** Segments temporels de la chronologie narrative (vue Aujourd'hui). */
export const TIME_SEGMENT_ORDER = ['MORNING', 'AFTERNOON', 'EVENING', 'REMINDER'] as const;

export type TimeSegmentId = (typeof TIME_SEGMENT_ORDER)[number];

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map((x) => Number(x));
  return h * 60 + m;
}

/** Matin 06h–12h, Après-midi 12h–18h, Soir 18h–23h ; sans heure → `null` (routage côté builder). */
export function resolveTimeSegmentFromHm(hm: string | null | undefined): TimeSegmentId | null {
  const s = String(hm ?? '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(s)) return null;
  const minutes = hmToMinutes(s);
  if (minutes >= 6 * 60 && minutes < 12 * 60) return 'MORNING';
  if (minutes >= 12 * 60 && minutes < 18 * 60) return 'AFTERNOON';
  if (minutes >= 18 * 60 && minutes < 23 * 60) return 'EVENING';
  return null;
}

export function timeSegmentSortIndex(segmentId: TimeSegmentId): number {
  const idx = TIME_SEGMENT_ORDER.indexOf(segmentId);
  return idx >= 0 ? idx : TIME_SEGMENT_ORDER.length;
}

export function timeSegmentDisplayTitle(
  segmentId: TimeSegmentId,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  switch (segmentId) {
    case 'MORNING':
      return t('timeline.narrativeTimeline.morning');
    case 'AFTERNOON':
      return t('timeline.narrativeTimeline.afternoon');
    case 'EVENING':
      return t('timeline.narrativeTimeline.evening');
    case 'REMINDER':
    default:
      return t('timeline.narrativeTimeline.reminder');
  }
}

/** Segment courant selon l'heure locale (pour griser les blocs passés). */
export function resolveCurrentTimeSegment(now: Date = new Date()): TimeSegmentId | null {
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return resolveTimeSegmentFromHm(hm);
}

/** Vrai si le segment est antérieur au moment courant (vue du jour uniquement). */
export function isTimeSegmentPast(segmentId: TimeSegmentId, now: Date = new Date()): boolean {
  if (segmentId === 'REMINDER') return false;
  const current = resolveCurrentTimeSegment(now);
  if (!current || current === 'REMINDER') return false;
  return timeSegmentSortIndex(segmentId) < timeSegmentSortIndex(current);
}
