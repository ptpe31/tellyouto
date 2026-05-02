import React, { useCallback, useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SegmentedButtons, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import type { TrankilIntentStatus } from '../api';
import { NeumorphicCard } from './NeumorphicCard';
import { neumorphicInset, neumorphicRaised } from '../theme/neumorphism';
import { Platform as RPlatform } from '../utils/rnPlatform';

type TimeNav = 'TODAY' | 'TOMORROW' | 'WEEK' | 'CUSTOM';
type ContextBubble = 'ALL' | 'HOME' | 'WORK' | 'PIGGY' | 'ARCHIVES';

export type TimelineFilterModalProps = {
  visible: boolean;
  onClose: () => void;
  timeNav: TimeNav;
  setTimeNav: React.Dispatch<React.SetStateAction<TimeNav>>;
  customPickedDate: Date | null;
  setCustomPickedDate: React.Dispatch<React.SetStateAction<Date | null>>;
  setDatePickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  contextBubble: ContextBubble;
  setContextBubble: React.Dispatch<React.SetStateAction<ContextBubble>>;
  statusFilter: TrankilIntentStatus;
  setStatusFilter: React.Dispatch<React.SetStateAction<TrankilIntentStatus>>;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

function dateAtNoon(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

function formatPilotDayChip(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

export function TimelineFilterModal({
  visible,
  onClose,
  timeNav,
  setTimeNav,
  customPickedDate,
  setCustomPickedDate,
  setDatePickerOpen,
  contextBubble,
  setContextBubble,
  statusFilter,
  setStatusFilter,
}: TimelineFilterModalProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const handleTimeNavChange = useCallback(
    (v: string) => {
      if (v === 'CUSTOM') {
        if (RPlatform.OS === 'web') return;
        setTimeNav('CUSTOM');
        setCustomPickedDate((prev) => dateAtNoon(prev ?? startOfToday()));
        setDatePickerOpen(true);
        return;
      }
      setTimeNav(v as 'TODAY' | 'TOMORROW' | 'WEEK');
      setCustomPickedDate(null);
    },
    [setCustomPickedDate, setDatePickerOpen, setTimeNav],
  );

  const timeNavButtons = useMemo(() => {
    const base: {
      value: 'TODAY' | 'TOMORROW' | 'WEEK' | 'CUSTOM';
      label: string;
      style: typeof styles.segmentBtnCompact;
      labelStyle: typeof styles.segmentLabelCompact;
    }[] = [
      {
        value: 'TODAY',
        label: t('horizons.today'),
        style: styles.segmentBtnCompact,
        labelStyle: styles.segmentLabelCompact,
      },
      {
        value: 'TOMORROW',
        label: t('horizons.tomorrow'),
        style: styles.segmentBtnCompact,
        labelStyle: styles.segmentLabelCompact,
      },
      {
        value: 'WEEK',
        label: t('horizons.thisWeek'),
        style: styles.segmentBtnCompact,
        labelStyle: styles.segmentLabelCompact,
      },
    ];
    if (RPlatform.OS === 'web') return base;
    base.push({
      value: 'CUSTOM',
      label:
        timeNav === 'CUSTOM' && customPickedDate
          ? t('timeline.pilot.pickedDateShort', { date: formatPilotDayChip(customPickedDate) })
          : t('timeline.pilot.specificDate'),
      style: styles.segmentBtnCompact,
      labelStyle: styles.segmentLabelCompact,
    });
    return base;
  }, [customPickedDate, t, timeNav]);

  const contextDefs: { id: ContextBubble; label: string; emoji?: string }[] = useMemo(
    () => [
      { id: 'ALL', label: t('timeline.pilot.contextAll') },
      { id: 'HOME', label: t('timeline.pilot.contextHome'), emoji: '🏠' },
      { id: 'WORK', label: t('timeline.pilot.contextWork'), emoji: '💼' },
      { id: 'PIGGY', label: t('timeline.pilot.contextPiggy'), emoji: '🐷' },
      { id: 'ARCHIVES', label: t('timeline.pilot.contextArchives'), emoji: '📦' },
    ],
    [t],
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.background,
              paddingTop: insets.top + 12,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: theme.colors.onBackground }]}>
              {t('timeline.pilot.title')}
            </Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={{ color: theme.colors.primary, fontWeight: '800' }}>{t('common.cancel')}</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetContent}>
            <NeumorphicCard style={styles.cardBlock}>
              <View style={styles.segmentLabelRow}>
                <Text style={[styles.cardLabel, { color: theme.colors.primary }]}>{t('timeline.pilot.timeNav')}</Text>
              </View>
              <SegmentedButtons
                value={timeNav}
                onValueChange={(v) => handleTimeNavChange(v)}
                buttons={timeNavButtons}
                density="small"
                style={styles.segment}
              />
              {timeNav === 'CUSTOM' && RPlatform.OS !== 'web' ? (
                <Pressable
                  onPress={() => setDatePickerOpen(true)}
                  style={[styles.changeDateLink, { borderColor: theme.colors.outlineVariant }]}
                >
                  <Text style={[styles.changeDateLinkText, { color: theme.colors.primary }]}>
                    {t('timeline.pilot.changeDate')}
                  </Text>
                </Pressable>
              ) : null}
            </NeumorphicCard>

            <NeumorphicCard style={styles.cardBlock}>
              <Text style={[styles.cardLabel, { color: theme.colors.primary }]}>{t('timeline.pilot.contextNav')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bubbleRow}>
                {contextDefs.map((c) => {
                  const selected = contextBubble === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => setContextBubble(c.id)}
                      style={[
                        selected ? neumorphicRaised(theme) : neumorphicInset(theme),
                        styles.contextBubble,
                        {
                          borderWidth: 1,
                          borderColor: selected ? theme.colors.primary : theme.colors.outlineVariant,
                          borderStyle: selected ? 'solid' : 'dashed',
                        },
                      ]}
                    >
                      <Text style={[styles.bubbleLabel, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                        {c.emoji ? `${c.emoji} ` : ''}
                        {c.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </NeumorphicCard>

            <NeumorphicCard style={styles.cardBlock}>
              <Text style={[styles.cardLabel, { color: theme.colors.primary }]}>{t('timeline.pilot.statusNav')}</Text>
              <View style={styles.statusRow}>
                <Pressable
                  onPress={() => setStatusFilter('TODO')}
                  style={[
                    neumorphicInset(theme),
                    styles.statusBtn,
                    statusFilter === 'TODO' && { borderColor: theme.colors.primary, borderWidth: 1 },
                  ]}
                >
                  <Text style={[styles.statusBtnText, { color: theme.colors.onSurfaceVariant }]}>
                    {t('timeline.pilot.todo')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setStatusFilter('DONE')}
                  style={[
                    neumorphicInset(theme),
                    styles.statusBtn,
                    statusFilter === 'DONE' && { borderColor: theme.colors.primary, borderWidth: 1 },
                  ]}
                >
                  <Text style={[styles.statusBtnText, { color: theme.colors.onSurfaceVariant }]}>
                    {t('timeline.pilot.done')}
                  </Text>
                </Pressable>
              </View>
            </NeumorphicCard>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, maxHeight: '90%' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10 },
  sheetTitle: { fontSize: 18, fontWeight: '900' },
  sheetContent: { gap: 10, paddingBottom: 12 },
  cardBlock: { marginBottom: 0 },
  cardLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.35, marginBottom: 6, opacity: 0.92 },
  segment: { marginTop: 0, minHeight: 36 },
  segmentBtnCompact: { minHeight: 32 },
  segmentLabelCompact: { fontSize: 12, fontWeight: '700' },
  segmentLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  changeDateLink: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  changeDateLinkText: { fontSize: 12, fontWeight: '700' },
  bubbleRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  contextBubble: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bubbleLabel: { fontSize: 12, fontWeight: '700' },
  statusRow: { flexDirection: 'row', gap: 10 },
  statusBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
  },
  statusBtnText: { fontSize: 13, fontWeight: '700' },
});
