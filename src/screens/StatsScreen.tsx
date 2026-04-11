import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';
import Svg, { Circle, G } from 'react-native-svg';

import {
  listCompletedSessionsBetween,
  listRecentCompletedFocusSessions,
  LOCAL_DB_RESET_EVENT,
  type IntentionRow,
} from '../api/localDb';
import { AgentInsight } from '../components/AgentInsight';
import { NeumorphicCard } from '../components';
import { usePower } from '../context/PowerContext';
import {
  clarityPercent,
  distributeMinutesBySpectrum,
  dominantAxis,
  spectrumPercentages,
  totalSpectrumMinutes,
  type SpectrumAxis,
} from '../services/dayStats';
import { palette } from '../theme/colors';
import { neumorphicInset } from '../theme/neumorphism';

const DONUT = 120;
const R = (DONUT - 14) / 2;
const CX = DONUT / 2;
const CY = DONUT / 2;
const STROKE = 12;
const CIRC = 2 * Math.PI * R;

const AXIS_ORDER: SpectrumAxis[] = [
  'structure',
  'momentum',
  'zen',
  'stats',
];

const BAR_COLORS = [palette.teal, palette.tealLight, palette.orange, palette.orangeLight];

function startEndLocalDay(d: Date): { start: number; end: number } {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return { start: s.getTime(), end: e.getTime() };
}

function groupSessionsByDay(rows: IntentionRow[]): {
  dayKey: string;
  count: number;
  dateMs: number;
}[] {
  const map = new Map<string, { count: number; dateMs: number }>();
  for (const r of rows) {
    const ts = r.completed_at ?? r.created_at;
    const day = new Date(ts);
    day.setHours(0, 0, 0, 0);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const cur = map.get(key) ?? { count: 0, dateMs: day.getTime() };
    cur.count += 1;
    map.set(key, cur);
  }
  return Array.from(map.entries())
    .map(([dayKey, v]) => ({ dayKey, ...v }))
    .sort((a, b) => b.dateMs - a.dateMs)
    .slice(0, 14);
}

type SpectrumBarsProps = {
  pct: Record<SpectrumAxis, number>;
  labels: Record<SpectrumAxis, string>;
};

