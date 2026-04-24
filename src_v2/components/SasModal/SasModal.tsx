import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Sparkles, X } from 'lucide-react-native';
import type { OneTapPredictedType, OneTapUniversalResult } from '../../../src/services/oneTapUniversalCapture';
import { useTranslation } from '../../i18n';

type Props = {
  visible: boolean;
  refining: boolean;
  result: OneTapUniversalResult;
  transcript: string;
  busy?: boolean;
  onChangeResult: (next: OneTapUniversalResult) => void;
  onUserEdited: () => void;
  onConfirm: () => void;
  onDismiss: () => void;
};

const AView = Animated.createAnimatedComponent(View);

function str(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return v === null || v === undefined ? '' : String(v);
}

function setKey(result: OneTapUniversalResult, key: string, value: unknown): OneTapUniversalResult {
  return { ...result, data: { ...(result.data as Record<string, unknown>), [key]: value } };
}

function typeLabel(t: (k: string, o?: Record<string, string | number>) => string, type: OneTapPredictedType): string {
  if (type === 'TASK') return t('TYPE_TASK');
  if (type === 'HABIT') return t('TYPE_HABIT');
  if (type === 'RECURRING_TASK') return t('TYPE_RECURRING_TASK');
  if (type === 'LIST') return t('TYPE_LIST');
  if (type === 'ANNIVERSARY') return t('TYPE_ANNIVERSARY');
  return t('TYPE_NOTE');
}

function listLinesFromDraft(draft: OneTapUniversalResult): string {
  const data = draft.data as Record<string, unknown>;
  const list = data.list && typeof data.list === 'object' ? (data.list as Record<string, unknown>) : null;
  const cats = list && Array.isArray(list.categories) ? (list.categories as unknown[]) : [];
  const items: string[] = [];
  cats.forEach((c) => {
    if (!c || typeof c !== 'object') return;
    const cat = c as Record<string, unknown>;
    const its = Array.isArray(cat.items) ? (cat.items as unknown[]) : [];
    its.forEach((it) => {
      if (!it || typeof it !== 'object') return;
      const name = String((it as Record<string, unknown>).name || '').trim();
      if (name) items.push(name);
    });
  });
  return items.join('\n');
}

function patchListFromLines(draft: OneTapUniversalResult, lines: string): OneTapUniversalResult {
  const items = lines
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60)
    .map((name) => ({ name, baseQuantity: 1, unit: 'piece', scalable: true }));
  const data = draft.data as Record<string, unknown>;
  const prevList = data.list && typeof data.list === 'object' ? (data.list as Record<string, unknown>) : {};
  const nextList = {
    title: String(prevList.title || '').trim(),
    baseCount: Number(prevList.baseCount || 1) || 1,
    unitLabel: String(prevList.unitLabel || 'personne'),
    categories: [{ name: String(((prevList.categories as unknown[])?.[0] as Record<string, unknown>)?.name || '—'), items }],
  };
  return { ...draft, data: { ...data, list: nextList } };
}

