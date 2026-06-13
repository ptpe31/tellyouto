import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { TrankilV2TimelineItemRow } from '../api/trankilV2Db';
import { addDaysYmd, formatYmdLocal } from '../services/TimeSorter';
import { categoryPastelTabBackground } from '../utils/categoryPastel';
import { formatCreationSubtitle } from '../utils/timeFormat';

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

function buildMomentLabel(
  row: TrankilV2TimelineItemRow,
  t: (key: string, options?: Record<string, unknown>) => string,
  locale: string,
): string {
  const meta = safeParseJsonObject(row.metadata_json);
  const trip =
    meta?.trip && typeof meta.trip === 'object' && !Array.isArray(meta.trip)
      ? (meta.trip as Record<string, unknown>)
      : null;
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
    if (isCreatedToday(Number(row.created_at), now)) {
      return t('timeline.newBadge', { defaultValue: 'NEW' });
    }
    return '';
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
  if (timeLabel) return `${dayLabel} • ${timeLabel}`;
  return `${dayLabel} • ${t('timeline.allDuration')}`;
}

function buildSeriesLabel(
  row: TrankilV2TimelineItemRow,
  slotCount: number,
): string | null {
  if (slotCount < 2) return null;
  return `${slotCount} créneaux`;
}

type Props = {
  row: TrankilV2TimelineItemRow;
  textPrimary: string;
  textSecondary: string;
  locale?: string;
};

export function InboxLineTitle({ row, textPrimary, textSecondary, locale }: Props) {
  const { t, i18n } = useTranslation();
  const loc = locale || i18n.language || Intl.DateTimeFormat().resolvedOptions().locale;
  const line1 = String(row.display_title || '').trim() || t('timeline.untitled');

  const line2 = useMemo(() => {
    const hint = String(row.sourcing_v1?.source_hint ?? '').trim();
    const seriesLen = row.sourcing_v1?.event_series_v1?.slots?.length ?? 0;
    const seriesPart = buildSeriesLabel(row, seriesLen);
    const momentPart = seriesPart || buildMomentLabel(row, t, loc);
    if (hint && momentPart) return `${hint} • ${momentPart}`;
    if (hint) return hint;
    return momentPart || formatCreationSubtitle(Number(row.created_at), t, loc);
  }, [loc, row, t]);

  const pastel = categoryPastelTabBackground(row.category_id);

  return (
    <View style={styles.root}>
      <View style={[styles.pastille, { backgroundColor: pastel }]} />
      <View style={styles.textCol}>
        <Text style={[styles.line1, { color: textPrimary }]} numberOfLines={1} ellipsizeMode="tail">
          {line1}
        </Text>
        <Text style={[styles.line2, { color: textSecondary }]} numberOfLines={1} ellipsizeMode="tail">
          {line2}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    maxHeight: 36,
    gap: 8,
  },
  pastille: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  textCol: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  line1: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 18,
  },
  line2: {
    fontSize: 12,
    lineHeight: 16,
  },
});
