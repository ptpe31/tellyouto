import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MD3Theme } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Navigation2 } from 'lucide-react-native';

import type { TrankilV2TimelineItemRow } from '../api';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { useDesignTokens } from '../hooks/useDesignTokens';
import { useProbeScheduleClock } from '../hooks/useProbeScheduleClock';
import { generateSmartTitle } from '../services/smartTitle';
import { AlarmService } from '../services/alarmService';
import { readTripPromiseReference } from '../services/traffic/sentinelElasticTripMetadata';
import { addDaysYmd, formatYmdLocal } from '../services/TimeSorter';
import { isHiddenTechnicalNoteFallbackRow } from '../services/timelineIntentionVisibility';
import { formatCreationSubtitle } from '../utils/timeFormat';
import {
  ElasticDepartureCapsule,
  ELASTIC_CAPSULE_COLORS,
  getElasticTrafficColor,
} from './ElasticDepartureCapsule';
import { TripNeumorphicOrb, TRIP_ORB_SIZE } from './TripNeumorphicOrb';
import { hasTripStandardDurationMin, isTripAllDay } from '../utils/tripElasticDisplay';
import {
  resolveTripNavigationDestination,
  resolveTripTimelineCapsuleBundle,
} from '../utils/tripElasticCapsuleModel';
import {
  getTripMetaFromRoot,
  resolveTripTimelineFooter,
  type TripTimelineFooter,
} from '../utils/tripTimelineCard';
import { launchNavigation } from '../utils/tripNavigation';
import { isTripMissionActive } from '../utils/tripTripReadiness';
import { normalizeTripTransportMode } from '../utils/tripTransportMode';

type Props = {
  row: TrankilV2TimelineItemRow;
  theme: MD3Theme;
  pendingLocalDone: boolean;
  enabled: boolean;
  onToggleComplete: () => void;
  onPress?: () => void;
  /** TRIP footer CTA : setup PRO ou lockedSetup FREE (paywall). */
  onPressTripFooter?: (footer: TripTimelineFooter) => void;
};

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

