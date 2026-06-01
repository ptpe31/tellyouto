import { Navigation2 } from 'lucide-react-native';
import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { MD3Theme } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import type { TrankilV2TimelineItemRow } from '../api';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { useProbeScheduleClock } from '../hooks/useProbeScheduleClock';
import { useSentinelFocus } from '../hooks/useSentinelFocus';
import { AlarmService } from '../services/alarmService';
import { readTripPromiseReference } from '../services/traffic/sentinelElasticTripMetadata';
import { generateSmartTitle } from '../services/smartTitle';
import { addDaysYmd, formatYmdLocal } from '../services/TimeSorter';
import {
  ElasticDepartureCapsule,
  ELASTIC_CAPSULE_COLORS,
  getElasticTrafficColor,
} from './ElasticDepartureCapsule';
import { TripNeumorphicOrb } from './TripNeumorphicOrb';
import {
  resolveTripAlarmPlaceLabel,
  resolveTripNavigationDestination,
  resolveTripTimelineCapsuleBundle,
} from '../utils/tripElasticCapsuleModel';
import { getTripMetaFromRoot } from '../utils/tripTimelineCard';
import { launchNavigation } from '../utils/tripNavigation';
import {
  pickSentinelFocus,
  resolveSentinelFocusPromptTimeHm,
} from '../utils/sentinelFocusSelection';

export const SENTINEL_FOCUS_SHADOW_3D: ViewStyle = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.15,
  shadowRadius: 10,
  elevation: 6,
  backgroundColor: '#FFFFFF',
  borderRadius: 16,
  marginBottom: 16,
};

