import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Checkbox, Menu, Button as PaperButton } from 'react-native-paper';
import { Bell, ChevronDown } from 'lucide-react-native';

import { TimelineDatePickerLazy } from './TimelineDatePickerLazy';
import { GooglePlacesAutocompleteField } from './traffic/GooglePlacesAutocompleteField';
import { fetchLatestOneTapLogisticsMemory } from '../api/trankilV2Db';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import type { OneTapPredictedType, OneTapUniversalResult } from '../services/oneTapUniversalCapture';
import {
  ONE_TAP_PREDICTED_TYPES,
  logOneTapLogisticsRecognized,
  mergeOneTapDataOnTypeChange,
} from '../services/oneTapUniversalCapture';
import { printOneTapListDraft } from '../services/oneTapListPdf';
import { listItemDisplayQuantity } from '../utils/listQuantityDisplay';
import { ensureSentinelQuotaInitialized, getSentinelQuotaSnapshotLocalOnly } from '../services/QuotaManager';

export type OneTapConfirmModalProps = {
  visible: boolean;
  draft: OneTapUniversalResult | null;
  transcript: string;
  /** Affinage Gemini en arrière-plan (dual-path). */
  refinePhase?: 'idle' | 'local' | 'streaming' | 'done' | 'error';
  busy: boolean;
  onChangeDraft: (next: OneTapUniversalResult) => void;
  onChangeTranscript: (text: string) => void;
  onConfirm: () => void;
  onDismiss: () => void;
};

function StreamingIndicator() {
  const dot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(dot, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => {
      anim.stop();
    };
  }, [dot]);
  const d1 = dot.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });
  const d2 = dot.interpolate({ inputRange: [0, 0.33, 1], outputRange: [0.2, 1, 0.2] });
  const d3 = dot.interpolate({ inputRange: [0, 0.66, 1], outputRange: [0.2, 1, 0.2] });
  return (
    <View style={styles.streamingRow}>
      <Animated.Text style={[styles.streamingDot, { opacity: d1 }]}>•</Animated.Text>
      <Animated.Text style={[styles.streamingDot, { opacity: d2 }]}>•</Animated.Text>
      <Animated.Text style={[styles.streamingDot, { opacity: d3 }]}>•</Animated.Text>
    </View>
  );
}

function readDraftIntents(draft: OneTapUniversalResult): Record<string, unknown>[] {
  const data = draft.data as Record<string, unknown>;
  const raw = data.intents;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Record<string, unknown>[];
}

function hasStreamedIntents(draft: OneTapUniversalResult): boolean {
  return readDraftIntents(draft).length > 0;
}

function deriveFallbackIntentFromDraft(draft: OneTapUniversalResult): Record<string, unknown>[] {
  const data = draft.data as Record<string, unknown>;
  const type = String(draft.predictedType || '').trim().toUpperCase();
  if (!type) return [];
  if (type === 'LIST') {
    const list = (data.list as Record<string, unknown> | null) ?? null;
    const title = String(list?.title ?? draft.title ?? 'Liste');
    const baseCount = Number(list?.baseCount ?? 1);
    const unitLabel = String(list?.unitLabel ?? 'personne');
    const cats = Array.isArray(list?.categories) ? (list?.categories as unknown[]) : [];
    const firstCat = (cats[0] as Record<string, unknown>) ?? {};
    const items = Array.isArray(firstCat.items) ? firstCat.items : [];
    return [
      {
        type: 'LIST',
        title,
        baseCount: Number.isFinite(baseCount) && baseCount > 0 ? baseCount : 1,
        unitLabel,
        items,
      },
    ];
  }
  if (type === 'TASK') {
    const due = String(data.dueDateTime ?? '');
    return [{ type: 'TASK', content: draft.title, due }];
  }
  if (type === 'HABIT') {
    const recurrence = String(data.cadenceDescription ?? data.recurrence ?? '');
    return [{ type: 'HABIT', content: draft.title, recurrence }];
  }
  if (type === 'TRIP') {
    const destination = String(data.destination_name ?? data.destination ?? draft.title ?? '');
    const arrivalDue = String(data.arrivalDue ?? data.dueDateTime ?? '');
    return [{ type: 'TRIP', destination, arrivalDue }];
  }
  const content = String(data.memo ?? draft.title ?? '');
  return [{ type: 'NOTE', content }];
}

function ymdFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateFromYmd(ymd: string | null | undefined): Date {
  if (ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date();
}

function strData(d: Record<string, unknown>, key: string): string {
  const v = d[key];
  if (v === null || v === undefined) return '';
  return String(v);
}

function setListBlock(draft: OneTapUniversalResult, list: Record<string, unknown>): OneTapUniversalResult {
  return { ...draft, data: { ...draft.data, list } };
}

function toggleListItemInclude(
  draft: OneTapUniversalResult,
  catIndex: number,
  itemIndex: number,
): OneTapUniversalResult {
  const list = { ...(draft.data.list as Record<string, unknown>) };
  const cats = [...(Array.isArray(list.categories) ? list.categories : [])];
  const cat = { ...(cats[catIndex] as Record<string, unknown>) };
  const items = [...(Array.isArray(cat.items) ? cat.items : [])];
  const item = { ...(items[itemIndex] as Record<string, unknown>) };
  const cur = item.includeInSave !== false;
  item.includeInSave = !cur;
  items[itemIndex] = item;
  cat.items = items;
  cats[catIndex] = cat;
  list.categories = cats;
  return setListBlock(draft, list);
}

function adjustListBaseCount(draft: OneTapUniversalResult, delta: number): OneTapUniversalResult {
  const list = { ...(draft.data.list as Record<string, unknown>) };
  const n = Math.max(1, Math.min(999, Math.round(Number(list.baseCount ?? 1)) + delta));
  list.baseCount = n;
  return setListBlock(draft, list);
}

function patchData(draft: OneTapUniversalResult, patch: Record<string, unknown>): OneTapUniversalResult {
  return { ...draft, data: { ...draft.data, ...patch } };
}

function readDueIso(data: Record<string, unknown>): string | null {
  const v = data.dueDateTime;
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function readRecObj(data: Record<string, unknown>): Record<string, unknown> | null {
  const r = data.recurrence;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  return r as Record<string, unknown>;
}

export function OneTapConfirmModal({
  visible,
  draft,
  transcript,
  refinePhase = 'done',
  busy,
  onChangeDraft,
  onChangeTranscript,
  onConfirm,
  onDismiss,
}: OneTapConfirmModalProps) {
  const { t, i18n } = useTranslation();
  const { spectrum } = useUserSpectrum();
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dateTarget, setDateTarget] = useState<'TASK_DUE' | 'RECUR_NEXT' | 'UNIVERSAL_REMINDER' | null>(null);
  const [sentinelQuotaBalance, setSentinelQuotaBalance] = useState<number | null>(null);
  const [displayedIntents, setDisplayedIntents] = useState<Record<string, unknown>[]>([]);

  const showRefiningBanner = refinePhase === 'streaming' || refinePhase === 'local';
  const isGenerating = refinePhase === 'streaming' || refinePhase === 'local';

  const typeLabels = useMemo(
    () =>
      ONE_TAP_PREDICTED_TYPES.reduce(
        (acc, k) => {
          acc[k] = t(`talkDebug.oneTapType.${k}`);
          return acc;
        },
        {} as Record<OneTapPredictedType, string>,
      ),
    [t],
  );

  const onPrintList = useCallback(async () => {
    if (!draft || draft.predictedType !== 'LIST') return;
    try {
      await printOneTapListDraft(draft);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const body =
        raw === 'PRINT_NATIVE_MODULE_MISSING'
          ? t('talkDebug.oneTapPrintNeedsNativeBuild')
          : raw;
      Alert.alert(t('talkDebug.oneTapPrintErrorTitle'), body);
    }
  }, [draft, t]);

  const hasUniversalReminder = useMemo(() => {
    if (!draft) return false;
    if (readDueIso(draft.data)) return true;
    return Boolean(readRecObj(draft.data));
  }, [draft]);

  useEffect(() => {
    if (!visible) return;
    if (!draft) return;
    if (draft.data.logisticsPotential !== true) return;
    void (async () => {
      await ensureSentinelQuotaInitialized();
      const snap = await getSentinelQuotaSnapshotLocalOnly();
      setSentinelQuotaBalance(snap.balance);
    })();
  }, [draft, visible]);

  if (!draft) return null;

  const patchDraftIntents = useCallback(
    (next: Record<string, unknown>[]) => {
      onChangeDraft({ ...draft, data: { ...draft.data, intents: next } });
    },
    [draft, onChangeDraft],
  );

  useEffect(() => {
    if (Platform.OS === 'android') {
      UIManager.setLayoutAnimationEnabledExperimental?.(true);
    }
  }, []);

  const didBootstrapIntentsRef = useRef(false);
  useEffect(() => {
    if (!visible) didBootstrapIntentsRef.current = false;
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const next = readDraftIntents(draft);
    if (!next.length && !displayedIntents.length && !didBootstrapIntentsRef.current) {
      const derived = deriveFallbackIntentFromDraft(draft);
      if (derived.length) {
        didBootstrapIntentsRef.current = true;
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setDisplayedIntents(derived);
        patchDraftIntents(derived);
        return;
      }
    }
    if (next.length > displayedIntents.length) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    if (JSON.stringify(next) !== JSON.stringify(displayedIntents)) {
      setDisplayedIntents(next);
    }
  }, [displayedIntents, draft, visible]);

  const removeIntentAt = (intentIndex: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const next = displayedIntents.filter((_, i) => i !== intentIndex);
    setDisplayedIntents(next);
    patchDraftIntents(next);
  };

  const toggleIntentListItemInclude = (intentIndex: number, itemIndex: number) => {
    const intents = [...displayedIntents];
    const intent = { ...(intents[intentIndex] as Record<string, unknown>) };
    const itemsRaw = intent.items;
    const items = Array.isArray(itemsRaw) ? [...itemsRaw] : [];
    const it = { ...((items[itemIndex] as Record<string, unknown>) ?? {}) };
    const cur = it.includeInSave !== false;
    it.includeInSave = !cur;
    items[itemIndex] = it;
    intent.items = items;
    intents[intentIndex] = intent;
    patchDraftIntents(intents);
  };

  const adjustIntentListBaseCount = (intentIndex: number, delta: number) => {
    const intents = [...displayedIntents];
    const intent = { ...(intents[intentIndex] as Record<string, unknown>) };
    const n = Math.max(1, Math.min(999, Math.round(Number(intent.baseCount ?? 1)) + delta));
    intent.baseCount = n;
    intents[intentIndex] = intent;
    patchDraftIntents(intents);
  };

  const setIntentListUnitLabel = (intentIndex: number, unitLabel: string) => {
    const intents = [...displayedIntents];
    const intent = { ...(intents[intentIndex] as Record<string, unknown>) };
    intent.unitLabel = unitLabel;
    intents[intentIndex] = intent;
    patchDraftIntents(intents);
  };

  const applyType = (next: OneTapPredictedType) => {
    if (next === draft.predictedType) {
      setMenuOpen(false);
      return;
    }
    setDateTarget(null);
    const nextData = mergeOneTapDataOnTypeChange(draft.predictedType, next, draft.data, draft.title);
    onChangeDraft({
      ...draft,
      predictedType: next,
      data: nextData,
    });
    setMenuOpen(false);
  };

  const onDatePicked = (event: { type?: string }, date?: Date) => {
    const target = dateTarget;
    if (Platform.OS === 'android') {
      setDateTarget(null);
    }
    if (Platform.OS === 'android' && event.type === 'dismissed') {
      return;
    }
    if (date) {
      const ymd = ymdFromDate(date);
      if (target === 'TASK_DUE') {
        onChangeDraft(patchData(draft, { dueDateYmd: ymd }));
      } else if (target === 'RECUR_NEXT') {
        onChangeDraft(patchData(draft, { nextDueYmd: ymd }));
      } else if (target === 'UNIVERSAL_REMINDER') {
        const d = new Date(date);
        d.setHours(9, 0, 0, 0);
        onChangeDraft(patchData(draft, { dueDateTime: d.toISOString() }));
      }
    }
    if (Platform.OS === 'ios') {
      setDateTarget(null);
    }
  };

  const renderUniversalReminderSection = () => {
    const iso = readDueIso(draft.data);
    const rec = readRecObj(draft.data);
    const showPicker = dateTarget === 'UNIVERSAL_REMINDER';
    let dueDisplay: string | null = null;
    if (iso) {
      try {
        const dt = new Date(iso);
        dueDisplay = Number.isNaN(dt.getTime()) ? iso : dt.toLocaleString(i18n.language);
      } catch {
        dueDisplay = iso;
      }
    }
    const recLine = rec
      ? [String(rec.summary ?? '').trim(), String(rec.frequency ?? '').trim()]
          .filter(Boolean)
          .join(' · ')
      : null;

    return (
      <View style={styles.reminderSection}>
        <View style={styles.reminderTitleRow}>
          <Bell size={18} color="#008080" />
          <Text style={styles.sectionTitle}>{t('talkDebug.oneTapUniversalReminderTitle')}</Text>
        </View>
        {hasUniversalReminder ? (
          <>
            {dueDisplay ? (
              <Text style={styles.reminderLine}>
                {t('talkDebug.oneTapUniversalDueLabel')}: {dueDisplay}
              </Text>
            ) : null}
            {recLine ? (
              <Text style={styles.reminderLine}>
                {t('talkDebug.oneTapUniversalRecLabel')}: {recLine}
              </Text>
            ) : null}
            <Pressable
              style={[styles.linkish, busy && styles.disabled]}
              disabled={busy}
              onPress={() => onChangeDraft(patchData(draft, { dueDateTime: null, recurrence: null }))}
            >
              <Text style={styles.linkishText}>{t('talkDebug.oneTapClearUniversalReminder')}</Text>
            </Pressable>
          </>
        ) : Platform.OS === 'web' ? (
          <>
            <Text style={styles.label}>{t('talkDebug.oneTapWebDueDateTimeIso')}</Text>
            <TextInput
              value={iso ?? ''}
              onChangeText={(text) =>
                onChangeDraft(
                  patchData(draft, {
                    dueDateTime: text.trim() === '' ? null : text.trim(),
                  }),
                )
              }
              style={styles.input}
              editable={!busy}
              placeholder="2026-04-20T09:00:00.000Z"
            />
          </>
        ) : (
          <Pressable
            style={[styles.addReminderBtn, busy && styles.disabled]}
            disabled={busy}
            onPress={() => setDateTarget('UNIVERSAL_REMINDER')}
          >
            <Text style={styles.addReminderBtnText}>{t('talkDebug.oneTapAddReminderCta')}</Text>
          </Pressable>
        )}
        {showPicker && Platform.OS !== 'web' ? (
          <TimelineDatePickerLazy
            value={iso ? new Date(iso) : new Date()}
            mode="date"
            display="default"
            onChange={onDatePicked}
          />
        ) : null}
      </View>
    );
  };

  const renderIntentCards = () => {
    if (!displayedIntents.length) return null;
    return (
      <View style={styles.section}>
        {displayedIntents.map((it, idx) => {
          const type = String(it.type ?? '').trim().toUpperCase();
          if (type === 'TASK') {
            const title = String(it.content ?? it.title ?? '').trim() || '—';
            const dueIso = String(it.due ?? '').trim();
            let badge = '';
            if (dueIso) {
              try {
                const dt = new Date(dueIso);
                badge = Number.isNaN(dt.getTime())
                  ? dueIso
                  : dt.toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
              } catch {
                badge = dueIso;
              }
            }
            return (
              <View key={`intent-${idx}`} style={styles.intentCard}>
                <View style={styles.intentHeadRow}>
                  <Pressable
                    style={styles.intentDeleteBtn}
                    onPress={() => !busy && removeIntentAt(idx)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Supprimer"
                  >
                    <View style={styles.intentDeleteMinus} />
                  </Pressable>
                  <Text style={styles.intentType}>TASK</Text>
                  {badge ? <Text style={styles.intentBadge}>{badge}</Text> : null}
                </View>
                <Text style={styles.intentTitle}>{title}</Text>
              </View>
            );
          }
          if (type === 'NOTE') {
            const title = String(it.content ?? it.title ?? '').trim() || '—';
            return (
              <View key={`intent-${idx}`} style={styles.intentCard}>
                <View style={styles.intentHeadRow}>
                  <Pressable
                    style={styles.intentDeleteBtn}
                    onPress={() => !busy && removeIntentAt(idx)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Supprimer"
                  >
                    <View style={styles.intentDeleteMinus} />
                  </Pressable>
                  <Text style={styles.intentType}>NOTE</Text>
                </View>
                <Text style={styles.intentTitle}>{title}</Text>
              </View>
            );
          }
          if (type === 'LIST') {
            const title = String(it.title ?? it.content ?? '').trim() || 'Liste';
            const numberOfPeople = Math.max(1, Math.round(Number(it.baseCount ?? 1)));
            const unitLabel = String(it.unitLabel ?? 'personne');
            const items = Array.isArray(it.items) ? (it.items as unknown[]) : [];
            return (
              <View key={`intent-${idx}`} style={styles.intentCard}>
                <View style={styles.intentHeadRow}>
                  <Pressable
                    style={styles.intentDeleteBtn}
                    onPress={() => !busy && removeIntentAt(idx)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Supprimer"
                  >
                    <View style={styles.intentDeleteMinus} />
                  </Pressable>
                  <Text style={styles.intentType}>LIST</Text>
                  <Text style={styles.intentBadge}>{`${numberOfPeople} ${unitLabel}`.trim()}</Text>
                </View>
                <Text style={styles.intentTitle}>{title}</Text>
                <View style={styles.listControlsRow}>
                  <TextInput
                    value={unitLabel}
                    onChangeText={(text) => setIntentListUnitLabel(idx, text)}
                    style={[styles.input, styles.unitInput]}
                    editable={!busy}
                    placeholder={t('talkDebug.oneTapListUnitPlaceholder')}
                  />
                  <View style={styles.listStepperRight}>
                    <Pressable
                      style={[styles.stepBtn, busy && styles.disabled]}
                      disabled={busy}
                      onPress={() => adjustIntentListBaseCount(idx, -1)}
                    >
                      <Text style={styles.stepBtnText}>−</Text>
                    </Pressable>
                    <Text style={styles.countText}>{numberOfPeople}</Text>
                    <Pressable
                      style={[styles.stepBtn, busy && styles.disabled]}
                      disabled={busy}
                      onPress={() => adjustIntentListBaseCount(idx, 1)}
                    >
                      <Text style={styles.stepBtnText}>+</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={styles.catBlock}>
                  {items.map((raw, ii) => {
                    const ir = raw as Record<string, unknown>;
                    const label = String(ir.name ?? '').trim() || '—';
                    const displayQty = listItemDisplayQuantity(ir, numberOfPeople);
                    const unit = String(ir.unit ?? '');
                    const included = ir.includeInSave !== false;
                    const sub = displayQty > 0 ? `${displayQty}${unit ? ` ${unit}` : ''}` : '';
                    return (
                      <Pressable
                        key={`it-${idx}-${ii}`}
                        style={styles.checkRow}
                        onPress={() => !busy && toggleIntentListItemInclude(idx, ii)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: included }}
                      >
                        <Checkbox.Android
                          status={included ? 'checked' : 'unchecked'}
                          onPress={() => !busy && toggleIntentListItemInclude(idx, ii)}
                        />
                        <View style={styles.checkLabelCol}>
                          <Text style={styles.checkLabel}>{label}</Text>
                          {sub ? <Text style={styles.checkSub}>{sub}</Text> : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          }
          if (type === 'HABIT') {
            const title = String(it.content ?? it.title ?? '').trim() || '—';
            const rec = String(it.recurrence ?? '').trim();
            return (
              <View key={`intent-${idx}`} style={styles.intentCard}>
                <View style={styles.intentHeadRow}>
                  <Pressable
                    style={styles.intentDeleteBtn}
                    onPress={() => !busy && removeIntentAt(idx)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Supprimer"
                  >
                    <View style={styles.intentDeleteMinus} />
                  </Pressable>
                  <Text style={styles.intentType}>HABIT</Text>
                  {rec ? <Text style={styles.intentBadge}>{rec}</Text> : null}
                </View>
                <Text style={styles.intentTitle}>{title}</Text>
              </View>
            );
          }
          if (type === 'TRIP') {
            const title = String(it.destination ?? it.content ?? '').trim() || '—';
            return (
              <View key={`intent-${idx}`} style={styles.intentCard}>
                <View style={styles.intentHeadRow}>
                  <Pressable
                    style={styles.intentDeleteBtn}
                    onPress={() => !busy && removeIntentAt(idx)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Supprimer"
                  >
                    <View style={styles.intentDeleteMinus} />
                  </Pressable>
                  <Text style={styles.intentType}>TRIP</Text>
                </View>
                <Text style={styles.intentTitle}>{title}</Text>
              </View>
            );
          }
          return null;
        })}
      </View>
    );
  };

  const renderTypeBody = () => {
    const streamed = renderIntentCards();
    if (streamed) return streamed;
    const d = draft.data;
    const logisticsBlock = () => {
      if (d.logisticsPotential !== true) return null;
      const detected = strData(d, 'destination_name');
      const addr = strData(d, 'location_address');
      const hasValid =
        String(d.location_place_id ?? '').trim().length > 0 &&
        typeof d.location_lat === 'number' &&
        Number.isFinite(d.location_lat) &&
        typeof d.location_lng === 'number' &&
        Number.isFinite(d.location_lng);
      return (
        <View style={styles.logisticsWrap}>
          <Text style={styles.logisticsTitle}>{t('sentinel.validationTitle')}</Text>
          <Text style={styles.logisticsHint}>
            {t('sentinel.detectedPlace', { place: detected || '—' })}
          </Text>
          <Text style={styles.label}>{t('sentinel.addressLabel')}</Text>
          <GooglePlacesAutocompleteField
            value={addr}
            onChangeText={(text) =>
              onChangeDraft(
                patchData(draft, {
                  location_address: text,
                  location_place_id: null,
                  location_lat: null,
                  location_lng: null,
                })
              )
            }
            onSelect={(p) =>
              onChangeDraft(
                patchData(draft, {
                  location_address: p.formattedAddress,
                  location_place_id: p.placeId,
                  location_lat: p.lat,
                  location_lng: p.lng,
                })
              )
            }
            disabled={busy}
            language={i18n.language}
            placeholder={t('sentinel.addressPlaceholder')}
            missingKeyLabel={t('sentinel.placesMissingKey')}
          />
          {!hasValid ? (
            <Text style={styles.logisticsWarn}>{t('sentinel.validationRequired')}</Text>
          ) : null}
          {!spectrum.isProUser && sentinelQuotaBalance !== null ? (
            <Text style={styles.logisticsQuota}>
              {t('quota_remaining', { count: sentinelQuotaBalance })}
            </Text>
          ) : null}
          {!spectrum.isProUser && sentinelQuotaBalance !== null && sentinelQuotaBalance <= 0 ? (
            <View style={styles.logisticsExhausted}>
              <Text style={styles.logisticsExhaustedTitle}>{t('quota_exhausted_title')}</Text>
              <Text style={styles.logisticsExhaustedDesc}>{t('quota_exhausted_desc')}</Text>
            </View>
          ) : null}
        </View>
      );
    };
    switch (draft.predictedType) {
      case 'LIST': {
        const list = (d.list && typeof d.list === 'object' ? d.list : {}) as Record<string, unknown>;
        const numberOfPeople = Math.max(1, Math.round(Number(list.baseCount ?? 1)));
        const unitLabel = String(list.unitLabel ?? 'personne');
        const cats = Array.isArray(list.categories) ? list.categories : [];
        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('talkDebug.oneTapListSection')}</Text>
            <View style={styles.quantityRow}>
              <Pressable
                style={[styles.stepBtn, busy && styles.disabled]}
                disabled={busy}
                onPress={() => onChangeDraft(adjustListBaseCount(draft, -1))}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <Text style={styles.countText}>{numberOfPeople}</Text>
              <Pressable
                style={[styles.stepBtn, busy && styles.disabled]}
                disabled={busy}
                onPress={() => onChangeDraft(adjustListBaseCount(draft, 1))}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
              <TextInput
                value={unitLabel}
                onChangeText={(text) => {
                  const nextList = { ...list, unitLabel: text };
                  onChangeDraft(setListBlock(draft, nextList));
                }}
                style={[styles.input, styles.unitInput]}
                editable={!busy}
                placeholder={t('talkDebug.oneTapListUnitPlaceholder')}
              />
            </View>
            <Text style={styles.label}>{t('talkDebug.oneTapListItems')}</Text>
            {cats.map((cat, ci) => {
              const cr = cat as Record<string, unknown>;
              const catName = String(cr.name ?? '').trim() || '—';
              const itemsRaw = cr.items;
              const items = Array.isArray(itemsRaw) ? itemsRaw : [];
              return (
                <View key={`cat-${ci}`} style={styles.catBlock}>
                  <Text style={styles.catName}>{catName}</Text>
                  {items.map((it, ii) => {
                    const ir = it as Record<string, unknown>;
                    const label = String(ir.name ?? '').trim() || '—';
                    const displayQty = listItemDisplayQuantity(ir, numberOfPeople);
                    const unit = String(ir.unit ?? '');
                    const included = ir.includeInSave !== false;
                    const sub =
                      displayQty > 0 ? `${displayQty}${unit ? ` ${unit}` : ''}` : '';
                    return (
                      <Pressable
                        key={`it-${ci}-${ii}`}
                        style={styles.checkRow}
                        onPress={() => !busy && onChangeDraft(toggleListItemInclude(draft, ci, ii))}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: included }}
                      >
                        <Checkbox.Android
                          status={included ? 'checked' : 'unchecked'}
                          onPress={() => !busy && onChangeDraft(toggleListItemInclude(draft, ci, ii))}
                        />
                        <View style={styles.checkLabelCol}>
                          <Text style={styles.checkLabel}>{label}</Text>
                          {sub ? <Text style={styles.checkSub}>{sub}</Text> : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </View>
        );
      }
      case 'TASK': {
        const due = strData(d, 'dueDateYmd');
        const dueTime = strData(d, 'dueTimeHm');
        const notes = strData(d, 'notes');
        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('talkDebug.oneTapTaskSection')}</Text>
            {Platform.OS === 'web' ? (
              <>
                <Text style={styles.label}>{t('talkDebug.oneTapWebDateLabel')}</Text>
                <TextInput
                  value={due}
                  onChangeText={(text) =>
                    onChangeDraft(patchData(draft, { dueDateYmd: text.trim() || null }))
                  }
                  style={styles.input}
                  editable={!busy}
                  placeholder="YYYY-MM-DD"
                />
              </>
            ) : (
              <>
                <Pressable
                  style={[styles.dateCta, busy && styles.disabled]}
                  disabled={busy}
                  onPress={() => setDateTarget('TASK_DUE')}
                >
                  <Text style={styles.dateCtaText}>
                    {due ? due : t('talkDebug.oneTapPickDate')}
                  </Text>
                </Pressable>
                {due ? (
                  <Pressable
                    style={styles.linkish}
                    disabled={busy}
                    onPress={() => onChangeDraft(patchData(draft, { dueDateYmd: null }))}
                  >
                    <Text style={styles.linkishText}>{t('talkDebug.oneTapClearDate')}</Text>
                  </Pressable>
                ) : null}
                {dateTarget === 'TASK_DUE' ? (
                  <TimelineDatePickerLazy
                    value={dateFromYmd(due)}
                    mode="date"
                    display="default"
                    onChange={onDatePicked}
                  />
                ) : null}
              </>
            )}
            <Text style={styles.label}>{t('talkDebug.oneTapTaskDueTime')}</Text>
            <TextInput
              value={dueTime}
              onChangeText={(text) => onChangeDraft(patchData(draft, { dueTimeHm: text }))}
              style={styles.input}
              editable={!busy}
              placeholder="HH:mm"
            />
            <Text style={styles.label}>{t('talkDebug.oneTapTaskNotes')}</Text>
            <TextInput
              value={notes}
              onChangeText={(text) => onChangeDraft(patchData(draft, { notes: text }))}
              style={[styles.input, styles.multilineSm]}
              multiline
              editable={!busy}
            />
            {logisticsBlock()}
          </View>
        );
      }
      case 'RECURRING_TASK': {
        const nextDue = strData(d, 'nextDueYmd');
        const cadence = strData(d, 'cadenceDescription');
        const anchor = strData(d, 'anchorNotes');
        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('talkDebug.oneTapRecurringSection')}</Text>
            {Platform.OS === 'web' ? (
              <>
                <Text style={styles.label}>{t('talkDebug.oneTapWebDateLabel')}</Text>
                <TextInput
                  value={nextDue}
                  onChangeText={(text) =>
                    onChangeDraft(patchData(draft, { nextDueYmd: text.trim() || null }))
                  }
                  style={styles.input}
                  editable={!busy}
                  placeholder="YYYY-MM-DD"
                />
              </>
            ) : (
              <>
                <Pressable
                  style={[styles.dateCta, busy && styles.disabled]}
                  disabled={busy}
                  onPress={() => setDateTarget('RECUR_NEXT')}
                >
                  <Text style={styles.dateCtaText}>
                    {nextDue ? nextDue : t('talkDebug.oneTapPickDate')}
                  </Text>
                </Pressable>
                {nextDue ? (
                  <Pressable
                    style={styles.linkish}
                    disabled={busy}
                    onPress={() => onChangeDraft(patchData(draft, { nextDueYmd: null }))}
                  >
                    <Text style={styles.linkishText}>{t('talkDebug.oneTapClearDate')}</Text>
                  </Pressable>
                ) : null}
                {dateTarget === 'RECUR_NEXT' ? (
                  <TimelineDatePickerLazy
                    value={dateFromYmd(nextDue)}
                    mode="date"
                    display="default"
                    onChange={onDatePicked}
                  />
                ) : null}
              </>
            )}
            <Text style={styles.label}>{t('talkDebug.oneTapCadence')}</Text>
            <TextInput
              value={cadence}
              onChangeText={(text) => onChangeDraft(patchData(draft, { cadenceDescription: text }))}
              style={[styles.input, styles.multilineSm]}
              multiline
              editable={!busy}
            />
            <Text style={styles.label}>{t('talkDebug.oneTapAnchorNotes')}</Text>
            <TextInput
              value={anchor}
              onChangeText={(text) => onChangeDraft(patchData(draft, { anchorNotes: text }))}
              style={[styles.input, styles.multilineSm]}
              multiline
              editable={!busy}
            />
            {logisticsBlock()}
          </View>
        );
      }
      case 'HABIT': {
        const cadence = strData(d, 'cadenceDescription');
        const pref = strData(d, 'preferredTimeHm');
        const notes = strData(d, 'notes');
        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('talkDebug.oneTapHabitSection')}</Text>
            <Text style={styles.label}>{t('talkDebug.oneTapCadence')}</Text>
            <TextInput
              value={cadence}
              onChangeText={(text) => onChangeDraft(patchData(draft, { cadenceDescription: text }))}
              style={[styles.input, styles.multilineSm]}
              multiline
              editable={!busy}
            />
            <Text style={styles.label}>{t('talkDebug.oneTapPreferredTime')}</Text>
            <TextInput
              value={pref}
              onChangeText={(text) => onChangeDraft(patchData(draft, { preferredTimeHm: text }))}
              style={styles.input}
              editable={!busy}
              placeholder="HH:mm"
            />
            <Text style={styles.label}>{t('talkDebug.oneTapTaskNotes')}</Text>
            <TextInput
              value={notes}
              onChangeText={(text) => onChangeDraft(patchData(draft, { notes: text }))}
              style={[styles.input, styles.multilineSm]}
              multiline
              editable={!busy}
            />
            {logisticsBlock()}
          </View>
        );
      }
      case 'ANNIVERSARY': {
        const person = strData(d, 'personName');
        const md = strData(d, 'monthDay');
        const remRaw = d.reminderDaysBefore;
        const rem =
          remRaw === null || remRaw === undefined ? '' : String(Math.max(0, Number(remRaw) || 0));
        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('talkDebug.oneTapAnniversarySection')}</Text>
            <Text style={styles.label}>{t('talkDebug.oneTapPersonName')}</Text>
            <TextInput
              value={person}
              onChangeText={(text) => onChangeDraft(patchData(draft, { personName: text }))}
              style={styles.input}
              editable={!busy}
            />
            <Text style={styles.label}>{t('talkDebug.oneTapMonthDay')}</Text>
            <TextInput
              value={md}
              onChangeText={(text) => onChangeDraft(patchData(draft, { monthDay: text }))}
              style={styles.input}
              editable={!busy}
              placeholder="MM-DD"
            />
            <Text style={styles.label}>{t('talkDebug.oneTapReminderDays')}</Text>
            <TextInput
              value={rem}
              onChangeText={(text) => {
                const trim = text.trim();
                onChangeDraft(
                  patchData(draft, {
                    reminderDaysBefore: trim === '' ? null : Math.max(0, parseInt(trim, 10) || 0),
                  }),
                );
              }}
              style={styles.input}
              editable={!busy}
              keyboardType="number-pad"
            />
          </View>
        );
      }
      case 'NOTE':
      default: {
        const memo = strData(d, 'memo');
        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('talkDebug.oneTapNoteSection')}</Text>
            <TextInput
              value={memo}
              onChangeText={(text) => onChangeDraft(patchData(draft, { memo: text }))}
              style={[styles.input, styles.multiline]}
              multiline
              editable={!busy}
            />
          </View>
        );
      }
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={[styles.backdrop, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('talkDebug.oneTapResultTitle')}</Text>
          {showRefiningBanner ? (
            <View style={styles.refineBanner} accessibilityRole="progressbar">
              <ActivityIndicator size="small" color="#0f766e" />
              <Text style={styles.refineBannerText}>{t('talkDebug.oneTapRefiningHint')}</Text>
            </View>
          ) : null}

          <Text style={styles.label}>{t('talkDebug.oneTapTypeField')}</Text>
          <Menu
            visible={menuOpen}
            onDismiss={() => setMenuOpen(false)}
            anchor={
              <Pressable
                style={[styles.typeAnchor, busy && styles.disabled]}
                onPress={() => !busy && setMenuOpen(true)}
                disabled={busy}
              >
                <Text style={styles.typeAnchorText}>{typeLabels[draft.predictedType]}</Text>
                <ChevronDown size={20} color="#0f172a" />
              </Pressable>
            }
          >
            {ONE_TAP_PREDICTED_TYPES.map((opt) => (
              <Menu.Item key={opt} onPress={() => applyType(opt)} title={typeLabels[opt]} />
            ))}
          </Menu>

          <ScrollView
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {renderUniversalReminderSection()}
            {renderTypeBody()}

            <Text style={styles.label}>{t('talkDebug.oneTapTranscriptLabel')}</Text>
            <TextInput
              value={transcript}
              onChangeText={onChangeTranscript}
              style={[styles.input, styles.multiline]}
              multiline
              editable={!busy}
            />

            <Text style={styles.label}>{t('talkDebug.oneTapTitleLabel')}</Text>
            <TextInput
              value={draft.title}
              onChangeText={(title) => {
                if (draft.predictedType === 'LIST') {
                  const list = {
                    ...((draft.data.list && typeof draft.data.list === 'object'
                      ? draft.data.list
                      : {}) as Record<string, unknown>),
                    title,
                  };
                  onChangeDraft({ ...draft, title, data: { ...draft.data, list } });
                } else {
                  onChangeDraft({ ...draft, title });
                }
              }}
              style={styles.input}
              editable={!busy}
            />

            <Text style={styles.label}>{t('talkDebug.oneTapCategoryTag')}</Text>
            <TextInput
              value={draft.categoryTag}
              onChangeText={(categoryTag) => onChangeDraft({ ...draft, categoryTag })}
              style={styles.input}
              editable={!busy}
            />
          </ScrollView>

          {isGenerating && hasStreamedIntents(draft) ? <StreamingIndicator /> : null}

          <View style={[styles.actions, draft.predictedType === 'LIST' ? styles.actionsWithPrint : null]}>
            {draft.predictedType === 'LIST' ? (
              <PaperButton mode="outlined" onPress={() => void onPrintList()} disabled={busy}>
                {t('talkDebug.oneTapPrintList')}
              </PaperButton>
            ) : null}
            <View style={styles.actionsSpacer} />
            <PaperButton mode="text" onPress={onDismiss} disabled={busy}>
              {t('common.cancel')}
            </PaperButton>
            <Pressable
              style={[styles.btn, styles.btnPrimary]}
              onPress={onConfirm}
              disabled={
                busy ||
                (draft.data.logisticsPotential === true &&
                  !(
                    String(draft.data.location_place_id ?? '').trim().length > 0 &&
                    typeof draft.data.location_lat === 'number' &&
                    Number.isFinite(draft.data.location_lat) &&
                    typeof draft.data.location_lng === 'number' &&
                    Number.isFinite(draft.data.location_lng)
                  ))
              }
            >
              <Text style={styles.btnPrimaryText}>
                {draft.data.logisticsPotential === true
                  ? t('sentinel.activateCta')
                  : t('talkDebug.oneTapConfirm')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 16,
    gap: 8,
    maxHeight: '92%',
    borderWidth: 0.5,
    borderColor: 'rgba(15,23,42,0.10)',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 2,
  },
  scroll: { maxHeight: '72%' },
  cardTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  refineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(0,128,128,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0,128,128,0.2)',
  },
  refineBannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0f766e' },
  section: { marginTop: 8, marginBottom: 4 },
  reminderSection: {
    marginTop: 4,
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0,128,128,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,128,128,0.22)',
  },
  reminderTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  reminderLine: { fontSize: 14, fontWeight: '600', color: '#0f172a', marginBottom: 4 },
  addReminderBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#94a3b8',
    backgroundColor: '#fff',
  },
  addReminderBtnText: { fontSize: 13, fontWeight: '700', color: '#475569' },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#008080', marginBottom: 8 },
  intentCard: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: 'rgba(15,23,42,0.10)',
    backgroundColor: '#fff',
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1,
  },
  intentHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  intentDeleteBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ff3b30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  intentDeleteMinus: {
    width: 11,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#fff',
  },
  intentType: { fontSize: 12, fontWeight: '900', color: '#0f766e' },
  intentBadge: { fontSize: 12, fontWeight: '800', color: '#475569' },
  intentTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', marginTop: 6 },
  streamingRow: { flexDirection: 'row', justifyContent: 'center', paddingVertical: 6 },
  streamingDot: { fontSize: 18, fontWeight: '900', color: '#0f766e', marginHorizontal: 2 },
  listControlsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  listStepperRight: { flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 'auto' },
  label: { fontSize: 12, fontWeight: '700', color: '#64748b', marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    color: '#0f172a',
  },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  multilineSm: { minHeight: 64, textAlignVertical: 'top' },
  typeAnchor: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#94a3b8',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  typeAnchorText: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  countText: { fontSize: 18, fontWeight: '800', color: '#0f172a', minWidth: 28, textAlign: 'center' },
  unitInput: { flex: 1, minWidth: 0 },
  catBlock: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  catName: { fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  checkLabelCol: { flex: 1 },
  checkLabel: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  checkSub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  logisticsWrap: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  logisticsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
  },
  logisticsLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: '#64748b' },
  logisticsTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a', marginBottom: 4 },
  logisticsHint: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 8 },
  logisticsWarn: { fontSize: 12, fontWeight: '700', color: '#b91c1c', marginTop: 6 },
  logisticsQuota: { fontSize: 12, fontWeight: '700', color: '#0f766e', marginTop: 10 },
  logisticsExhausted: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(244,63,94,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(244,63,94,0.22)',
  },
  logisticsExhaustedTitle: { fontSize: 13, fontWeight: '800', color: '#b91c1c', marginBottom: 2 },
  logisticsExhaustedDesc: { fontSize: 12, fontWeight: '600', color: '#475569' },
  dateCta: {
    marginTop: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#008080',
  },
  dateCtaText: { fontSize: 15, fontWeight: '700', color: '#008080', textAlign: 'center' },
  linkish: { alignSelf: 'flex-start', marginTop: 6, marginBottom: 4 },
  linkishText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 8 },
  actionsWithPrint: { justifyContent: 'space-between', flexWrap: 'wrap' },
  actionsSpacer: { flex: 1, minWidth: 8 },
  btn: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 18 },
  btnPrimary: { backgroundColor: '#007AFF' },
  btnPrimaryText: { fontWeight: '800', color: '#fff' },
  disabled: { opacity: 0.45 },
});