function capitalizeFirst(raw: string): string {
  if (!raw) return raw;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
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

function getCategoryIcon(categoryId: string | null | undefined, type: TrankilV2TimelineItemRow['type']): string {
  const up = String(categoryId ?? '').trim().toUpperCase();
  if (up === 'SHOP') return 'cart-outline';
  if (up === 'HEALTH') return 'heart-pulse';
  if (up === 'WORK' || up === 'PRO') return 'briefcase-outline';
  if (up === 'TRAVEL') return 'airplane';
  if (up === 'SOCIAL') return 'account-group-outline';
  if (up === 'FINANCE') return 'cash-multiple';
  if (up === 'LEARN') return 'book-open-variant';
  if (up === 'HOME' || up === 'PERSO' || up === 'FAMILLE') return 'home-outline';
  if (up === 'OTHER') return 'dots-horizontal-circle-outline';
  if (type === 'LIST') return 'format-list-bulleted';
  if (type === 'HABIT') return 'repeat';
  if (type === 'NOTE') return 'note-text-outline';
  if (type === 'AUDIO') return 'microphone-outline';
  if (type === 'PROJECT') return 'rocket-launch-outline';
  return 'check-circle-outline';
}

function getTripTransportIcon(raw: string | null | undefined): string | null {
  const mode = normalizeTripTransportMode(raw);
  if (mode === 'walking') return 'walk';
  if (mode === 'bike') return 'bike';
  return 'car';
}

function formatHmFromUnix(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function tripFooterLabel(footer: TripTimelineFooter, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!footer || typeof footer.kind !== 'string') return '';
  switch (footer.kind) {
    case 'setup':
      return t('intentionDetail.actionSetupAlert');
    case 'lockedSetup':
      return t('intentionDetail.actionSetupAlertLocked');
    case 'scanScheduled':
    case 'elasticDeparture':
      return footer.label;
    default:
      return '';
  }
}

export function IntentionCard({
  row,
  theme,
  pendingLocalDone,
  enabled,
  onToggleComplete,
  onPress,
  onPressTripFooter,
}: Props) {
  const { t, i18n } = useTranslation();
  const { spectrum } = useUserSpectrum();
  const designTokens = useDesignTokens();
  const isProUser = spectrum.isProUser;
  const meta = useMemo(() => safeParseJsonObject(row.metadata_json), [row.metadata_json]);
  const trip = useMemo(() => getTripMetaFromRoot(meta), [meta]);
  const isTripCard = Boolean(trip);

  const probeClockActive = useMemo(() => {
    if (!isTripCard || !trip) return false;
    if (isTripAllDay(meta, trip, row.due_date)) return false;
    if (!isProUser) return false;
    if (hasTripStandardDurationMin(trip)) return false;
    return isTripMissionActive({
      remindToLeave: Boolean(row.remind_to_leave),
      meta,
      trip,
      dueDate: row.due_date,
    });
  }, [isProUser, isTripCard, meta, row.due_date, row.remind_to_leave, trip]);

  const probeClockTick = useProbeScheduleClock(probeClockActive);

  const tripFooter = useMemo(() => {
    if (!isTripCard) return null;
    return resolveTripTimelineFooter({
      meta,
      trip,
      dueDate: row.due_date,
      locale: i18n.language,
      isProUser,
      remindToLeave: Boolean(row.remind_to_leave),
      t,
      nowMs: probeClockTick,
    });
  }, [i18n.language, isProUser, isTripCard, meta, probeClockTick, row.due_date, row.remind_to_leave, t, trip]);

  const tripCapsuleModel = useMemo(() => {
    if (!isTripCard || !trip) return null;
    return resolveTripTimelineCapsuleBundle({
      meta,
      trip,
      dueDate: row.due_date,
      locale: i18n.language,
      remindToLeave: Boolean(row.remind_to_leave),
      isProUser,
    });
  }, [i18n.language, isProUser, isTripCard, meta, row.due_date, row.remind_to_leave, trip]);

  const tripCapsuleClockActive = Boolean(tripCapsuleModel);
  const tripCapsuleNowMs = useProbeScheduleClock(tripCapsuleClockActive);

  const tripPromiseRef = useMemo(() => readTripPromiseReference(trip), [trip]);

  const tripNavOrbColor = useMemo(() => {
    if (!tripCapsuleModel) return ELASTIC_CAPSULE_COLORS.green;
    if (tripCapsuleNowMs > tripCapsuleModel.endMs) return ELASTIC_CAPSULE_COLORS.graphite;
    return getElasticTrafficColor(tripCapsuleModel.ratioD);
  }, [tripCapsuleModel, tripCapsuleNowMs]);

  const titleText = useMemo(() => {
    const loc = i18n.language || Intl.DateTimeFormat().resolvedOptions().locale;
    const direct = String(row.display_title || '').trim();
    if (direct && !hasTemporalResidue(direct)) return direct;
    const smart = generateSmartTitle(row.content_raw || '', loc);
    if (smart) return smart;
    if (direct) return direct;
    if (row.type === 'AUDIO') return t('timeline.memoAudio');
    if (row.type === 'NOTE') return t('timeline.note');
    return t('timeline.untitled');
  }, [i18n.language, row.content_raw, row.display_title, row.type, t]);

  const onPressTripNavigation = useCallback(
    (e?: { stopPropagation?: () => void }) => {
      e?.stopPropagation?.();
      if (!trip) return;
      const destination = resolveTripNavigationDestination(trip, meta, row.display_title);
      void launchNavigation({
        trip,
        destination,
        transportMode: row.transport_mode,
        intentionId: row.id,
      });
    },
    [meta, row.display_title, row.id, row.transport_mode, trip],
  );

  const onPressTripAlarm = useCallback(
    (e?: { stopPropagation?: () => void }) => {
      e?.stopPropagation?.();
      const endMs = tripCapsuleModel?.endMs;
      if (!Number.isFinite(endMs) || endMs <= 0) return;
      const alarmUnix = Math.floor(endMs / 1000);
      const time = formatHmFromUnix(alarmUnix);
      const label = t('tripAlarm.departureLabel', { place: titleText, time });
      void AlarmService.openAlarmSelection(alarmUnix, label);
    },
    [tripCapsuleModel?.endMs, t, titleText],
  );

  const subtitle = useMemo(() => {
    const loc = i18n.language || Intl.DateTimeFormat().resolvedOptions().locale;
    const now = new Date();
    const todayKey = formatYmdLocal(now);
    const tomorrowKey = addDaysYmd(now, 1);

    const rootDueIso = str(meta, 'dueDateTime');
    const rootYmd = str(meta, 'dueDateYmd');
    const rootHm = parseHm(str(meta, 'dueTimeHm'));
    const recRule =
      meta?.recurrence_rule &&
      typeof meta.recurrence_rule === 'object' &&
      !Array.isArray(meta.recurrence_rule)
        ? (meta.recurrence_rule as Record<string, unknown>)
        : null;
    const habitHm =
      parseHm(str(recRule ?? {}, 'time_target')) ?? (meta ? parseHm(str(meta, 'preferredTimeHm')) : null);

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
      if (row.type === 'HABIT' && habitHm) {
        return `${t('horizons.today')} • ${habitHm}`;
      }
      return formatCreationSubtitle(Number(row.created_at), t, loc, now);
    }
    const dueKey = formatYmdLocal(dueRef);
    const dayLabel =
      dueKey === todayKey
        ? t('horizons.today')
        : dueKey === tomorrowKey
          ? t('horizons.tomorrow')
          : capitalizeFirst(new Intl.DateTimeFormat(loc, { weekday: 'long' }).format(dueRef));
    const isoTimeLabel =
      parsedIso?.hasTime && parsedIso.date
        ? new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', hour12: false }).format(parsedIso.date)
        : null;
    const baseTimeLabel =
      baseParsed?.hasTime && baseParsed.date
        ? new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', hour12: false }).format(baseParsed.date)
        : null;
    const timeLabel =
      tripHm || isoTimeLabel || rootHm || habitHm || baseTimeLabel;
    if (timeLabel) return `${dayLabel} • ${timeLabel}`;
    return `${dayLabel} • ${t('timeline.allDuration')}`;
  }, [i18n.language, meta, row.created_at, row.due_date, t, trip]);

  const tripIcon = useMemo(() => {
    if (!trip) return null;
    return getTripTransportIcon(row.transport_mode) ?? 'airplane';
  }, [row.transport_mode, trip]);

  const categoryIcon = useMemo(() => getCategoryIcon(row.category_id, row.type), [row.category_id, row.type]);
  const showTripGpsOrb = isTripCard && !pendingLocalDone;
  const circleIcon = pendingLocalDone ? 'check' : showTripGpsOrb ? null : tripIcon ?? categoryIcon;
  const iconColor = pendingLocalDone ? '#065f46' : designTokens.accentColor;

  const titleOpacity = pendingLocalDone ? 0.5 : 1;
  const pendingAiLabel =
    (row.type === 'NOTE' || row.type === 'AUDIO') && row.is_pending_ai === 1 ? t('timeline.aiPendingChip') : null;

  if (isHiddenTechnicalNoteFallbackRow(row)) {
    return null;
  }

  const showTripCapsule = Boolean(tripCapsuleModel);
  const showTripFooter = Boolean(tripFooter?.kind) && !showTripCapsule;
  const footerIsCta = tripFooter?.kind === 'setup' || tripFooter?.kind === 'lockedSetup';
  const footerLabel = tripFooter ? tripFooterLabel(tripFooter, t) : '';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={titleText}
      style={({ pressed }) => [
        designTokens.cardShadowStyle,
        styles.card,
        { borderRadius: designTokens.borderRadius },
        showTripFooter || showTripCapsule ? styles.cardTrip : null,
        pressed && {
          opacity: designTokens.pressedOpacity,
          transform: [{ scale: designTokens.pressedScale }],
        },
      ]}
    >
      <View style={styles.row}>
        {showTripGpsOrb ? (
          <TripNeumorphicOrb
            theme={theme}
            size="card"
            backgroundColor={tripNavOrbColor}
            onPress={onPressTripNavigation}
            accessibilityLabel={t('intentionDetail.launchRoute')}
          >
            <Navigation2 size={22} color="#FFFFFF" strokeWidth={2.5} />
          </TripNeumorphicOrb>
        ) : (
          <TripNeumorphicOrb
            theme={theme}
            size="card"
            icon={circleIcon ?? categoryIcon}
            iconColor={iconColor}
            onPress={enabled ? onToggleComplete : undefined}
            disabled={!enabled}
            accessibilityLabel={t('timeline.a11yTaskComplete')}
          />
        )}

        <View style={styles.textCol}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: designTokens.textPrimary, opacity: titleOpacity }]} numberOfLines={2}>
              {titleText}
            </Text>
          </View>
          {pendingAiLabel || subtitle ? (
            <View style={styles.subtitleRow}>
              {pendingAiLabel ? (
                <Text style={[styles.pendingChip, { color: designTokens.accentColor }]} numberOfLines={1}>
                  {pendingAiLabel}
                </Text>
              ) : (
                <Text style={[styles.subtitle, { color: designTokens.textSecondary }]} numberOfLines={1}>
                  {subtitle}
                </Text>
              )}
            </View>
          ) : null}
        </View>
      </View>

      {showTripCapsule && tripCapsuleModel ? (
        <View style={styles.tripCapsuleWrap}>
          <ElasticDepartureCapsule
            startMs={tripCapsuleModel.startMs}
            endMs={tripCapsuleModel.endMs}
            nowMs={tripCapsuleNowMs}
            ratioD={tripCapsuleModel.ratioD}
            onNavigationPress={() => onPressTripNavigation()}
            onAlarmPress={tripPromiseRef ? () => onPressTripAlarm() : undefined}
            showAlarmIcon={Boolean(tripPromiseRef)}
            navigationLabel={t('intentionDetail.launchRoute')}
            alarmA11yLabel={t('tripAlarm.a11yOpenAlarm')}
            variant="compact"
            lateVariant="graphite"
            theme={theme}
            style={styles.tripCapsule}
          />
        </View>
      ) : null}

      {showTripFooter && tripFooter && footerLabel ? (
        <View style={styles.tripFooterWrap}>
          {footerIsCta && onPressTripFooter ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                tripFooter.kind === 'lockedSetup'
                  ? t('intentionDetail.actionSetupAlertLocked')
                  : t('intentionDetail.actionSetupAlert')
              }
              onPress={(e) => {
                e?.stopPropagation?.();
                onPressTripFooter(tripFooter);
              }}
              style={({ pressed }) => [
                styles.tripSetupBtn,
                {
                  borderColor: theme.colors.outlineVariant,
                  backgroundColor: theme.colors.surfaceVariant,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}
            >
              <Text style={[styles.tripSetupBtnText, { color: designTokens.accentColor }]} numberOfLines={2}>
                {footerLabel}
              </Text>
            </Pressable>
          ) : (
            <View
              style={[
                styles.tripBadge,
                {
                  backgroundColor: theme.colors.primaryContainer,
                  borderColor: theme.colors.outlineVariant,
                  opacity:
                    tripFooter.kind === 'elasticDeparture' && tripFooter.approximate
                      ? 0.78
                      : tripFooter.kind === 'scanScheduled'
                        ? 0.95
                        : 1,
                },
              ]}
            >
              <Text style={[styles.tripBadgeText, { color: theme.colors.onPrimaryContainer }]} numberOfLines={2}>
                {footerLabel}
              </Text>
            </View>
          )}
        </View>
      ) : null}
    </Pressable>
  );
}