type SentinelFocusBadgeProps = {
  rows: TrankilV2TimelineItemRow[];
  todayYmd: string;
  theme: MD3Theme;
  onOpenDetail: (row: TrankilV2TimelineItemRow) => void;
  onOpenProPaywall?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

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

function capitalizeFirst(raw: string): string {
  if (!raw) return raw;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatHmFromUnix(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function resolveTripTitle(row: TrankilV2TimelineItemRow, t: (key: string) => string, locale: string): string {
  const direct = String(row.display_title || '').trim();
  if (direct) return direct;
  const smart = generateSmartTitle(row.content_raw || '', locale);
  if (smart) return smart;
  return t('timeline.untitled');
}

type ActiveTripFocusProps = {
  row: TrankilV2TimelineItemRow;
  theme: MD3Theme;
  onOpenDetail: (row: TrankilV2TimelineItemRow) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

function ActiveTripFocusCard({ row, theme, onOpenDetail, style, testID }: ActiveTripFocusProps) {
  const { t, i18n } = useTranslation();
  const { spectrum } = useUserSpectrum();
  const isProUser = spectrum.isProUser;
  const meta = useMemo(() => safeParseJsonObject(row.metadata_json), [row.metadata_json]);
  const trip = useMemo(() => getTripMetaFromRoot(meta), [meta]);

  const tripCapsuleModel = useMemo(() => {
    if (!trip) return null;
    return resolveTripTimelineCapsuleBundle({
      meta,
      trip,
      dueDate: row.due_date,
      locale: i18n.language,
      remindToLeave: Boolean(row.remind_to_leave),
      isProUser,
    });
  }, [i18n.language, isProUser, meta, row.due_date, row.remind_to_leave, trip]);

  const tripCapsuleNowMs = useProbeScheduleClock(Boolean(tripCapsuleModel));

  const tripPromiseRef = useMemo(() => {
    if (!trip) return null;
    return readTripPromiseReference(trip);
  }, [trip]);

  const titleText = useMemo(
    () => resolveTripTitle(row, t, i18n.language || Intl.DateTimeFormat().resolvedOptions().locale),
    [i18n.language, row, t],
  );

  const subtitle = useMemo(() => {
    const loc = i18n.language || Intl.DateTimeFormat().resolvedOptions().locale;
    const now = new Date();
    const todayKey = formatYmdLocal(now);
    const tomorrowKey = addDaysYmd(now, 1);
    const tripArrivalIso = str(trip, 'arrivalDue');
    const tripDueIso = str(trip, 'dueDateTime');
    const tripYmd = str(trip, 'dueDateYmd');
    const tripHm = parseHm(str(trip, 'dueTimeHm'));
    const baseParsed = parseDueDate(row.due_date);
    const isoSource = tripArrivalIso || tripDueIso;
    const parsedIso = isoSource ? parseDueDate(isoSource) : null;
    const dueRef =
      parsedIso?.date ??
      (tripYmd ? parseDueDate(tripYmd)?.date : null) ??
      baseParsed?.date ??
      null;
    if (!dueRef) return null;
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
    const timeLabel = tripHm || isoTimeLabel;
    if (timeLabel) return `${dayLabel} • ${timeLabel}`;
    return dayLabel;
  }, [i18n.language, row.due_date, t, trip]);

  const tripNavOrbColor = useMemo(() => {
    if (!tripCapsuleModel) return ELASTIC_CAPSULE_COLORS.green;
    if (tripCapsuleNowMs > tripCapsuleModel.endMs) return ELASTIC_CAPSULE_COLORS.graphite;
    return getElasticTrafficColor(tripCapsuleModel.ratioD);
  }, [tripCapsuleModel, tripCapsuleNowMs]);

  const tripAlarmPlace = useMemo(
    () => resolveTripAlarmPlaceLabel(trip, row.display_title, titleText),
    [row.display_title, titleText, trip],
  );

  const onPressTripNavigation = useCallback(() => {
    if (!trip) return;
    const destination = resolveTripNavigationDestination(trip, meta, row.display_title);
    void launchNavigation({
      trip,
      destination,
      transportMode: row.transport_mode,
      intentionId: row.id,
    });
  }, [meta, row.display_title, row.id, row.transport_mode, trip]);

  const onPressTripAlarm = useCallback(() => {
    const endMs = tripCapsuleModel?.endMs;
    if (endMs == null || !Number.isFinite(endMs) || endMs <= 0) return;
    const alarmUnix = Math.floor(endMs / 1000);
    const time = formatHmFromUnix(alarmUnix);
    const label = t('tripAlarm.departureLabel', { place: tripAlarmPlace, time });
    void AlarmService.openAlarmSelection(alarmUnix, label);
  }, [tripAlarmPlace, tripCapsuleModel?.endMs, t]);

  if (!trip) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={titleText}
      onPress={() => onOpenDetail(row)}
      style={({ pressed }) => [SENTINEL_FOCUS_SHADOW_3D, styles.activeCard, style, pressed && styles.pressed]}
      testID={testID}
    >
      <View style={styles.activeRow}>
        <TripNeumorphicOrb
          theme={theme}
          size="card"
          backgroundColor={tripNavOrbColor}
          onPress={onPressTripNavigation}
          accessibilityLabel={t('intentionDetail.launchRoute')}
        >
          <Navigation2 size={22} color="#FFFFFF" strokeWidth={2.5} />
        </TripNeumorphicOrb>
        <View style={styles.textCol}>
          <Text style={styles.activeTitle} numberOfLines={2}>
            {titleText}
          </Text>
          {subtitle ? (
            <Text style={styles.activeSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {tripCapsuleModel ? (
        <View style={styles.capsuleWrap}>
          <ElasticDepartureCapsule
            startMs={tripCapsuleModel.startMs}
            endMs={tripCapsuleModel.endMs}
            nowMs={tripCapsuleNowMs}
            ratioD={tripCapsuleModel.ratioD}
            onNavigationPress={onPressTripNavigation}
            onAlarmPress={tripPromiseRef ? onPressTripAlarm : undefined}
            showAlarmIcon={Boolean(tripPromiseRef)}
            navigationLabel={t('intentionDetail.launchRoute')}
            alarmA11yLabel={t('tripAlarm.a11yOpenAlarm')}
            variant="default"
            lateVariant="graphite"
            theme={theme}
            style={styles.capsule}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

type SuggestionFocusProps = {
  row: TrankilV2TimelineItemRow;
  isProUser: boolean;
  onConfigure: (row: TrankilV2TimelineItemRow) => void;
  onOpenProPaywall?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

function SuggestionFocusCard({ row, isProUser, onConfigure, onOpenProPaywall, style, testID }: SuggestionFocusProps) {
  const { t, i18n } = useTranslation();
  const title = useMemo(
    () => resolveTripTitle(row, t, i18n.language || Intl.DateTimeFormat().resolvedOptions().locale),
    [i18n.language, row, t],
  );
  const timeHm = resolveSentinelFocusPromptTimeHm(row);
  const promptText = isProUser
    ? t('sentinelFocus.prompt', { title, time: timeHm ?? '--:--' })
    : t('intentionDetail.actionSetupAlertLocked');

  const onPress = useCallback(() => {
    if (!isProUser) {
      onOpenProPaywall?.();
      return;
    }
    onConfigure(row);
  }, [isProUser, onConfigure, onOpenProPaywall, row]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={promptText}
      onPress={onPress}
      style={({ pressed }) => [SENTINEL_FOCUS_SHADOW_3D, styles.promptCard, style, pressed && styles.pressed]}
      testID={testID}
    >
      <Text style={styles.promptText}>{promptText}</Text>
    </Pressable>
  );
}

/**
 * Badge unique « trajet actif » ou suggestion Sentinel — Hub Email & écran Talk.
 */
export function SentinelFocusBadge({
  rows,
  todayYmd,
  theme,
  onOpenDetail,
  onOpenProPaywall,
  style,
  testID,
}: SentinelFocusBadgeProps) {
  const { spectrum } = useUserSpectrum();
  const { activeTrip, unconfiguredTrip, visible } = useSentinelFocus({ rows, todayYmd });

  if (!visible) return null;

  if (activeTrip) {
    return (
      <ActiveTripFocusCard
        row={activeTrip}
        theme={theme}
        onOpenDetail={onOpenDetail}
        style={style}
        testID={testID ?? 'sentinel-focus-active'}
      />
    );
  }

  if (unconfiguredTrip) {
    return (
      <SuggestionFocusCard
        row={unconfiguredTrip}
        isProUser={spectrum.isProUser}
        onConfigure={onOpenDetail}
        onOpenProPaywall={onOpenProPaywall}
        style={style}
        testID={testID ?? 'sentinel-focus-suggestion'}
      />
    );
  }

  return null;
}

/** Hauteur estimée pour `getItemLayout` (Timeline). */
export function estimateSentinelFocusBadgeHeight(
  rows: TrankilV2TimelineItemRow[],
  options: { todayYmd: string; isProUser: boolean; locale: string },
): number {
  const pick = pickSentinelFocus(rows, options);
  if (pick.activeTrip) return 168;
  if (pick.unconfiguredTrip) return 88;
  return 0;
}

const styles = StyleSheet.create({
  activeCard: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  textCol: { flex: 1, minWidth: 0 },
  activeTitle: { fontSize: 16, fontWeight: '800', lineHeight: 20, color: '#1C1C1E' },
  activeSubtitle: { marginTop: 4, fontSize: 13, fontWeight: '700', color: 'rgba(60, 60, 67, 0.72)' },
  capsuleWrap: { marginTop: 10, width: '100%' },
  capsule: { width: '100%' },
  promptCard: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    justifyContent: 'center',
  },
  promptText: {
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 21,
    color: '#1C1C1E',
  },
  pressed: { opacity: 0.92 },
});
