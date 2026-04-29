import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, Check, ClipboardList, MapPin, Repeat, StickyNote } from 'lucide-react-native';
import type { OneTapUniversalResult } from '../services/oneTapUniversalCapture';

export type OneTapBlueModalProps = {
  visible: boolean;
  draft: OneTapUniversalResult | null;
  transcript: string;
  onConfirm: () => void;
  onDismiss: () => void;
};

function cleanTranscriptForModal(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s
    .replace(/\.\.\.\s*Audio en cours de traitement\s*$/i, '')
    .replace(/⚠️\s*Audio enregistré\s*\(traitement ultérieur\)\s*$/i, '')
    .trim();
}

function readDraftIntents(draft: OneTapUniversalResult): Record<string, unknown>[] {
  const data = (draft.data ?? {}) as Record<string, unknown>;
  const raw = data.intents;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Record<string, unknown>[];
}

function intentTitle(it: Record<string, unknown>): string {
  const type = String(it.type ?? '').trim().toUpperCase();
  if (type === 'LIST') return String(it.title ?? it.content ?? '').trim();
  if (type === 'TRIP') return String(it.destination ?? it.content ?? it.title ?? '').trim();
  return String(it.content ?? it.title ?? '').trim();
}

function intentIncomplete(it: Record<string, unknown>): boolean {
  return it.incomplete === true;
}

function IntentIcon({ type }: { type: string }) {
  const t = String(type || '').trim().toUpperCase();
  const props = { size: 18, color: '#0B3D91' };
  if (t === 'TASK') return <Check {...props} />;
  if (t === 'LIST') return <ClipboardList {...props} />;
  if (t === 'TRIP') return <MapPin {...props} />;
  if (t === 'HABIT' || t === 'RECURRING_TASK') return <Repeat {...props} />;
  return <StickyNote {...props} />;
}