function hasTemporalResidue(raw: string): boolean {
  const s = String(raw || '').toLowerCase();
  if (!s.trim()) return false;
  if (/\b(\d{1,2}[:h]\d{0,2}|am|pm)\b/.test(s)) return true;
  if (/\b(today|tomorrow|tonight|yesterday)\b/.test(s)) return true;
  if (/\b(aujourd'hui|demain|ce soir|hier|après-demain)\b/.test(s)) return true;
  if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(s)) return true;
  if (/\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/.test(s)) return true;
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(s)) return true;
  return false;
}

const CIRCLE_SIZE = TRIP_ORB_SIZE.card;

const styles = StyleSheet.create({
  card: {
    height: 105,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginHorizontal: 0,
    marginBottom: 12,
  },
  cardTrip: {
    height: undefined,
    minHeight: 105,
    paddingBottom: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: CIRCLE_SIZE },
  textCol: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 16, fontWeight: '800', lineHeight: 20 },
  subtitle: { marginTop: 4, fontSize: 13, fontWeight: '700', opacity: 0.88 },
  pendingChip: { marginTop: 4, fontSize: 12, fontWeight: '800' },
  subtitleRow: { marginTop: 4, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  tripCapsuleWrap: {
    marginTop: 8,
    width: '100%',
    alignSelf: 'stretch',
  },
  tripCapsule: {
    width: '100%',
  },
  tripFooterWrap: {
    marginTop: 8,
    paddingTop: 2,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  tripSetupBtn: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    maxWidth: '100%',
    flexShrink: 1,
  },
  tripSetupBtnText: { fontSize: 13, fontWeight: '800', textAlign: 'right' },
  tripBadge: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 10,
    maxWidth: '100%',
    flexShrink: 1,
  },
  tripBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2, textAlign: 'right' },
});
