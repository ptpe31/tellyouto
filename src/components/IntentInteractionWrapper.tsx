import * as Haptics from 'expo-haptics';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  LongPressGestureHandler,
  type LongPressGestureHandlerStateChangeEvent,
  State,
} from 'react-native-gesture-handler';
import { useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { archiveIntention, updateTrankilV2IntentionTemporal } from '../api';
import { NeumorphicSurface } from './NeumorphicSurface';
import { Platform as RPlatform } from '../utils/rnPlatform';

export type IntentInteractionWrapperProps = {
  intentionId: string;
  /** Ancre pour la liste de dates (reporter). */
  anchorDate: Date;
  children: React.ReactNode;
  enabled?: boolean;
  /** Après archive ou changement de date. */
  onMutation?: () => void | Promise<void>;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toYmd(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return next;
}

export function IntentInteractionWrapper({
  intentionId,
  anchorDate,
  children,
  enabled = true,
  onMutation,
}: IntentInteractionWrapperProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const menuActivatedRef = useRef(false);
  const animRunningRef = useRef<Animated.CompositeAnimation | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  const scheduleDates = useMemo(() => {
    const out: Date[] = [];
    for (let d = -2; d <= 56; d += 1) {
      out.push(addDays(anchorDate, d));
    }
    return out;
  }, [anchorDate]);

  const resetProgress = useCallback(() => {
    animRunningRef.current?.stop();
    animRunningRef.current = null;
    progress.setValue(0);
  }, [progress]);

  const startProgress = useCallback(() => {
    animRunningRef.current?.stop();
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 500,
      useNativeDriver: false,
    });
    animRunningRef.current = anim;
    anim.start();
  }, [progress]);

  const onLongPressStateChange = useCallback(
    (e: LongPressGestureHandlerStateChangeEvent) => {
      if (!enabled) return;
      const s = e.nativeEvent.state;
      if (s === State.BEGAN) {
        menuActivatedRef.current = false;
        startProgress();
        if (RPlatform.OS !== 'web') {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      }
      if (s === State.ACTIVE) {
        menuActivatedRef.current = true;
        progress.setValue(1);
        if (RPlatform.OS !== 'web') {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
        setMenuOpen(true);
      }
      if (s === State.END || s === State.CANCELLED || s === State.FAILED) {
        if (!menuActivatedRef.current) {
          resetProgress();
        }
        menuActivatedRef.current = false;
      }
    },
    [enabled, progress, resetProgress, startProgress],
  );

  const closeAll = useCallback(() => {
    setMenuOpen(false);
    setScheduleOpen(false);
    resetProgress();
  }, [resetProgress]);

  const onArchive = useCallback(async () => {
    setMenuOpen(false);
    try {
      await archiveIntention(intentionId);
      await onMutation?.();
    } finally {
      resetProgress();
    }
  }, [intentionId, onMutation, resetProgress]);

  const onPickDate = useCallback(
    async (ymd: string) => {
      setScheduleOpen(false);
      setMenuOpen(false);
      try {
        await updateTrankilV2IntentionTemporal(intentionId, { due_date: ymd });
        await onMutation?.();
      } finally {
        resetProgress();
      }
    },
    [intentionId, onMutation, resetProgress],
  );

  const barPixelWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.max(1, trackWidth)],
  });

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <View style={styles.outer}>
      <View
        style={[styles.progressTrack, { backgroundColor: theme.colors.surfaceVariant }]}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      >
        <Animated.View
          style={[
            styles.progressFill,
            {
              width: barPixelWidth,
              backgroundColor: theme.colors.primary,
            },
          ]}
        />
      </View>
      <LongPressGestureHandler
        minDurationMs={500}
        maxDist={28}
        enabled={enabled}
        onHandlerStateChange={onLongPressStateChange}
      >
        <View collapsable={false}>{children}</View>
      </LongPressGestureHandler>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={closeAll}>
        <Pressable style={styles.modalOverlay} onPress={closeAll}>
          <Pressable onPress={(ev) => ev.stopPropagation()}>
            <NeumorphicSurface
              style={[
                styles.menuCard,
                {
                  borderWidth: 1,
                  borderColor: theme.colors.outlineVariant,
                  marginBottom: insets.bottom + 12,
                },
              ]}
            >
              <Text style={[styles.menuTitle, { color: theme.colors.onSurface }]}>
                {t('intentInteraction.menuTitle')}
              </Text>
              <Pressable
                style={[styles.menuRow, { borderColor: theme.colors.outline }]}
                onPress={() => void onArchive()}
              >
                <Text style={styles.menuEmoji}>📦</Text>
                <Text style={[styles.menuLabel, { color: theme.colors.onSurface }]}>
                  {t('intentInteraction.archive')}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.menuRow, { borderColor: theme.colors.outline }]}
                onPress={() => {
                  setMenuOpen(false);
                  setScheduleOpen(true);
                }}
              >
                <Text style={styles.menuEmoji}>🗓</Text>
                <Text style={[styles.menuLabel, { color: theme.colors.onSurface }]}>
                  {t('intentInteraction.pinDue')}
                </Text>
              </Pressable>
              <Pressable onPress={closeAll} style={styles.menuCancel}>
                <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>
                  {t('intentInteraction.cancel')}
                </Text>
              </Pressable>
            </NeumorphicSurface>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={scheduleOpen} transparent animationType="slide" onRequestClose={() => setScheduleOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setScheduleOpen(false)}>
          <Pressable
            onPress={(ev) => ev.stopPropagation()}
            style={[
              styles.scheduleSheet,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.outlineVariant,
                paddingBottom: insets.bottom + 16,
              },
            ]}
          >
            <Text style={[styles.menuTitle, { color: theme.colors.onSurface }]}>
              {t('intentInteraction.pickDate')}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateRow}>
              {scheduleDates.map((d) => {
                const ymd = toYmd(d);
                return (
                  <Pressable
                    key={ymd}
                    onPress={() => void onPickDate(ymd)}
                    style={[
                      styles.dateChip,
                      {
                        backgroundColor: theme.colors.surfaceVariant,
                        borderColor: theme.colors.outline,
                      },
                    ]}
                  >
                    <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 11, fontWeight: '600' }}>
                      {ymd}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable onPress={() => setScheduleOpen(false)} style={{ marginTop: 8 }}>
              <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>
                {t('intentInteraction.cancel')}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { position: 'relative' },
  progressTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    zIndex: 2,
    overflow: 'hidden',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  progressFill: { height: 2 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
  },
  menuCard: { padding: 14, borderRadius: 18 },
  menuTitle: { fontSize: 16, fontWeight: '800', marginBottom: 10 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  menuEmoji: { fontSize: 18 },
  menuLabel: { fontSize: 15, fontWeight: '600' },
  menuCancel: { alignSelf: 'flex-end', paddingVertical: 6 },
  scheduleSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    padding: 16,
    maxHeight: '55%',
  },
  dateRow: { flexDirection: 'row', gap: 8, paddingVertical: 8 },
  dateChip: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
});
