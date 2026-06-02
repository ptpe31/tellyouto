import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { MD3Theme } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import type { TrankilV2TimelineItemRow } from '../api';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { useSentinelFocus } from '../hooks/useSentinelFocus';
import { useProbeScheduleClock } from '../hooks/useProbeScheduleClock';
import { AlarmService } from '../services/alarmService';
import {
  hasTripPromiseValidated,
  readTripPromiseReference,
} from '../services/traffic/sentinelElasticTripMetadata';
import { generateSmartTitle } from '../services/smartTitle';
import {
  resolveElasticDepartureAlarmUnixSec,
  resolveTripAlarmPlaceLabel,
} from '../utils/tripElasticCapsuleModel';
import { ElasticDepartureCapsule } from './ElasticDepartureCapsule';
import {
  isSentinelFocusSlotVisible,
  isSentinelMicroDashboardEphemeral,
  pickSentinelFocus,
  readTripContext,
  resolveSentinelFocusPromptTimeHm,
  resolveSentinelMicroDashboardBundle,
  resolveSentinelTripArrivalDisplayHm,
} from '../utils/sentinelFocusSelection';

export const SENTINEL_FOCUS_BADGE_HEIGHT = 105;
export const SENTINEL_FOCUS_BADGE_MARGIN_BOTTOM = 12;
/** Hauteur slot FlatList : badge + marge inférieure (aucun layout shift). */
export const SENTINEL_FOCUS_SLOT_HEIGHT = SENTINEL_FOCUS_BADGE_HEIGHT + SENTINEL_FOCUS_BADGE_MARGIN_BOTTOM;

/** Bulle Talk — rupture visuelle vs cartes To-Do (hauteur stricte 105dp). */
export const SENTINEL_FOCUS_BADGE_CONTAINER: ViewStyle = {
  width: '100%',
  height: SENTINEL_FOCUS_BADGE_HEIGHT,
  backgroundColor: '#F2F2F7',
  borderRadius: 16,
  paddingHorizontal: 12,
  paddingTop: 6,
  paddingBottom: 8,
  marginBottom: SENTINEL_FOCUS_BADGE_MARGIN_BOTTOM,
  overflow: 'hidden',
};

const CAPSULE_FLAT: ViewStyle = {
  width: '100%',
  backgroundColor: 'transparent',
  borderWidth: 0,
  shadowOpacity: 0,
  shadowRadius: 0,
  elevation: 0,
};

type SentinelFocusBadgeProps = {
  rows: TrankilV2TimelineItemRow[];
  todayYmd: string;
  theme: MD3Theme;
  /** Ouvre la feuille détail (scan actif, même contrat que le hub). */
  onOpenDetail: (row: TrankilV2TimelineItemRow) => void;
  /**
   * Suggestion « Me prévenir quand partir » — même handler que le CTA setup TRIP
   * (`handleTripFooterPress` / `openDetail` sur Timeline).
   */
  onPressSuggestion: (row: TrankilV2TimelineItemRow) => void;
  onOpenProPaywall?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

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

type SentinelFocusBadgeShellProps = {
  children: React.ReactNode;
  accessibilityLabel: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Enveloppe bulle dialogue — en-tête TalkNDone + corps centré. */
function SentinelFocusBadgeShell({
  children,
  accessibilityLabel,
  onPress,
  style,
  testID,
}: SentinelFocusBadgeShellProps) {
  const { t } = useTranslation();
  const brand = t('errorBoundary.brand');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [SENTINEL_FOCUS_BADGE_CONTAINER, style, pressed && styles.pressed]}
      testID={testID}
    >
      <Text style={styles.bubbleBrand} numberOfLines={1}>
        {`💬 ${brand}`}
      </Text>
      <View style={styles.bubbleBody}>{children}</View>
    </Pressable>
  );
}

