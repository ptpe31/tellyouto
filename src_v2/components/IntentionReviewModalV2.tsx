import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Sparkles, X } from 'lucide-react-native';
import type { OneTapPredictedType, OneTapUniversalResult } from '../types/oneTap';
import { useTranslation } from '../i18n';

type Props = {
  visible: boolean;
  refining: boolean;
  busy?: boolean;
  result: OneTapUniversalResult;
  transcript: string;
  onChangeResult: (next: OneTapUniversalResult) => void;
  onUserEdited: () => void;
  onConfirm: () => void;
  onDismiss: () => void;
};

function clamp(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max);
}

function bodyForResult(r: OneTapUniversalResult): string {
  if (r.predictedType === 'LIST') return (r.data.listItems ?? []).join('\n');
  if (r.predictedType === 'ANNIVERSARY') return r.data.personName ?? '';
  if (r.predictedType === 'TASK') return r.data.notes ?? '';
  if (r.predictedType === 'HABIT' || r.predictedType === 'RECURRING_TASK') return r.data.notes ?? '';
  return r.data.memo ?? '';
}

function applyBodyEdit(r: OneTapUniversalResult, next: string): OneTapUniversalResult {
  const trimmed = next.trim();
  if (r.predictedType === 'LIST') {
    const items = trimmed
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 40);
    return { ...r, data: { ...r.data, listItems: items } };
  }
  if (r.predictedType === 'ANNIVERSARY') {
    return { ...r, data: { ...r.data, personName: clamp(trimmed, 120) } };
  }
  if (r.predictedType === 'TASK' || r.predictedType === 'HABIT' || r.predictedType === 'RECURRING_TASK') {
    return { ...r, data: { ...r.data, notes: trimmed.slice(0, 2000) } };
  }
  return { ...r, data: { ...r.data, memo: trimmed.slice(0, 4000) } };
}

function labelForType(t: OneTapPredictedType): string {
  if (t === 'TASK') return 'TYPE_TASK';
  if (t === 'HABIT') return 'TYPE_HABIT';
  if (t === 'RECURRING_TASK') return 'TYPE_RECURRING_TASK';
  if (t === 'LIST') return 'TYPE_LIST';
  if (t === 'ANNIVERSARY') return 'TYPE_ANNIVERSARY';
  return 'TYPE_NOTE';
}

export function IntentionReviewModalV2({
  visible,
  refining,
  busy = false,
  result,
  transcript,
  onChangeResult,
  onUserEdited,
  onConfirm,
  onDismiss,
}: Props) {
  const { t } = useTranslation();
  const pulse = useRef(new Animated.Value(0)).current;

  const categoryDisplay = useMemo(() => {
    const raw = String(result.categoryTag || '').trim();
    const norm = raw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (norm === 'courses') return t('CATEGORY_COURSES');
    if (norm === 'famille') return t('CATEGORY_FAMILLE');
    if (norm === 'sante') return t('CATEGORY_SANTE');
    if (norm === 'travail') return t('CATEGORY_TRAVAIL');
    if (norm === 'sport') return t('CATEGORY_SPORT');
    if (norm === 'social') return t('CATEGORY_SOCIAL');
    if (norm === 'finance') return t('CATEGORY_FINANCE');
    if (norm === 'legal') return t('CATEGORY_LEGAL');
    if (norm === 'appel') return t('CATEGORY_APPEL');
    if (norm === 'logistique') return t('CATEGORY_LOGISTIQUE');
    return raw;
  }, [result.categoryTag, t]);

  useEffect(() => {
    if (!visible || !refining) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 720, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 720, useNativeDriver: true }),
      ]),
    );
    a.start();
    return () => {
      a.stop();
    };
  }, [pulse, refining, visible]);

  const body = useMemo(() => bodyForResult(result), [result]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <BlurView intensity={26} tint="dark" style={StyleSheet.absoluteFill} />
      </Pressable>
      <View style={styles.center}>
        <View style={styles.sheet}>
          <View style={styles.headRow}>
            <View style={styles.headLeft}>
              <Text style={styles.eyebrow}>{t(labelForType(result.predictedType))}</Text>
              <TextInput
                value={result.title}
                onChangeText={(t) => {
                  onUserEdited();
                  onChangeResult({ ...result, title: clamp(t, 200) || result.title });
                }}
                placeholder={t('PLACEHOLDER_TITLE')}
                placeholderTextColor="#94a3b8"
                style={styles.titleInput}
                editable={!busy}
              />
            </View>
            <Pressable style={styles.closeBtn} onPress={onDismiss}>
              <X size={18} color="#334155" />
            </Pressable>
          </View>

          <View style={styles.metaRow}>
            <TextInput
              value={categoryDisplay}
              onChangeText={(k) => {
                onUserEdited();
                onChangeResult({ ...result, categoryTag: clamp(k, 80) || result.categoryTag });
              }}
              placeholder={t('PLACEHOLDER_CATEGORY')}
              placeholderTextColor="#94a3b8"
              style={styles.pillInput}
              editable={!busy}
            />
            {refining ? (
              <Animated.View
                style={[
                  styles.refiningPill,
                  {
                    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.92] }),
                    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }],
                  },
                ]}
              >
                <Sparkles size={14} color="#0f172a" />
                <Text style={styles.refiningText}>{t('MODAL_REFINING')}</Text>
              </Animated.View>
            ) : null}
          </View>

          <ScrollView contentContainerStyle={styles.bodyScroll} showsVerticalScrollIndicator={false}>
            <TextInput
              multiline
              value={body}
              onChangeText={(t) => {
                onUserEdited();
                onChangeResult(applyBodyEdit(result, t));
              }}
              placeholder={transcript.trim() ? transcript : t('PLACEHOLDER_TEXT')}
              placeholderTextColor="#94a3b8"
              style={styles.bodyInput}
              editable={!busy}
            />
          </ScrollView>

          <View style={styles.actions}>
            <Pressable style={styles.cancelBtn} onPress={onDismiss}>
              <Text style={styles.cancelText}>{t('COMMON_CANCEL')}</Text>
            </Pressable>
            <Pressable style={[styles.confirmBtn, busy ? styles.confirmBtnBusy : null]} onPress={onConfirm} disabled={busy}>
              <Text style={styles.confirmText}>{t('COMMON_SAVE')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.35)' },
  center: { flex: 1, justifyContent: 'center', padding: 16 },
  sheet: {
    borderRadius: 22,
    backgroundColor: 'rgba(248,250,252,0.92)',
    padding: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
    maxHeight: '84%',
  },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  headLeft: { flex: 1, gap: 6 },
  eyebrow: { fontSize: 12, fontWeight: '700', color: '#64748b', letterSpacing: 0.4 },
  titleInput: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: 'rgba(226,232,240,0.55)',
    borderRadius: 14,
  },
  closeBtn: { width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(226,232,240,0.55)', alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pillInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(226,232,240,0.55)',
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  refiningPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(203,213,225,0.7)',
  },
  refiningText: { fontSize: 12, fontWeight: '800', color: '#0f172a' },
  bodyScroll: { paddingBottom: 6 },
  bodyInput: {
    minHeight: 180,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: 'rgba(241,245,249,0.9)',
    fontSize: 14,
    lineHeight: 20,
    color: '#0f172a',
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(226,232,240,0.65)',
  },
  cancelText: { color: '#334155', fontWeight: '800' },
  confirmBtn: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  confirmBtnBusy: { opacity: 0.55 },
  confirmText: { color: '#f8fafc', fontWeight: '800' },
});