export function SasModal({
  visible,
  refining,
  result,
  transcript,
  busy = false,
  onChangeResult,
  onUserEdited,
  onConfirm,
  onDismiss,
}: Props) {
  const { t } = useTranslation();
  const openT = useSharedValue(0);
  const [editTitle, setEditTitle] = useState(false);
  const [listDraftText, setListDraftText] = useState('');

  useEffect(() => {
    if (!visible) {
      openT.value = 0;
      setEditTitle(false);
      return;
    }
    openT.value = withSpring(1, { damping: 20, stiffness: 220, mass: 0.9 });
  }, [openT, visible]);

  useEffect(() => {
    if (!visible) return;
    if (result.predictedType !== 'LIST') return;
    setListDraftText(listLinesFromDraft(result));
  }, [result, visible]);

  const cardStyle = useAnimatedStyle(() => {
    const t = openT.value;
    const y = (1 - t) * 18;
    const s = 0.985 + 0.015 * t;
    return { opacity: t, transform: [{ translateY: y }, { scale: s }] };
  });

  const summary = useMemo(() => {
    const data = result.data as Record<string, unknown>;
    const due = String(data.dueDateYmd || '').trim();
    const hm = String(data.dueTimeHm || data.preferredTimeHm || '').trim();
    const dest = String(data.destination_name || data.location_address || '').trim();
    const parts = [due && hm ? `${due} ${hm}` : due || hm || '', dest].filter(Boolean);
    return parts.length ? parts.join(' · ').slice(0, 140) : null;
  }, [result]);

  const onPressConfirm = async () => {
    if (busy) return;
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      /* ignore */
    }
    onConfirm();
  };

  const kind = result.predictedType;
  const data = result.data as Record<string, unknown>;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <BlurView intensity={34} tint="dark" style={StyleSheet.absoluteFill} />
      </Pressable>
      <View style={styles.center} pointerEvents="box-none">
        <AView style={[styles.card, cardStyle]}>
          <View style={styles.headerRow}>
            <View style={styles.pillRow}>
              <View style={styles.kindPill}>
                <Text style={styles.kindText}>{typeLabel(t, kind)}</Text>
              </View>
              {refining ? (
                <View style={styles.refiningPill}>
                  <Sparkles size={14} color="#0f172a" />
                  <Text style={styles.refiningText}>{t('MODAL_REFINING')}</Text>
                </View>
              ) : null}
            </View>
            <Pressable style={styles.closeBtn} onPress={onDismiss} disabled={busy}>
              <X size={18} color="#0f172a" />
            </Pressable>
          </View>

          {editTitle ? (
            <TextInput
              value={result.title}
              onChangeText={(v) => {
                onUserEdited();
                onChangeResult({ ...result, title: v.slice(0, 200) });
              }}
              onBlur={() => setEditTitle(false)}
              autoFocus
              editable={!busy}
              placeholder={transcript.trim().slice(0, 80) || t('PLACEHOLDER_TITLE')}
              placeholderTextColor="rgba(100,116,139,0.72)"
              style={styles.titleInput}
            />
          ) : (
            <Pressable onPress={() => !busy && setEditTitle(true)}>
              <Text style={styles.titleText}>{result.title.trim() || t('DEFAULT_INTENTION_TITLE')}</Text>
            </Pressable>
          )}

          {summary ? <Text style={styles.summaryText}>{summary}</Text> : null}

          {kind === 'NOTE' ? (
            <TextInput
              multiline
              value={str(data, 'memo')}
              onChangeText={(v) => {
                onUserEdited();
                onChangeResult(setKey(result, 'memo', v.slice(0, 4000)));
              }}
              editable={!busy}
              placeholder={t('PLACEHOLDER_NOTE')}
              placeholderTextColor="rgba(100,116,139,0.72)"
              style={styles.blockInput}
            />
          ) : null}

          {kind === 'TASK' || kind === 'RECURRING_TASK' ? (
            <View style={styles.block}>
              <TextInput
                value={str(data, 'dueDateYmd')}
                onChangeText={(v) => {
                  onUserEdited();
                  onChangeResult(setKey(result, 'dueDateYmd', v.slice(0, 20)));
                }}
                editable={!busy}
                placeholder={t('PLACEHOLDER_DATE')}
                placeholderTextColor="rgba(100,116,139,0.72)"
                style={styles.smallInput}
              />
              <TextInput
                value={str(data, 'dueTimeHm')}
                onChangeText={(v) => {
                  onUserEdited();
                  onChangeResult(setKey(result, 'dueTimeHm', v.slice(0, 10)));
                }}
                editable={!busy}
                placeholder={t('PLACEHOLDER_TIME')}
                placeholderTextColor="rgba(100,116,139,0.72)"
                style={styles.smallInput}
              />
              <TextInput
                multiline
                value={str(data, 'notes')}
                onChangeText={(v) => {
                  onUserEdited();
                  onChangeResult(setKey(result, 'notes', v.slice(0, 2000)));
                }}
                editable={!busy}
                placeholder={t('PLACEHOLDER_NOTES')}
                placeholderTextColor="rgba(100,116,139,0.72)"
                style={styles.blockInput}
              />
              <TextInput
                value={str(data, 'destination_name')}
                onChangeText={(v) => {
                  onUserEdited();
                  onChangeResult(setKey(result, 'destination_name', v.slice(0, 200)));
                }}
                editable={!busy}
                placeholder={t('PLACEHOLDER_DESTINATION')}
                placeholderTextColor="rgba(100,116,139,0.72)"
                style={styles.smallInput}
              />
              <TextInput
                value={str(data, 'location_address')}
                onChangeText={(v) => {
                  onUserEdited();
                  onChangeResult(setKey(result, 'location_address', v.slice(0, 400)));
                }}
                editable={!busy}
                placeholder={t('PLACEHOLDER_ADDRESS')}
                placeholderTextColor="rgba(100,116,139,0.72)"
                style={styles.smallInput}
              />
            </View>
          ) : null}

          {kind === 'HABIT' ? (
            <View style={styles.block}>
              <TextInput
                value={str(data, 'preferredTimeHm')}
                onChangeText={(v) => {
                  onUserEdited();
                  onChangeResult(setKey(result, 'preferredTimeHm', v.slice(0, 10)));
                }}
                editable={!busy}
                placeholder={t('PLACEHOLDER_TIME')}
                placeholderTextColor="rgba(100,116,139,0.72)"
                style={styles.smallInput}
              />
              <TextInput
                multiline
                value={str(data, 'notes')}
                onChangeText={(v) => {
                  onUserEdited();
                  onChangeResult(setKey(result, 'notes', v.slice(0, 2000)));
                }}
                editable={!busy}
                placeholder={t('PLACEHOLDER_NOTES')}
                placeholderTextColor="rgba(100,116,139,0.72)"
                style={styles.blockInput}
              />
              <TextInput
                value={str(data, 'destination_name')}
                onChangeText={(v) => {
                  onUserEdited();
                  onChangeResult(setKey(result, 'destination_name', v.slice(0, 200)));
                }}
                editable={!busy}
                placeholder={t('PLACEHOLDER_DESTINATION')}
                placeholderTextColor="rgba(100,116,139,0.72)"
                style={styles.smallInput}
              />
              <TextInput
                value={str(data, 'location_address')}
                onChangeText={(v) => {
                  onUserEdited();
                  onChangeResult(setKey(result, 'location_address', v.slice(0, 400)));
                }}
                editable={!busy}
                placeholder={t('PLACEHOLDER_ADDRESS')}
                placeholderTextColor="rgba(100,116,139,0.72)"
                style={styles.smallInput}
              />
            </View>
          ) : null}

          {kind === 'ANNIVERSARY' ? (
            <View style={styles.block}>
              <TextInput
                value={str(data, 'personName')}
                onChangeText={(v) => {
                  onUserEdited();
                  onChangeResult(setKey(result, 'personName', v.slice(0, 200)));
                }}
                editable={!busy}
                placeholder={t('PLACEHOLDER_PERSON')}
                placeholderTextColor="rgba(100,116,139,0.72)"
                style={styles.smallInput}
              />
              <TextInput
                value={str(data, 'monthDay')}
                onChangeText={(v) => {
                  onUserEdited();
                  onChangeResult(setKey(result, 'monthDay', v.slice(0, 32)));
                }}
                editable={!busy}
                placeholder={t('PLACEHOLDER_MONTHDAY')}
                placeholderTextColor="rgba(100,116,139,0.72)"
                style={styles.smallInput}
              />
            </View>
          ) : null}

          {kind === 'LIST' ? (
            <View style={styles.block}>
              <TextInput
                multiline
                value={listDraftText}
                onChangeText={(v) => {
                  setListDraftText(v);
                  onUserEdited();
                  onChangeResult(patchListFromLines(result, v));
                }}
                editable={!busy}
                placeholder={t('PLACEHOLDER_LIST')}
                placeholderTextColor="rgba(100,116,139,0.72)"
                style={styles.blockInput}
              />
            </View>
          ) : null}

          <View style={styles.actionsRow}>
            <Pressable style={styles.cancelSurface} onPress={onDismiss} disabled={busy}>
              <Text style={styles.cancelText}>{t('COMMON_CANCEL')}</Text>
            </Pressable>
            <Pressable style={[styles.okSurface, busy ? styles.okSurfaceBusy : null]} onPress={() => void onPressConfirm()} disabled={busy}>
              <Text style={styles.okText}>{t('MODAL_CONFIRM_OK')}</Text>
            </Pressable>
          </View>
        </AView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(2,6,23,0.30)' },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 16 },
  card: {
    borderRadius: 32,
    backgroundColor: 'rgba(248,250,252,0.90)',
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  kindPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(226,232,240,0.65)',
  },
  kindText: { fontSize: 12, fontWeight: '800', color: '#0f172a', letterSpacing: 0.2 },
  refiningPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(203,213,225,0.70)',
  },
  refiningText: { fontSize: 12, fontWeight: '800', color: '#0f172a' },
  closeBtn: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: 'rgba(226,232,240,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleText: { fontSize: 22, fontWeight: '900', color: '#0f172a', lineHeight: 26 },
  titleInput: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0f172a',
    lineHeight: 26,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(241,245,249,0.88)',
  },
  summaryText: { color: '#334155', fontSize: 14, fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelSurface: {
    flex: 1,
    borderRadius: 22,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(226,232,240,0.65)',
  },
  cancelText: { color: '#334155', fontSize: 15, fontWeight: '900', letterSpacing: 0.2 },
  okSurface: {
    flex: 1,
    borderRadius: 22,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  okSurfaceBusy: { opacity: 0.55 },
  okText: { color: '#f8fafc', fontSize: 15, fontWeight: '900', letterSpacing: 0.2 },
  block: { gap: 10 },
  smallInput: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(241,245,249,0.88)',
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '800',
  },
  blockInput: {
    minHeight: 120,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: 'rgba(241,245,249,0.88)',
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
    textAlignVertical: 'top',
  },
});