export function OneTapBlueModal({ visible, draft, transcript, onConfirm, onDismiss }: OneTapBlueModalProps) {
  const cleanTranscript = useMemo(() => cleanTranscriptForModal(transcript), [transcript]);
  const intents = useMemo(() => (draft ? readDraftIntents(draft) : []), [draft]);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!visible) setIsExpanded(false);
  }, [visible]);

  const stats = useMemo(() => {
    const byType = (type: string) => intents.filter((it) => String(it.type ?? '').trim().toUpperCase() === type);
    const notes = [...byType('NOTE'), ...byType('LIST')];
    const tasks = byType('TASK');
    const habits = [...byType('HABIT'), ...byType('RECURRING_TASK')];
    const trips = byType('TRIP');
    const badge = (arr: Record<string, unknown>[]) => ({
      count: arr.length,
      hasIncomplete: arr.some(intentIncomplete),
    });
    const hasAnyIncomplete = intents.some(intentIncomplete);
    return {
      notes: badge(notes),
      tasks: badge(tasks),
      habits: badge(habits),
      trips: badge(trips),
      hasAnyIncomplete,
    };
  }, [intents]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Transcription</Text>
            {cleanTranscript ? <Text style={styles.transcript}>{cleanTranscript}</Text> : null}
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionTitle}>{isExpanded ? 'DÉTAILS' : 'RÉSUMÉ'}</Text>
            {!isExpanded ? (
              <View style={styles.badgeRow}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{`📝 Notes ${stats.notes.count}`}</Text>
                  {stats.notes.hasIncomplete ? <AlertTriangle size={14} color="#D97706" /> : null}
                </View>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{`✅ Tâches ${stats.tasks.count}`}</Text>
                  {stats.tasks.hasIncomplete ? <AlertTriangle size={14} color="#D97706" /> : null}
                </View>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{`🔄 Habitudes ${stats.habits.count}`}</Text>
                  {stats.habits.hasIncomplete ? <AlertTriangle size={14} color="#D97706" /> : null}
                </View>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{`🚗 Trajets ${stats.trips.count}`}</Text>
                  {stats.trips.hasIncomplete ? <AlertTriangle size={14} color="#D97706" /> : null}
                </View>
              </View>
            ) : (
              <>
                {intents.map((it, idx) => {
                  const type = String(it.type ?? '').trim().toUpperCase();
                  const title = intentTitle(it) || '—';
                  const warn = intentIncomplete(it);
                  return (
                    <Pressable key={`${type}-${title}-${idx}`} style={styles.card} onPress={() => setIsExpanded(true)}>
                      <View style={styles.cardIcon}>
                        <IntentIcon type={type} />
                      </View>
                      <View style={styles.cardText}>
                        <View style={styles.cardTopRow}>
                          <Text style={styles.cardType}>{type || '—'}</Text>
                          {warn ? <AlertTriangle size={14} color="#D97706" /> : null}
                        </View>
                        <Text style={styles.cardTitle} numberOfLines={2}>
                          {title}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
                {!intents.length ? <Text style={styles.empty}>Aucune intention détectée.</Text> : null}
              </>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={styles.cancelBtn} onPress={onDismiss}>
              <Text style={styles.cancelText}>Annuler</Text>
            </Pressable>
            {!isExpanded ? (
              <Pressable style={styles.detailsBtn} onPress={() => setIsExpanded(true)}>
                <Text style={styles.detailsText}>Détails</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.detailsBtn} onPress={() => setIsExpanded(false)}>
                <Text style={styles.detailsText}>Réduire</Text>
              </Pressable>
            )}
            <Pressable style={styles.confirmBtn} onPress={onConfirm}>
              <Text style={styles.confirmText}>Tout confirmer</Text>
            </Pressable>
          </View>
          {stats.hasAnyIncomplete ? (
            <View style={styles.incompleteBar}>
              <Text style={styles.incompleteText}>Éléments incomplets enregistrés en brouillon.</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', justifyContent: 'center', padding: 16 },
  container: {
    backgroundColor: '#E3F2FD',
    borderRadius: 18,
    overflow: 'hidden',
    maxHeight: '86%',
  },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  headerTitle: { fontSize: 13, fontWeight: '800', color: 'rgba(15,23,42,0.75)' },
  transcript: { marginTop: 8, fontSize: 14, fontWeight: '700', color: '#0F172A' },
  body: { paddingHorizontal: 16 },
  bodyContent: { paddingBottom: 16 },
  sectionTitle: { marginTop: 6, marginBottom: 10, fontSize: 12, fontWeight: '900', letterSpacing: 0.4, color: '#0B3D91' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 10 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  badgeText: { fontSize: 13, fontWeight: '900', color: '#0F172A' },
  card: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  cardIcon: { width: 28, alignItems: 'center', paddingTop: 2 },
  cardText: { flex: 1 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardType: { fontSize: 11, fontWeight: '900', color: 'rgba(11,61,145,0.8)' },
  cardTitle: { marginTop: 2, fontSize: 15, fontWeight: '800', color: '#0F172A' },
  empty: { fontSize: 13, fontWeight: '700', color: 'rgba(15,23,42,0.55)' },
  footer: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(15,23,42,0.15)',
  },
  cancelBtn: { flex: 1, backgroundColor: 'rgba(220,38,38,0.10)', borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  cancelText: { fontSize: 13, fontWeight: '900', color: '#B91C1C' },
  detailsBtn: { flex: 1, backgroundColor: 'rgba(15,23,42,0.06)', borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  detailsText: { fontSize: 13, fontWeight: '900', color: 'rgba(15,23,42,0.75)' },
  confirmBtn: { flex: 2, backgroundColor: '#0A84FF', borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  confirmText: { fontSize: 13, fontWeight: '900', color: '#FFFFFF' },
  incompleteBar: { paddingHorizontal: 12, paddingBottom: 12 },
  incompleteText: { fontSize: 12, fontWeight: '800', color: 'rgba(217,119,6,0.95)' },
});
