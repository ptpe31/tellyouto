import { Calendar as CalendarIcon, Check, Crown, PiggyBank } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

const TD = {
  text: '#F5F5F0',
  muted: 'rgba(226, 232, 240, 0.75)',
  teal: '#008080',
  tealSoft: 'rgba(0, 128, 128, 0.16)',
  tealBorder: 'rgba(0, 128, 128, 0.45)',
  orange: '#FF8C00',
  piggyBadgeBg: 'rgba(255, 140, 0, 0.28)',
  piggyBadgeBorder: 'rgba(255, 140, 0, 0.5)',
};

export type PilotStatusHeaderVariant = 'talkDebug' | 'timeline';

export type PilotStatusHeaderProps = {
  variant: PilotStatusHeaderVariant;
  isProUser: boolean;
  freeRemaining: number;
  freeMax: number;
  dayOfMonth: number;
  todayTodoCount: number;
  piggyCount: number;
  onPressCredits: () => void;
  onPressCalendar: () => void;
  onPressPiggy: () => void;
  translate: (key: string, options?: Record<string, string | number>) => string;
};

export function PilotStatusHeader({
  variant,
  isProUser,
  freeRemaining,
  freeMax,
  dayOfMonth,
  todayTodoCount,
  piggyCount,
  onPressCredits,
  onPressCalendar,
  onPressPiggy,
  translate,
}: PilotStatusHeaderProps) {
  const theme = useTheme();
  const isTalk = variant === 'talkDebug';
  const text = isTalk ? TD.text : theme.colors.onBackground;
  const muted = isTalk ? TD.muted : theme.colors.onSurfaceVariant;
  const primary = isTalk ? TD.teal : theme.colors.primary;
  const accent = '#FF8C00';

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={translate('pilotHeader.a11yCredits')}
        onPress={onPressCredits}
        style={[
          styles.creditChip,
          isTalk
            ? { borderColor: TD.tealBorder, backgroundColor: TD.tealSoft }
            : {
                borderColor: theme.colors.outlineVariant,
                backgroundColor: theme.colors.surfaceVariant,
              },
        ]}
      >
        {isProUser ? (
          <View style={styles.proInner}>
            <Crown size={18} color={accent} />
            <Text style={[styles.proText, { color: primary }]}>{translate('pilotHeader.proLabel')}</Text>
          </View>
        ) : freeRemaining <= 0 ? (
          <View style={styles.depletedCol}>
            <Text style={[styles.creditMain, { color: text }]}>{translate('pilotHeader.creditsDepleted')}</Text>
            <Text style={[styles.creditHint, { color: muted }]} numberOfLines={1}>
              {translate('pilotHeader.creditsDepletedHint')}
            </Text>
          </View>
        ) : (
          <Text style={[styles.creditMain, { color: text }]}>
            {translate('pilotHeader.creditsFree', { remaining: freeRemaining, max: freeMax })}
          </Text>
        )}
      </Pressable>

      <View style={styles.spacer} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={translate('pilotHeader.a11yCalendar')}
        onPress={onPressCalendar}
        style={styles.cluster}
      >
        <View
          style={[
            styles.calendarGlyph,
            isTalk
              ? { borderColor: TD.tealBorder, backgroundColor: TD.tealSoft }
              : {
                  borderColor: theme.colors.outlineVariant,
                  backgroundColor: theme.colors.surfaceVariant,
                },
          ]}
        >
          <CalendarIcon size={20} color={isTalk ? TD.text : primary} />
          <Text style={[styles.dayNum, { color: text }]}>{dayOfMonth}</Text>
        </View>
        {todayTodoCount > 0 ? (
          <View
            style={[
              styles.badgeTodo,
              isTalk
                ? { backgroundColor: 'rgba(0, 128, 128, 0.35)', borderColor: 'rgba(0, 128, 128, 0.55)' }
                : { backgroundColor: theme.colors.primaryContainer, borderColor: theme.colors.primary },
            ]}
          >
            <Text style={[styles.badgeTodoText, { color: isTalk ? '#ecfeff' : theme.colors.onPrimaryContainer }]}>
              {todayTodoCount}
            </Text>
          </View>
        ) : (
          <View
            style={[
              styles.zeroCheck,
              isTalk
                ? { borderColor: 'rgba(0, 128, 128, 0.4)', backgroundColor: 'rgba(245, 245, 240, 0.12)' }
                : { borderColor: theme.colors.outlineVariant, backgroundColor: theme.colors.surface },
            ]}
          >
            <Check size={15} color={primary} strokeWidth={2.5} />
          </View>
        )}
      </Pressable>

      <View style={styles.spacer} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={translate('pilotHeader.a11yPiggy')}
        onPress={onPressPiggy}
        style={styles.cluster}
      >
        <PiggyBank size={22} color={accent} />
        {piggyCount > 0 ? (
          <View
            style={[
              styles.badgePiggy,
              isTalk
                ? { backgroundColor: TD.piggyBadgeBg, borderColor: TD.piggyBadgeBorder }
                : { backgroundColor: 'rgba(255, 140, 0, 0.2)', borderColor: theme.colors.outlineVariant },
            ]}
          >
            <Text style={[styles.badgePiggyText, { color: isTalk ? '#fff7ed' : theme.colors.onSurface }]}>
              {piggyCount}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  spacer: { flex: 1 },
  cluster: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  creditChip: {
    maxWidth: '34%',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  proInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  proText: { fontSize: 13, fontWeight: '800' },
  creditMain: { fontSize: 13, fontWeight: '800' },
  depletedCol: { gap: 2 },
  creditHint: { fontSize: 10, fontWeight: '700' },
  calendarGlyph: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  dayNum: { fontSize: 22, fontWeight: '800', minWidth: 26, textAlign: 'center' },
  badgeTodo: {
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeTodoText: { fontSize: 13, fontWeight: '800', textAlign: 'center' },
  zeroCheck: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgePiggy: {
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgePiggyText: { fontSize: 13, fontWeight: '800', textAlign: 'center' },
});
