import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import type { MD3Theme } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import type { TrankilV2TimelineItemRow } from '../api';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { useSentinelFocus } from '../hooks/useSentinelFocus';
import { generateSmartTitle } from '../services/smartTitle';
import { SentinelMicroDashboard, SENTINEL_HUB_PILL_STYLE } from './SentinelMicroDashboard';
import {
  isSentinelFocusSlotVisible,
  isSentinelMicroDashboardEphemeral,
  pickSentinelFocus,
  resolveSentinelFocusPromptTimeHm,
  resolveSentinelMicroDashboardBundle,
} from '../utils/sentinelFocusSelection';

type SentinelFocusBadgeProps = {
  rows: TrankilV2TimelineItemRow[];
  todayYmd: string;
  theme: MD3Theme;
  onOpenDetail: (row: TrankilV2TimelineItemRow) => void;
  onOpenProPaywall?: () => void;
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
      style={({ pressed }) => [SENTINEL_HUB_PILL_STYLE, styles.promptInner, style, pressed && styles.pressed]}
      testID={testID}
    >
      <Text style={styles.promptText} numberOfLines={2}>
        {promptText}
      </Text>
    </Pressable>
  );
}

/**
 * Badge Sentinel sous « Aujourd'hui » — micro-dashboard éphémère pleine largeur ou suggestion.
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
  const { microDashboardTrip, unconfiguredTrip, visible } = useSentinelFocus({ rows, todayYmd });

  if (!visible) return null;

  if (microDashboardTrip) {
    return (
      <SentinelMicroDashboard
        row={microDashboardTrip}
        theme={theme}
        onOpenDetail={onOpenDetail}
        style={style}
        testID={testID ?? 'sentinel-focus-micro'}
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
  const bundle =
    pick.microDashboardTrip &&
    resolveSentinelMicroDashboardBundle(pick.microDashboardTrip, options.locale, options.isProUser);
  if (bundle && isSentinelMicroDashboardEphemeral(nowMs, bundle)) {
    return 118;
  }
  if (pick.unconfiguredTrip) return 72;
  return 0;
}

const styles = StyleSheet.create({
  promptInner: {
    justifyContent: 'center',
  },
  promptText: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
    color: '#1C1C1E',
  },
  pressed: { opacity: 0.92 },
});
