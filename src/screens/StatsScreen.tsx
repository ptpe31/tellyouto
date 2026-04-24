import React, { useEffect, useMemo, useState } from 'react';
import { DeviceEventEmitter, LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';
import Svg, { Path, Polyline } from 'react-native-svg';

import {
  DATABASE_RESET_COMPLETE_EVENT,
  INTENTIONS_CHANGED_EVENT_NAME,
  LOCAL_DB_RESET_EVENT,
} from '../api/localDb';
import { NeumorphicCard } from '../components';
import { DATA_CHANGED_EVENT } from '../constants/appEvents';
import {
  buildTrendDayKeys,
  calculateUserVAE,
  canShowStats,
  getDailyActivityCountsSeries,
  listActiveDayKeys,
  type UserVAE,
} from '../services/userProfilingService';

const TREND_DAYS = 14;
const SPARKLINE_HEIGHT = 44;

type ActivitySparklineProps = {
  values: number[];
  color: string;
  trackColor: string;
  width: number;
};

function ActivitySparkline({ values, color, trackColor, width }: ActivitySparklineProps) {
  const h = SPARKLINE_HEIGHT;
  const n = values.length;
  if (n === 0 || width <= 4) return null;

  const maxV = Math.max(...values, 1);
  const padL = 2;
  const padR = 2;
  const padT = 6;
  const padB = 4;
  const innerW = Math.max(0, width - padL - padR);
  const innerH = Math.max(1, h - padT - padB);

  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const x = padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = padT + innerH - (values[i] / maxV) * innerH;
    points.push({ x, y });
  }

  const baseline = h - padB;
  let areaPath = `M ${points[0].x} ${baseline} L ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    areaPath += ` L ${points[i].x} ${points[i].y}`;
  }
  areaPath += ` L ${points[points.length - 1].x} ${baseline} Z`;

  const linePoints = points.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <Svg width={width} height={h} accessibilityRole="image">
      <Path d={`M 0 ${baseline} L ${width} ${baseline}`} stroke={trackColor} strokeWidth={1} />
      <Path d={areaPath} fill={color} fillOpacity={0.14} />
      <Polyline
        points={linePoints}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function StatsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [statsGate, setStatsGate] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vae, setVae] = useState<UserVAE | null>(null);
  const [activeDayKeys, setActiveDayKeys] = useState<string[]>([]);
  const [sparklineValues, setSparklineValues] = useState<number[]>([]);
  const [sparklineWidth, setSparklineWidth] = useState(0);

  useEffect(() => {
    const refresh = () => void canShowStats().then(setStatsGate);
    refresh();
    const subs = [
      DeviceEventEmitter.addListener(DATA_CHANGED_EVENT, refresh),
      DeviceEventEmitter.addListener(INTENTIONS_CHANGED_EVENT_NAME, refresh),
      DeviceEventEmitter.addListener(DATABASE_RESET_COMPLETE_EVENT, refresh),
      DeviceEventEmitter.addListener(LOCAL_DB_RESET_EVENT, refresh),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  useEffect(() => {
    if (statsGate !== true) return;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [nextVae, activeKeys, dailyCounts] = await Promise.all([
          calculateUserVAE(),
          listActiveDayKeys(TREND_DAYS),
          getDailyActivityCountsSeries(TREND_DAYS),
        ]);
        setVae(nextVae);
        setActiveDayKeys(activeKeys);
        setSparklineValues(dailyCounts);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [statsGate]);

  const trendKeys = useMemo(() => buildTrendDayKeys(TREND_DAYS), []);

  const completionPct = Math.round((vae?.actionRatio ?? 0) * 100);
  const activeDaySet = useMemo(() => new Set(activeDayKeys), [activeDayKeys]);
  const activeDays = vae?.activeDays ?? 0;

  const neutralSummary = useMemo(() => {
    if (!vae) return t('stats.loading');
    if (vae.actionRatio < 0.3 && vae.volume >= 8) {
      return t('stats.trendFocusCapture');
    }
    if (vae.actionRatio > 0.7 && vae.engagementRatio < 0.5) {
      return t('stats.trendEfficiencyActiveSessions');
    }
    if (vae.archivedRatio > 0.5) {
      return t('stats.trendCalendarFlow');
    }
    return t('stats.trendBalancedFlow');
  }, [t, vae]);

  if (statsGate !== true) {
    return null;
  }

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.pad}
    >
      <NeumorphicCard style={styles.heroCard}>
        <Text style={[styles.screenTitle, { color: theme.colors.onBackground }]}>
          {t('stats.screenTitle')}
        </Text>
        <Text
          style={[styles.screenSub, { color: theme.colors.onSurfaceVariant }]}
        >
          {t('stats.screenSubtitle')}
        </Text>
      </NeumorphicCard>

      <NeumorphicCard style={styles.sectionCard}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
          {t('stats.trendDashboardTitle')}
        </Text>
        <Text style={[styles.sectionSub, { color: theme.colors.onSurfaceVariant }]}>
          {t('stats.trendDashboardSubtitle')}
        </Text>
        <View style={styles.factRow}>
          <Text style={[styles.factLabel, { color: theme.colors.onSurfaceVariant }]}>
            {t('stats.trendCaptureVolume')}
          </Text>
          <Text style={[styles.factValue, { color: theme.colors.onBackground }]}>
            {loading ? '...' : vae?.volume ?? 0}
          </Text>
        </View>
      </NeumorphicCard>

      <NeumorphicCard style={styles.sectionCard}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
          {t('stats.trendCompletionRate')}
        </Text>
        <Text style={[styles.sectionSub, { color: theme.colors.onSurfaceVariant }]}>
          {t('stats.trendCompletionHint')}
        </Text>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${Math.max(0, Math.min(100, completionPct))}%`,
                backgroundColor: theme.colors.primary,
              },
            ]}
          />
        </View>
        <Text style={[styles.factValue, { color: theme.colors.onBackground, marginTop: 8 }]}>
          {loading ? '...' : `${completionPct}%`}
        </Text>
      </NeumorphicCard>

      <NeumorphicCard style={styles.sectionCard}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
          {t('stats.trendRegularity')}
        </Text>
        <Text style={[styles.sectionSub, { color: theme.colors.onSurfaceVariant }]}>
          {loading
            ? t('stats.loading')
            : t('stats.trendRegularityMeta', { active: activeDays, total: TREND_DAYS })}
        </Text>
        <View
          style={styles.sparklineWrap}
          onLayout={(e: LayoutChangeEvent) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0 && Math.abs(w - sparklineWidth) > 0.5) setSparklineWidth(w);
          }}
        >
          {sparklineWidth > 0 ? (
            <ActivitySparkline
              values={sparklineValues.length > 0 ? sparklineValues : Array.from({ length: TREND_DAYS }).map(() => 0)}
              width={sparklineWidth}
              color={theme.colors.primary}
              trackColor="rgba(148,163,184,0.35)"
            />
          ) : null}
        </View>
        <View style={styles.daysGrid}>
          {trendKeys.map((key) => {
            const isActive = activeDaySet.has(key);
            return (
              <View
                key={key}
                style={[
                  styles.dayDot,
                  {
                    backgroundColor: isActive ? theme.colors.primary : '#d1d5db',
                    opacity: isActive ? 1 : 0.45,
                  },
                ]}
              />
            );
          })}
        </View>
      </NeumorphicCard>

      <NeumorphicCard style={styles.sectionCard}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
          {t('stats.trendDynamicsTitle')}
        </Text>
        <Text style={[styles.sectionSub, { color: theme.colors.onSurfaceVariant }]}>
          {neutralSummary}
        </Text>
        {error ? (
          <Text style={styles.errorText}>
            {error}
          </Text>
        ) : null}
      </NeumorphicCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: 16, paddingBottom: 40 },
  heroCard: { marginBottom: 16, paddingVertical: 14 },
  screenTitle: { fontSize: 24, fontWeight: '700', marginBottom: 6 },
  screenSub: { fontSize: 14, lineHeight: 20 },
  sectionCard: { marginBottom: 14 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  sectionSub: { fontSize: 13, lineHeight: 18, marginBottom: 10 },
  factRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  factLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  factValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  progressTrack: {
    width: '100%',
    height: 10,
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.45)',
    backgroundColor: '#e5e7eb',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  sparklineWrap: {
    width: '100%',
    marginTop: 6,
    marginBottom: 10,
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  dayDot: {
    width: 14,
    height: 14,
    borderRadius: 4,
  },
  errorText: {
    marginTop: 8,
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '600',
  },
});