type ActiveFocusContentProps = {
  row: TrankilV2TimelineItemRow;
  theme: MD3Theme;
  onOpenDetail: (row: TrankilV2TimelineItemRow) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** État A — scan actif (`remind_to_leave === 1`), capsule élastique compacte. */
function ActiveFocusContent({ row, theme, onOpenDetail, style, testID }: ActiveFocusContentProps) {
  const { t, i18n } = useTranslation();
  const { spectrum } = useUserSpectrum();
  const locale = i18n.language;
  const isProUser = spectrum.isProUser;

  const { trip } = useMemo(() => readTripContext(row), [row.metadata_json]);

  const bundle = useMemo(
    () => resolveSentinelMicroDashboardBundle(row, locale, isProUser),
    [isProUser, locale, row],
  );

  const clockActive = Boolean(trip && hasTripPromiseValidated(trip) && bundle);
  const nowMs = useProbeScheduleClock(clockActive, 10_000);

  const titleName = useMemo(
    () => resolveTripTitle(row, t, locale || Intl.DateTimeFormat().resolvedOptions().locale),
    [locale, row, t],
  );

  const arrivalHm = useMemo(() => resolveSentinelTripArrivalDisplayHm(row), [row]);

  const tripPromiseRef = useMemo(() => {
    if (!trip) return null;
    return readTripPromiseReference(trip);
  }, [trip]);

  const tripAlarmPlace = useMemo(
    () => resolveTripAlarmPlaceLabel(trip, row.display_title, titleName),
    [row.display_title, titleName, trip],
  );

  const onPressTripAlarm = useCallback(
    (e?: { stopPropagation?: () => void }) => {
      e?.stopPropagation?.();
      if (!bundle) return;
      const alarmUnix = resolveElasticDepartureAlarmUnixSec(bundle.startMs, bundle.endMs);
      if (alarmUnix == null) return;
      const time = formatHmFromUnix(alarmUnix);
      const label = t('tripAlarm.departureLabel', { place: tripAlarmPlace, time });
      void AlarmService.openAlarmSelection(alarmUnix, label);
    },
    [bundle, t, tripAlarmPlace],
  );

  if (!trip || !hasTripPromiseValidated(trip) || !bundle) return null;
  if (!isSentinelMicroDashboardEphemeral(nowMs, bundle)) return null;

  const departureTitle = t('sentinelFocus.departureTitle', { name: titleName });
  const arrivalSubtitle = arrivalHm ? t('sentinelFocus.arrivalSubtitle', { time: arrivalHm }) : null;

  return (
    <SentinelFocusBadgeShell
      accessibilityLabel={departureTitle}
      onPress={() => onOpenDetail(row)}
      style={style}
      testID={testID ?? 'sentinel-focus-active'}
    >
      <Text style={styles.activeTitle} numberOfLines={1} ellipsizeMode="tail">
        {departureTitle}
      </Text>
      {arrivalSubtitle ? (
        <Text style={styles.activeSubtitle} numberOfLines={1} ellipsizeMode="tail">
          {arrivalSubtitle}
        </Text>
      ) : null}
      <View style={styles.capsuleWrap}>
        <ElasticDepartureCapsule
          startMs={bundle.startMs}
          endMs={bundle.endMs}
          nowMs={nowMs}
          ratioD={bundle.ratioD}
          onNavigationPress={() => onOpenDetail(row)}
          onAlarmPress={tripPromiseRef ? onPressTripAlarm : undefined}
          showAlarmIcon={Boolean(tripPromiseRef)}
          alarmA11yLabel={t('tripAlarm.a11yOpenAlarm')}
          variant="compact"
          lateVariant="graphite"
          theme={theme}
          style={CAPSULE_FLAT}
        />
      </View>
    </SentinelFocusBadgeShell>
  );
}

type SuggestionFocusContentProps = {
  row: TrankilV2TimelineItemRow;
  isProUser: boolean;
  onPressSuggestion: (row: TrankilV2TimelineItemRow) => void;
  onOpenProPaywall?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** État B — suggestion (`remind_to_leave === 0`), texte purifié deux lignes. */
function SuggestionFocusContent({
  row,
  isProUser,
  onPressSuggestion,
  onOpenProPaywall,
  style,
  testID,
}: SuggestionFocusContentProps) {
  const { t, i18n } = useTranslation();
  const tripName = useMemo(
    () => resolveTripTitle(row, t, i18n.language || Intl.DateTimeFormat().resolvedOptions().locale),
    [i18n.language, row, t],
  );
  const dueTimeHm = resolveSentinelFocusPromptTimeHm(row) ?? '--:--';

  const line1 = isProUser
    ? t('sentinelFocus.promptLine1', { tripName })
    : t('intentionDetail.actionSetupAlertLocked');
  const line2 = isProUser ? t('sentinelFocus.promptLine2', { dueTimeHm }) : null;

  const onPress = useCallback(() => {
    if (!isProUser) {
      onOpenProPaywall?.();
      return;
    }
    onPressSuggestion(row);
  }, [isProUser, onPressSuggestion, onOpenProPaywall, row]);

  const a11yLabel = line2 ? `${line1}. ${line2}` : line1;

  return (
    <SentinelFocusBadgeShell
      accessibilityLabel={a11yLabel}
      onPress={onPress}
      style={style}
      testID={testID ?? 'sentinel-focus-suggestion'}
    >
      <Text style={styles.suggestionLine1} numberOfLines={2} ellipsizeMode="tail">
        {line1}
      </Text>
      {line2 ? (
        <Text style={styles.suggestionLine2} numberOfLines={2} ellipsizeMode="tail">
          {line2}
        </Text>
      ) : null}
    </SentinelFocusBadgeShell>
  );
}

/**
 * Badge Sentinel sous « Aujourd'hui » — séquenceur glissant, bulle 105dp fixe.
 */
export function SentinelFocusBadge({
  rows,
  todayYmd,
  theme,
  onOpenDetail,
  onPressSuggestion,
  onOpenProPaywall,
  style,
  testID,
}: SentinelFocusBadgeProps) {
  const { spectrum } = useUserSpectrum();
  const { microDashboardTrip, unconfiguredTrip, visible } = useSentinelFocus({ rows, todayYmd });

  if (!visible) return null;

  if (microDashboardTrip) {
    return (
      <ActiveFocusContent
        row={microDashboardTrip}
        theme={theme}
        onOpenDetail={onOpenDetail}
        style={style}
        testID={testID}
      />
    );
  }

  if (unconfiguredTrip) {
    return (
      <SuggestionFocusContent
        row={unconfiguredTrip}
        isProUser={spectrum.isProUser}
        onPressSuggestion={onPressSuggestion}
        onOpenProPaywall={onOpenProPaywall}
        style={style}
        testID={testID}
      />
    );
  }

  return null;
}

/** Hauteur slot pour `getItemLayout` (Timeline) — constante stricte si visible. */
export function estimateSentinelFocusBadgeHeight(
  rows: TrankilV2TimelineItemRow[],
  options: { todayYmd: string; isProUser: boolean; locale: string; nowMs?: number },
): number {
  const nowMs = options.nowMs ?? Date.now();
  const pick = pickSentinelFocus(rows, { ...options, nowMs });
  if (
    !isSentinelFocusSlotVisible(pick, {
      locale: options.locale,
      isProUser: options.isProUser,
      nowMs,
      todayYmd: options.todayYmd,
    })
  ) {
    return 0;
  }
  return SENTINEL_FOCUS_SLOT_HEIGHT;
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.92 },
  bubbleBrand: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
    color: 'rgba(60, 60, 67, 0.55)',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  bubbleBody: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
    minHeight: 0,
  },
  activeTitle: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 15,
    color: '#1C1C1E',
  },
  activeSubtitle: {
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 13,
    color: 'rgba(60, 60, 67, 0.72)',
    marginTop: 1,
  },
  capsuleWrap: {
    width: '100%',
    marginTop: 3,
  },
  suggestionLine1: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 18,
    color: '#1C1C1E',
  },
  suggestionLine2: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    color: 'rgba(60, 60, 67, 0.72)',
  },
});
