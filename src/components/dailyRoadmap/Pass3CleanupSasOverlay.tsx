import { BlurView } from 'expo-blur';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MD3Theme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  archiveIntention,
  updateTrankilV2IntentionTemporal,
  type Pass3CleanupBucket,
  type TrankilV2IntentionRow,
} from '../../api';

export type Pass3CleanupRow = { row: TrankilV2IntentionRow; bucket: Pass3CleanupBucket };

type Props = {
  visible: boolean;
  theme: MD3Theme;
  todayYmd: string;
  initialRows: Pass3CleanupRow[];
  translate: (key: string) => string;
  onClose: () => void;
  onLaunchSynthesis: (overdue: TrankilV2IntentionRow[], orphans: TrankilV2IntentionRow[]) => void;
};

/**
 * Sas plein écran : intentions en retard / sans date — actions rapides avant Pass 3.
 */
export function Pass3CleanupSasOverlay({
  visible,
  theme,
  todayYmd,
  initialRows,
  translate: t,
  onClose,
  onLaunchSynthesis,
}: Props) {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Pass3CleanupRow[]>([]);
  const [validatedOverdue, setValidatedOverdue] = useState<TrankilV2IntentionRow[]>([]);
  const [validatedOrphans, setValidatedOrphans] = useState<TrankilV2IntentionRow[]>([]);

  useEffect(() => {
    if (!visible) return;
    setRows([...initialRows]);
    setValidatedOverdue([]);
    setValidatedOrphans([]);
  }, [visible, initialRows]);

  const canLaunch = rows.length === 0;

  const removeId = useCallback((id: string) => {
    setRows((prev) => prev.filter((x) => x.row.id !== id));
  }, []);

  const onValidate = useCallback(
    (entry: Pass3CleanupRow) => {
      if (entry.bucket === 'overdue') {
        setValidatedOverdue((p) => [...p, entry.row]);
      } else {
        setValidatedOrphans((p) => [...p, entry.row]);
      }
      removeId(entry.row.id);
    },
    [removeId],
  );

  const onPostpone = useCallback(
    async (entry: Pass3CleanupRow) => {
      await updateTrankilV2IntentionTemporal(entry.row.id, { due_date: todayYmd });
      removeId(entry.row.id);
    },
    [removeId, todayYmd],
  );

  const onDelete = useCallback(
    async (entry: Pass3CleanupRow) => {
      await archiveIntention(entry.row.id);
      removeId(entry.row.id);
    },
    [removeId],
  );

  const bucketLabel = useCallback(
    (b: Pass3CleanupBucket) => (b === 'overdue' ? t('timeline.roadmap.bucketOverdue') : t('timeline.roadmap.bucketOrphan')),
    [t],
  );

  const titleStyle = useMemo(() => [styles.title, { color: theme.colors.onSurface }], [theme.colors.onSurface]);
  const subStyle = useMemo(() => [styles.sub, { color: theme.colors.onSurfaceVariant }], [theme.colors.onSurfaceVariant]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.root} pointerEvents="box-none">
        <View style={styles.backdropSolid} pointerEvents="none" />
        <BlurView intensity={44} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[styles.sheet, { paddingTop: Math.max(insets.top, 14) + 8, paddingBottom: insets.bottom + 12 }]}>
          <Text style={titleStyle}>{t('timeline.roadmap.sasTitle')}</Text>
          <Text style={subStyle}>{t('timeline.roadmap.sasSubtitle')}</Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {rows.length === 0 ? (
              <Text style={[styles.empty, { color: theme.colors.onSurfaceVariant }]}>{t('timeline.roadmap.sasEmptyHint')}</Text>
            ) : (
              rows.map((entry) => (
                <View
                  key={entry.row.id}
                  style={[styles.card, { borderColor: theme.colors.outlineVariant, backgroundColor: theme.colors.surface }]}
                >
                  <Text style={[styles.badge, { color: theme.colors.primary }]}>{bucketLabel(entry.bucket)}</Text>
                  <Text style={[styles.rowTitle, { color: theme.colors.onSurface }]} numberOfLines={2}>
                    {entry.row.title}
                  </Text>
                  <View style={styles.actions}>
                    <Pressable
                      onPress={() => onValidate(entry)}
                      style={({ pressed }) => [styles.btn, styles.btnOk, { opacity: pressed ? 0.85 : 1 }]}
                    >
                      <Text style={styles.btnOkText}>{t('timeline.roadmap.validate')}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void onPostpone(entry)}
                      style={({ pressed }) => [styles.btn, styles.btnGhost, { borderColor: theme.colors.outline, opacity: pressed ? 0.85 : 1 }]}
                    >
                      <Text style={[styles.btnGhostText, { color: theme.colors.onSurface }]}>{t('timeline.roadmap.postpone')}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void onDelete(entry)}
                      style={({ pressed }) => [styles.btn, styles.btnDanger, { opacity: pressed ? 0.85 : 1 }]}
                    >
                      <Text style={styles.btnDangerText}>{t('timeline.roadmap.delete')}</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
          <View style={styles.footer}>
            <Pressable onPress={onClose} style={({ pressed }) => [styles.footerBtn, { opacity: pressed ? 0.8 : 1 }]}>
              <Text style={[styles.footerBtnText, { color: theme.colors.onSurfaceVariant }]}>{t('intentInteraction.cancel')}</Text>
            </Pressable>
            <Pressable
              disabled={!canLaunch}
              onPress={() => onLaunchSynthesis(validatedOverdue, validatedOrphans)}
              style={({ pressed }) => [
                styles.footerBtnPrimary,
                {
                  backgroundColor: canLaunch ? theme.colors.primary : theme.colors.surfaceVariant,
                  opacity: !canLaunch ? 0.55 : pressed ? 0.9 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.footerBtnPrimaryText,
                  { color: canLaunch ? theme.colors.onPrimary : theme.colors.onSurfaceVariant },
                ]}
              >
                {t('timeline.roadmap.continueSynth')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdropSolid: { ...StyleSheet.absoluteFillObject, backgroundColor: '#111827' },
  sheet: { flex: 1, paddingHorizontal: 16 },
  title: { fontSize: 20, fontWeight: '800', marginBottom: 6 },
  sub: { fontSize: 14, marginBottom: 12, lineHeight: 20 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 16, gap: 12 },
  empty: { fontSize: 15, paddingVertical: 24, textAlign: 'center' },
  card: { borderRadius: 14, borderWidth: 1, padding: 12 },
  badge: { fontSize: 11, fontWeight: '800', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
  rowTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  btnOk: { backgroundColor: '#0d9488' },
  btnOkText: { color: '#ecfeff', fontWeight: '800', fontSize: 13 },
  btnGhost: { borderWidth: 1, backgroundColor: 'transparent' },
  btnGhostText: { fontWeight: '700', fontSize: 13 },
  btnDanger: { backgroundColor: 'rgba(220,38,38,0.15)' },
  btnDangerText: { color: '#fecaca', fontWeight: '800', fontSize: 13 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 8 },
  footerBtn: { paddingVertical: 12, paddingHorizontal: 8 },
  footerBtnText: { fontSize: 15, fontWeight: '700' },
  footerBtnPrimary: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  footerBtnPrimaryText: { fontSize: 15, fontWeight: '900' },
});
