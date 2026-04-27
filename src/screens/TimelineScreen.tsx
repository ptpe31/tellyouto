import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DeviceEventEmitter,
  FlatList,
  KeyboardAvoidingView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from 'react-native-paper';

import { withViaDb, getOrCreateViaUserId } from '../services/db/Schema';
import { TalkCaptureMicButton } from '../components/TalkCaptureMicButton';
import { INTENTIONS_CHANGED_EVENT_NAME } from '../constants/intentionEvents';
import { Platform as RPlatform } from '../utils/rnPlatform';
import { neumorphicRaised } from '../theme/neumorphism';

type CoreIntentionRow = {
  id: string;
  type: string;
  title: string;
  dueAtMs: number | null;
  status: string;
};

type ViaSentinelTripRow = {
  id: string;
  destination: string;
  arrivalAtMs: number;
  vigilanceStatus: string | null;
  sentinelMode: string;
};

function fmtHm(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function TimelineScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [intentions, setIntentions] = useState<CoreIntentionRow[]>([]);
  const [trips, setTrips] = useState<ViaSentinelTripRow[]>([]);

  const refresh = useCallback(async () => {
    const userId = await getOrCreateViaUserId();
    const { intentions: nextIntentions, trips: nextTrips } = await withViaDb(async (db) => {
      const intentionsRows = await db.getAllAsync<Record<string, unknown>>(
        `SELECT id, type, title, due_at_ms, status
           FROM core_intentions
          WHERE user_id = ?
          ORDER BY created_at_ms DESC
          LIMIT 60`,
        [userId]
      );
      const tripRows = await db.getAllAsync<Record<string, unknown>>(
        `SELECT t.id,
                l.formatted_address AS destination,
                t.target_arrival_ms,
                t.vigilance_status,
                t.sentinel_mode
           FROM via_sentinel_trips t
           JOIN via_locations l ON l.id = t.location_id
          WHERE t.user_id = ?
          ORDER BY t.target_arrival_ms DESC
          LIMIT 60`,
        [userId]
      );
      return {
        intentions: intentionsRows.map((r) => ({
          id: String(r.id ?? ''),
          type: String(r.type ?? ''),
          title: String(r.title ?? ''),
          dueAtMs: r.due_at_ms == null ? null : Number(r.due_at_ms),
          status: String(r.status ?? ''),
        })),
        trips: tripRows.map((r) => ({
          id: String(r.id ?? ''),
          destination: String(r.destination ?? ''),
          arrivalAtMs: Number(r.target_arrival_ms ?? 0),
          vigilanceStatus: r.vigilance_status == null ? null : String(r.vigilance_status),
          sentinelMode: String(r.sentinel_mode ?? 'SENTINEL'),
        })),
      };
    });
    setIntentions(nextIntentions);
    setTrips(nextTrips);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(INTENTIONS_CHANGED_EVENT_NAME, () => {
      void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const items = useMemo(() => {
    const mappedTrips = trips.map((x) => ({
      kind: 'trip' as const,
      id: `trip_${x.id}`,
      title: x.destination,
      meta: `${t('timeline.arrivalAt', { time: fmtHm(x.arrivalAtMs) })} • ${x.sentinelMode} • ${x.vigilanceStatus ?? '—'}`,
    }));
    const mappedIntentions = intentions.map((x) => ({
      kind: 'intent' as const,
      id: `intent_${x.id}`,
      title: x.title,
      meta: `${x.type} • ${x.status}${x.dueAtMs ? ` • ${t('timeline.dueAt', { time: fmtHm(x.dueAtMs) })}` : ''}`,
    }));
    return [...mappedTrips, ...mappedIntentions];
  }, [intentions, t, trips]);

  const keyboardBehavior = useMemo(() => (RPlatform.OS === 'ios' ? 'padding' : undefined), []);

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      behavior={keyboardBehavior}
      keyboardVerticalOffset={Math.max(0, insets.top + 6)}
    >
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={[styles.pad, { paddingTop: Math.max(10, insets.top + 10) }]}
        ListHeaderComponent={<Text style={[styles.h1, { color: theme.colors.onBackground }]}>{t('timeline.title')}</Text>}
        ListEmptyComponent={<Text style={[styles.muted, { color: theme.colors.onSurfaceVariant }]}>{t('timeline.empty')}</Text>}
        renderItem={({ item }) => (
          <View style={[styles.card, neumorphicRaised(theme)]}>
            <Text style={[styles.title, { color: theme.colors.onSurface }]} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={[styles.meta, { color: theme.colors.onSurfaceVariant }]} numberOfLines={2}>
              {item.meta}
            </Text>
          </View>
        )}
      />
      <View style={[styles.bottomDock, { paddingBottom: Math.max(10, insets.bottom + 10) }]}>
        <TalkCaptureMicButton compact />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: 16, paddingBottom: 140, gap: 10 },
  h1: { fontSize: 22, fontWeight: '900' },
  muted: { fontSize: 13, fontWeight: '700' },
  card: { padding: 14, borderRadius: 18, gap: 6 },
  title: { fontSize: 14, fontWeight: '900' },
  meta: { fontSize: 12, fontWeight: '700' },
  bottomDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
  },
});
