import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Sparkles, X } from 'lucide-react-native';
import type { OneTapUniversalResult } from '../../types/oneTap';
import { buildTravelPrediction } from '../../services/travel/engine';
import type { EconomySnapshot } from '../../services/permissions/PermissionService';
import { consumeTrajetIfNeeded, getEconomySnapshot } from '../../services/permissions/PermissionService';
import { useTranslation } from '../../i18n';

type Props = {
  visible: boolean;
  refining: boolean;
  result: OneTapUniversalResult;
  transcript: string;
  busy?: boolean;
  counterLabel?: string | null;
  onChangeResult: (next: OneTapUniversalResult) => void;
  onUserEdited: () => void;
  onConfirm: () => void;
  onDismiss: () => void;
};

function clampText(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max);
}

function hmFromIsoOrHm(raw: string | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const hm = s.match(/\b(\d{2}):(\d{2})\b/);
  if (hm) return `${hm[1]}:${hm[2]}`;
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  const h = String(dt.getHours()).padStart(2, '0');
  const m = String(dt.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function buildDepartureSummary(params: { nowMs: number; result: OneTapUniversalResult }): string | null {
  const d = params.result.data;
  const ymd = typeof d.dueDateYmd === 'string' ? d.dueDateYmd.trim() : '';
  const hm = typeof d.dueTimeHm === 'string' ? d.dueTimeHm.trim() : '';
  const hasArrival = Boolean(ymd && hm);
  const dest =
    typeof d.destinationName === 'string'
      ? d.destinationName.trim()
      : typeof d.locationLabel === 'string'
        ? d.locationLabel.trim()
        : '';
  if (!hasArrival || !dest) return null;
  const arrivalAtMs = new Date(`${ymd}T${hm}:00`).getTime();
  if (!Number.isFinite(arrivalAtMs)) return null;
  const p = buildTravelPrediction({
    ctx: { nowMs: params.nowMs, transcript: params.result.title, destinationLabel: dest, arrivalAtMs },
    bucket: null,
    overrideBaseDurationMin: undefined,
    overrideTrafficMultiplier: undefined,
  });
  if (p.criticalDepartAtMs === null) return null;
  const dt = new Date(p.criticalDepartAtMs);
  if (Number.isNaN(dt.getTime())) return null;
  const h = String(dt.getHours()).padStart(2, '0');
  const m = String(dt.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

const AView = Animated.createAnimatedComponent(View);

export function SasModal({
  visible,
  refining,
  result,
  transcript,
  busy = false,
  counterLabel = null,
  onChangeResult,
  onUserEdited,
  onConfirm,
  onDismiss,
}: Props) {
  const { t } = useTranslation();
  const [editTitle, setEditTitle] = useState(false);
  const destinationRef = useRef<TextInput | null>(null);
  const openT = useSharedValue(0);
  const titleOpacity = useSharedValue(1);
  const [economy, setEconomy] = useState<EconomySnapshot | null>(null);

  const smartScaling = result.data.smartScaling ?? null;

  const destValue = useMemo(() => {
    const d = result.data;
    const dest =
      typeof d.destinationName === 'string'
        ? d.destinationName.trim()
        : typeof d.locationLabel === 'string'
          ? d.locationLabel.trim()
          : '';
    return dest;
  }, [result.data]);

  const hasLogistics = Boolean(result.data.logistics?.hasLogistics ?? result.data.hasLogistics);
  const isLocationIncomplete = Boolean(result.data.logistics?.isLocationIncomplete ?? result.data.isLocationIncomplete);
  const trajetBalance = economy?.trajetCreditBalance ?? 0;
  const hasTrajetUnlimited = economy?.hasTrajetUnlimited ?? false;
  const trafficDisabled = busy || (!hasTrajetUnlimited && trajetBalance <= 0);

  const summary = useMemo(() => {
    const fromTravel = buildDepartureSummary({ nowMs: Date.now(), result });
    if (fromTravel) return t('SAS_SUMMARY_DEPART_RECOMMENDED', { time: fromTravel });
    const hm =
      hmFromIsoOrHm(
        typeof result.data.dueTimeHm === 'string' ? result.data.dueTimeHm : undefined,
      ) ?? hmFromIsoOrHm(typeof result.data.preferredTimeHm === 'string' ? result.data.preferredTimeHm : undefined);
    if (hm) return t('SAS_SUMMARY_SCHEDULED', { time: hm });
    if (result.data.destinationName && String(result.data.destinationName).trim()) {
      return t('SAS_SUMMARY_DESTINATION', {
        destination: String(result.data.destinationName).trim().slice(0, 60),
      });
    }
    return null;
  }, [result, t]);

  const listValue = useMemo(() => {
    if (result.predictedType !== 'LIST') return '';
    return (result.data.listItems ?? []).join('\n');
  }, [result.data.listItems, result.predictedType]);

  const scaledListValue = useMemo(() => {
    if (!smartScaling) return '';
    const pivot = Math.max(1, Math.floor(smartScaling.pivotValue || 1));
    return smartScaling.items
      .map((it) => {
        const base = typeof it.qty === 'number' && Number.isFinite(it.qty) ? it.qty : 1;
        const qty = it.isScalable ? base * pivot : base;
        const n = Number.isInteger(qty) ? String(qty) : String(Math.round(qty * 100) / 100);
        return `${n} × ${String(it.t || '').trim()}`;
      })
      .filter(Boolean)
      .join('\n');
  }, [smartScaling]);

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
    titleOpacity.value = 0;
    titleOpacity.value = withTiming(1, { duration: 220 });
  }, [result.title, titleOpacity, visible]);

  useEffect(() => {
    if (!visible) return;
    if (!hasLogistics || !isLocationIncomplete) return;
    const t = setTimeout(() => {
      destinationRef.current?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [hasLogistics, isLocationIncomplete, visible]);

  useEffect(() => {
    if (!visible) return;
    if (!hasLogistics) {
      setEconomy(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const snap = await getEconomySnapshot();
      if (cancelled) return;
      setEconomy(snap);
    })();
    return () => {
      cancelled = true;
    };
  }, [hasLogistics, visible]);

  const cardStyle = useAnimatedStyle(() => {
    const t = openT.value;
    const y = (1 - t) * 18;
    const s = 0.985 + 0.015 * t;
    return {
      opacity: t,
      transform: [{ translateY: y }, { scale: s }],
    };
  });

  const titleFadeStyle = useAnimatedStyle(() => ({ opacity: titleOpacity.value }));

  const onPressConfirm = async () => {
    if (busy) return;
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      return;
    } finally {
      onConfirm();
    }
  };

  const typeLabel = useMemo(() => {
    const k = result.predictedType;
    if (k === 'TASK') return t('TYPE_TASK');
    if (k === 'HABIT') return t('TYPE_HABIT');
    if (k === 'RECURRING_TASK') return t('TYPE_RECURRING_TASK');
    if (k === 'LIST') return t('TYPE_LIST');
    if (k === 'ANNIVERSARY') return t('TYPE_ANNIVERSARY');
    return t('TYPE_NOTE');
  }, [result.predictedType, t]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <BlurView intensity={34} tint="dark" style={StyleSheet.absoluteFill} />
      </Pressable>
      <View style={styles.center} pointerEvents="box-none">
        <AView style={[styles.card, cardStyle]}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <View style={styles.pillRow}>
                <View style={styles.kindPill}>
                  <Text style={styles.kindText}>{typeLabel}</Text>
                </View>
                {counterLabel ? (
                  <View style={styles.counterPill}>
                    <Text style={styles.counterText}>{counterLabel}</Text>
                  </View>
                ) : null}
                {refining ? (
                  <View style={styles.refiningPill}>
                    <Sparkles size={14} color="#0f172a" />
                    <Text style={styles.refiningText}>{t('MODAL_REFINING')}</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <Pressable style={styles.closeBtn} onPress={onDismiss} disabled={busy}>
              <X size={18} color="#0f172a" />
            </Pressable>
          </View>

          <AView style={titleFadeStyle}>
            {editTitle ? (
              <TextInput
                value={result.title}
                onChangeText={(t) => {
                  onUserEdited();
                  onChangeResult({ ...result, title: clampText(t, 200) || result.title });
                }}
                onBlur={() => setEditTitle(false)}
                autoFocus
                editable={!busy}
                placeholder={transcript.trim() ? transcript.trim().slice(0, 80) : t('PLACEHOLDER_TITLE')}
                placeholderTextColor="rgba(100,116,139,0.72)"
                style={styles.titleInput}
              />
            ) : (
              <Pressable
                onPress={() => {
                  if (busy) return;
                  setEditTitle(true);
                }}
              >
                <Text style={styles.titleText}>{result.title.trim() || t('DEFAULT_INTENTION_TITLE')}</Text>
              </Pressable>
            )}
          </AView>

          {summary ? <Text style={styles.summaryText}>{summary}</Text> : null}

          {result.predictedType === 'LIST' ? (
            smartScaling ? (
              <View style={styles.scalingBlock}>
                <View style={styles.scalingRow}>
                  <Pressable
                    style={styles.scalingBtn}
                    onPress={() => {
                      if (busy) return;
                      onUserEdited();
                      const next = Math.max(1, Math.floor((smartScaling.pivotValue || 1) - 1));
                      onChangeResult({
                        ...result,
                        data: { ...result.data, smartScaling: { ...smartScaling, pivotValue: next } },
                      });
                    }}
                    disabled={busy}
                  >
                    <Text style={styles.scalingBtnText}>{t('COMMON_MINUS')}</Text>
                  </Pressable>
                  <Text style={styles.scalingValue}>
                    {Math.max(1, Math.floor(smartScaling.pivotValue || 1))} {smartScaling.unitLabel}
                  </Text>
                  <Pressable
                    style={styles.scalingBtn}
                    onPress={() => {
                      if (busy) return;
                      onUserEdited();
                      const next = Math.min(60, Math.floor((smartScaling.pivotValue || 1) + 1));
                      onChangeResult({
                        ...result,
                        data: { ...result.data, smartScaling: { ...smartScaling, pivotValue: next } },
                      });
                    }}
                    disabled={busy}
                  >
                    <Text style={styles.scalingBtnText}>{t('COMMON_PLUS')}</Text>
                  </Pressable>
                </View>
                <TextInput
                  multiline
                  value={scaledListValue}
                  editable={false}
                  placeholder={t('PLACEHOLDER_LIST')}
                  placeholderTextColor="rgba(100,116,139,0.72)"
                  style={styles.listInput}
                />
              </View>
            ) : (
              <TextInput
                multiline
                value={listValue}
                onChangeText={(t) => {
                  if (busy) return;
                  onUserEdited();
                  const items = t
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .slice(0, 40);
                  onChangeResult({ ...result, data: { ...result.data, listItems: items } });
                }}
                editable={!busy}
                placeholder={t('PLACEHOLDER_LIST')}
                placeholderTextColor="rgba(100,116,139,0.72)"
                style={styles.listInput}
              />
            )
          ) : null}

          {hasLogistics ? (
            <View style={styles.logisticsBlock}>
              <Pressable
                style={[styles.trafficRow, trafficDisabled ? styles.trafficRowDisabled : null]}
                onPress={() => {
                  void (async () => {
                    if (trafficDisabled) return;
                    const next = !Boolean(result.data.adjustForTraffic);
                    onUserEdited();
                    if (next && !hasTrajetUnlimited) {
                      const nextEco = await consumeTrajetIfNeeded({ enableTrafficAdjustment: true });
                      setEconomy(nextEco);
                      if (nextEco.trajetCreditBalance < trajetBalance) {
                        onChangeResult({ ...result, data: { ...result.data, adjustForTraffic: true } });
                      }
                      return;
                    }
                    onChangeResult({ ...result, data: { ...result.data, adjustForTraffic: next } });
                  })();
                }}
                disabled={trafficDisabled}
              >
                <Text style={styles.trafficLabel}>{t('LOGISTICS_TRAFFIC_ADJUST')}</Text>
                <Text style={styles.trafficValue}>
                  {trafficDisabled && !hasTrajetUnlimited && trajetBalance <= 0
                    ? t('LOGISTICS_BUY_TRAJET_PACK')
                    : `${result.data.adjustForTraffic ? t('COMMON_YES') : t('COMMON_NO')}${
                        !hasTrajetUnlimited && trajetBalance > 0
                          ? ` ${t('LOGISTICS_TRAJET_REMAINING_SUFFIX', { n: trajetBalance })}`
                          : ''
                      }`}
                </Text>
              </Pressable>
              <TextInput
                ref={(r) => {
                  destinationRef.current = r;
                }}
                value={destValue}
                onChangeText={(v) => {
                  if (busy) return;
                  onUserEdited();
                  const next = clampText(v, 160);
                  onChangeResult({
                    ...result,
                    data: {
                      ...result.data,
                      destinationName: next || undefined,
                      locationLabel: next || undefined,
                      logistics: {
                        hasLogistics: true,
                        destination: next ? next : null,
                        isLocationIncomplete: next ? false : true,
                      },
                      hasLogistics: true,
                      isLocationIncomplete: next ? false : true,
                    },
                  });
                }}
                placeholder={t('PLACEHOLDER_DESTINATION')}
                placeholderTextColor="rgba(100,116,139,0.72)"
                editable={!busy}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                style={[styles.destinationInput, isLocationIncomplete ? styles.destinationInputWarn : null]}
              />
            </View>
          ) : null}

          <View style={styles.actionsRow}>
            <Pressable style={styles.cancelSurface} onPress={onDismiss} disabled={busy}>
              <Text style={styles.cancelText}>{t('COMMON_CANCEL')}</Text>
            </Pressable>
            <Pressable
              style={[styles.okSurface, busy ? styles.okSurfaceBusy : null]}
              onPress={() => void onPressConfirm()}
              disabled={busy}
            >
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
  headerLeft: { flex: 1 },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kindPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(226,232,240,0.65)',
  },
  kindText: { fontSize: 12, fontWeight: '800', color: '#0f172a', letterSpacing: 0.2 },
  counterPill: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(226,232,240,0.65)',
  },
  counterText: { fontSize: 12, fontWeight: '900', color: '#0f172a', letterSpacing: 0.2 },
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
  logisticsBlock: { gap: 10, paddingTop: 4 },
  trafficRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(241,245,249,0.88)',
  },
  trafficLabel: { color: '#0f172a', fontSize: 13, fontWeight: '800' },
  trafficValue: { color: '#334155', fontSize: 13, fontWeight: '900' },
  trafficRowDisabled: { opacity: 0.55 },
  destinationInput: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(241,245,249,0.88)',
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '800',
  },
  destinationInputWarn: { borderWidth: 2, borderColor: 'rgba(239,68,68,0.55)' },
  listInput: {
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
  scalingBlock: { gap: 10 },
  scalingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  scalingBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: 'rgba(226,232,240,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scalingBtnText: { fontSize: 20, fontWeight: '900', color: '#0f172a' },
  scalingValue: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '900', color: '#0f172a' },
});