function SpectrumBars({ pct, labels }: SpectrumBarsProps) {
  const theme = useTheme();
  return (
    <View>
      {AXIS_ORDER.map((axis, i) => (
        <View key={axis} style={styles.barBlock}>
          <View style={styles.barHeader}>
            <Text style={[styles.barLabel, { color: theme.colors.onSurface }]}>
              {labels[axis]}
            </Text>
            <Text
              style={[styles.barPct, { color: theme.colors.onSurfaceVariant }]}
            >
              {pct[axis]}%
            </Text>
          </View>
          <View
            style={[
              neumorphicInset(theme),
              styles.barTrack,
            ]}
          >
            <View
              style={[
                styles.barFill,
                {
                  width: `${Math.min(100, pct[axis])}%`,
                  backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

type DonutProps = {
  pct: Record<SpectrumAxis, number>;
};

function SpectrumDonut({ pct }: DonutProps) {
  const colors = BAR_COLORS;
  let cum = 0;
  return (
    <View style={styles.donutWrap}>
      <Svg width={DONUT} height={DONUT}>
        <G transform={`rotate(-90 ${CX} ${CY})`}>
          {AXIS_ORDER.map((axis, i) => {
            const arc = (pct[axis] / 100) * CIRC;
            const strokeDashoffset = -cum;
            cum += arc;
            return (
              <Circle
                key={axis}
                cx={CX}
                cy={CY}
                r={R}
                stroke={colors[i % colors.length]}
                strokeWidth={STROKE}
                fill="none"
                strokeDasharray={`${arc} ${CIRC}`}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                opacity={0.92}
              />
            );
          })}
        </G>
      </Svg>
    </View>
  );
}

export function StatsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const power = usePower();
  const [loading, setLoading] = useState(true);
  const [todayRows, setTodayRows] = useState<IntentionRow[]>([]);
  const [historyRows, setHistoryRows] = useState<IntentionRow[]>([]);

  const load = useCallback(async () => {
    const { start, end } = startEndLocalDay(new Date());
    const [dayList, recent] = await Promise.all([
      listCompletedSessionsBetween(start, end),
      listRecentCompletedFocusSessions(200),
    ]);
    setTodayRows(dayList);
    setHistoryRows(recent);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(LOCAL_DB_RESET_EVENT, () => {
      void load();
    });
    return () => sub.remove();
  }, [load]);

  const dist = useMemo(
    () => distributeMinutesBySpectrum(todayRows),
    [todayRows],
  );
  const pct = useMemo(() => spectrumPercentages(dist), [dist]);
  const totalMin = totalSpectrumMinutes(dist);
  const dom = useMemo(() => dominantAxis(dist), [dist]);
  const clarity = useMemo(() => clarityPercent(todayRows), [todayRows]);
  const dayGroups = useMemo(
    () => groupSessionsByDay(historyRows),
    [historyRows],
  );

  const axisLabels = useMemo(
    () =>
      AXIS_ORDER.reduce(
        (acc, a) => {
          acc[a] = t(`stats.axis.${a}`);
          return acc;
        },
        {} as Record<SpectrumAxis, string>,
      ),
    [t],
  );

  const formatDay = useCallback(
    (ms: number) =>
      new Date(ms).toLocaleDateString(i18n.language, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }),
    [i18n.language],
  );

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.pad}
    >
      <Text style={[styles.screenTitle, { color: theme.colors.onBackground }]}>
        {t('stats.screenTitle')}
      </Text>
      <Text style={[styles.screenSub, { color: theme.colors.onSurfaceVariant }]}>
        {t('stats.screenSubtitle')}
      </Text>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={palette.teal} size="large" />
          <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
            {t('stats.loading')}
          </Text>
        </View>
      ) : (
        <>
          <AgentInsight
            sessionCount={todayRows.length}
            clarityPercent={clarity}
            dominant={dom}
            isLowPower={power.isLowPower}
            energyScore={power.energyScore}
          />

          <NeumorphicCard style={styles.card}>
            <Text style={[styles.cardTitle, { color: theme.colors.primary }]}>
              {t('stats.clarityTitle')}
            </Text>
            <Text
              style={[styles.cardHint, { color: theme.colors.onSurfaceVariant }]}
            >
              {t('stats.clarityHint')}
            </Text>
            {todayRows.length === 0 ? (
              <Text style={[styles.empty, { color: theme.colors.onSurface }]}>
                {t('stats.noSessionsToday')}
              </Text>
            ) : (
              <>
                <Text style={[styles.clarityBig, { color: palette.tealDark }]}>
                  {clarity}%
                </Text>
                <Text style={[styles.meta, { color: theme.colors.onSurface }]}>
                  {t('stats.sessionsToday', { count: todayRows.length })}
                </Text>
              </>
            )}
          </NeumorphicCard>

          <NeumorphicCard style={styles.card}>
            <Text style={[styles.cardTitle, { color: theme.colors.primary }]}>
              {t('stats.spectrumTitle')}
            </Text>
            <Text
              style={[styles.cardHint, { color: theme.colors.onSurfaceVariant }]}
            >
              {t('stats.spectrumHint')}
            </Text>
            {totalMin <= 0 ? (
              <Text style={[styles.empty, { color: theme.colors.onSurface }]}>
                {t('stats.spectrumEmpty')}
              </Text>
            ) : (
              <>
                <View style={styles.donutRow}>
                  <SpectrumDonut pct={pct} />
                  <View style={styles.donutLegend}>
                    {AXIS_ORDER.map((axis, i) => (
                      <View key={axis} style={styles.legendLine}>
                        <View
                          style={[
                            styles.legendSwatch,
                            { backgroundColor: BAR_COLORS[i % BAR_COLORS.length] },
                          ]}
                        />
                        <Text
                          style={{
                            color: theme.colors.onSurface,
                            fontSize: 12,
                            marginLeft: 8,
                          }}
                        >
                          {axisLabels[axis]} · {pct[axis]}%
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
                <SpectrumBars pct={pct} labels={axisLabels} />
                <Text style={[styles.meta, { color: theme.colors.onSurfaceVariant }]}>
                  {t('stats.minutesTotal', {
                    minutes: Math.round(totalMin),
                  })}
                </Text>
              </>
            )}
          </NeumorphicCard>

          <NeumorphicCard style={styles.card}>
            <Text style={[styles.cardTitle, { color: theme.colors.primary }]}>
              {t('stats.historyTitle')}
            </Text>
            <Text
              style={[styles.cardHint, { color: theme.colors.onSurfaceVariant }]}
            >
              {t('stats.historyHint')}
            </Text>
            {dayGroups.length === 0 ? (
              <Text style={[styles.empty, { color: theme.colors.onSurface }]}>
                {t('stats.historyEmpty')}
              </Text>
            ) : (
              dayGroups.map((g) => (
                <Text
                  key={g.dayKey}
                  style={[styles.historyLine, { color: theme.colors.onSurface }]}
                >
                  {t('stats.historyDay', {
                    date: formatDay(g.dateMs),
                    count: g.count,
                  })}
                </Text>
              ))
            )}
          </NeumorphicCard>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: 16, paddingBottom: 40 },
  screenTitle: { fontSize: 24, fontWeight: '700', marginBottom: 6 },
  screenSub: { fontSize: 14, lineHeight: 20, marginBottom: 18 },
  loader: { paddingVertical: 32, alignItems: 'center' },
  card: { marginBottom: 14 },
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  cardHint: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  clarityBig: { fontSize: 44, fontWeight: '800', marginBottom: 6 },
  meta: { fontSize: 14, lineHeight: 20 },
  empty: { fontSize: 15, lineHeight: 22 },
  donutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  donutWrap: { alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  donutLegend: { flex: 1 },
  legendLine: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  legendSwatch: { width: 10, height: 10, borderRadius: 5 },
  barBlock: { marginBottom: 14 },
  barHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  barLabel: { fontSize: 14, fontWeight: '600' },
  barPct: { fontSize: 13, fontVariant: ['tabular-nums'] },
  barTrack: {
    height: 16,
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  barFill: { height: '100%', borderRadius: 10, minWidth: 4 },
  historyLine: { fontSize: 14, lineHeight: 22, marginBottom: 6 },
});
