import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { withViaDb, getOrCreateViaUserId } from '../services/db/Schema';

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

  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <Text style={styles.h1}>{t('timeline.title')}</Text>

      <Text style={styles.h2}>{t('timeline.sectionSentinel')}</Text>
      {trips.length === 0 ? <Text style={styles.muted}>{t('timeline.empty')}</Text> : null}
      {trips.map((row) => (
        <View key={row.id} style={styles.card}>
          <Text style={styles.title}>{row.destination}</Text>
          <Text style={styles.meta}>
            {t('timeline.arrivalAt', { time: fmtHm(row.arrivalAtMs) })} • {row.sentinelMode} •{' '}
            {row.vigilanceStatus ?? '—'}
          </Text>
        </View>
      ))}

      <Text style={[styles.h2, { marginTop: 18 }]}>{t('timeline.sectionIntentions')}</Text>
      {intentions.length === 0 ? <Text style={styles.muted}>{t('timeline.empty')}</Text> : null}
      {intentions.map((row) => (
        <View key={row.id} style={styles.card}>
          <Text style={styles.title}>{row.title}</Text>
          <Text style={styles.meta}>
            {row.type} • {row.status}
            {row.dueAtMs ? ` • ${t('timeline.dueAt', { time: fmtHm(row.dueAtMs) })}` : ''}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, paddingBottom: 40, gap: 10 },
  h1: { fontSize: 22, fontWeight: '900', color: '#0f172a' },
  h2: { fontSize: 14, fontWeight: '900', color: '#0f172a', marginTop: 6 },
  muted: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  card: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#fff',
    gap: 4,
  },
  title: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  meta: { fontSize: 12, fontWeight: '700', color: '#475569' },
});

