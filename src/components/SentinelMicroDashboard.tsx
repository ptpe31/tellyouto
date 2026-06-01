import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { MD3Theme } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import type { TrankilV2TimelineItemRow } from '../api';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { useProbeScheduleClock } from '../hooks/useProbeScheduleClock';
import { hasTripPromiseValidated } from '../services/traffic/sentinelElasticTripMetadata';
import { generateSmartTitle } from '../services/smartTitle';
import { ElasticDepartureCapsule } from './ElasticDepartureCapsule';
import {
  isSentinelMicroDashboardEphemeral,
  readTripContext,
  resolveSentinelMicroDashboardBundle,
  resolveSentinelTripArrivalDisplayHm,
} from '../utils/sentinelFocusSelection';

/** Carte hub email — pleine largeur conteneur, bordure fine (sans ombre 3D). */
export const SENTINEL_HUB_PILL_STYLE: ViewStyle = {
  width: '100%',
  backgroundColor: '#FFFFFF',
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: 'rgba(60, 60, 67, 0.12)',
  borderRadius: 14,
  paddingVertical: 10,
  paddingHorizontal: 14,
  marginBottom: 12,
};

const CAPSULE_FLAT: ViewStyle = {
  width: '100%',
  backgroundColor: 'transparent',
  borderWidth: 0,
  shadowOpacity: 0,
  shadowRadius: 0,
  elevation: 0,
};

type Props = {
  row: TrankilV2TimelineItemRow;
  theme: MD3Theme;
  onOpenDetail: (row: TrankilV2TimelineItemRow) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

function resolveTripTitle(row: TrankilV2TimelineItemRow, t: (key: string) => string, locale: string): string {
  const direct = String(row.display_title || '').trim();
  if (direct) return direct;
  const smart = generateSmartTitle(row.content_raw || '', locale);
  if (smart) return smart;
  return t('timeline.untitled');
}

/**
 * Micro-dashboard Sentinel éphémère — pleine largeur, compacité verticale, barre compacte.
 * Disparaît dès que `nowMs >= endMs`.
 */
export function SentinelMicroDashboard({ row, theme, onOpenDetail, style, testID }: Props) {
  const { t, i18n } = useTranslation();
  const { spectrum } = useUserSpectrum();
  const isProUser = spectrum.isProUser;
  const locale = i18n.language;

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

  if (!trip || !hasTripPromiseValidated(trip) || !bundle) return null;
  if (!isSentinelMicroDashboardEphemeral(nowMs, bundle)) return null;

  const departureTitle = t('sentinelFocus.departureTitle', { name: titleName });
  const arrivalSubtitle = arrivalHm ? t('sentinelFocus.arrivalSubtitle', { time: arrivalHm }) : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={departureTitle}
      onPress={() => onOpenDetail(row)}
      style={({ pressed }) => [SENTINEL_HUB_PILL_STYLE, style, pressed && styles.pressed]}
      testID={testID ?? 'sentinel-micro-dashboard'}
    >
      <Text style={styles.title} numberOfLines={1}>
        {departureTitle}
      </Text>
      {arrivalSubtitle ? (
        <Text style={styles.subtitle} numberOfLines={1}>
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
          showAlarmIcon={false}
          variant="compact"
          lateVariant="graphite"
          theme={theme}
          style={CAPSULE_FLAT}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 16,
    color: '#1C1C1E',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
    color: 'rgba(60, 60, 67, 0.72)',
    marginBottom: 6,
  },
  capsuleWrap: {
    width: '100%',
    marginTop: 2,
  },
  pressed: { opacity: 0.92 },
});
