import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  DeviceEventEmitter,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';

import {
  countTrankilV2RootTodoTasksDueOnLocalDate,
  getFreeCaptureQuotaSnapshot,
  getTrankilV2IntentionById,
  getTrankilV2UnorganizedCount,
} from '../api/trankilV2Db';
import {
  INTENTION_PEEK_FIRST_SAVE_EVENT_NAME,
  INTENTION_PEEK_SNAPSHOT_EVENT_NAME,
  INTENTIONS_CHANGED_EVENT_NAME,
} from '../constants/intentionEvents';
import { logCaptureFlow, CAPTURE_PIPELINE_PROGRESS_EVENT, type CapturePipelineProgressPayload } from '../utils/captureFlowLog';
import {
  buildPeekPendingRowFromSnapshot,
  capturePeekPathAHeightPx,
  capturePeekPathBHeightPx,
  CAPTURE_SHEET_FULL_MAX_RATIO,
} from '../utils/capturePeekLayout';
import { mapTrankilIntentionToTimelineItemRow, type TrankilV2TimelineItemRow } from '../api';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { DealerBoard } from '../components/DealerBoard';
import { IntentionSuggestionsBanner } from '../components/IntentionSuggestionsBanner';
import { PassProModal } from '../components/PassProModal';
import { TalkCaptureMicButton, type TalkCaptureEndPayload, type TalkCaptureMicButtonHandle } from '../components/TalkCaptureMicButton';
import { TalkPipelineProgressDashboard } from '../components/TalkPipelineProgressDashboard';
import { IntentionDetailSheet } from '../components/IntentionDetailSheet';
import { PilotStatusHeader } from '../components/PilotStatusHeader';
import { formatYmdLocal } from '../services/TimeSorter';
import { resolveSpeechLangForSession } from '../utils/speechLocale';
import type { AppTabParamList } from '../navigation/types';
import { logOneTapCaptureCycleStartBanner, ONE_TAP_DEBUG_LOG_CONT } from '../services/oneTapUniversalCapture';
import { useOptionalIntentionContext } from '../context/IntentionContext';
import { rootNavigationRef } from '../navigation/rootNavigationRef';

/**
 * Écran **Talk / Debug** : Phoenix texte + micro → `IntentionContext.submitCapturePayload` (Bulk(1)),
 * événements peek (`INTENTION_PEEK_*`). Le pipeline complet vit dans `TalkCaptureMicButton` + contexte.
 *
 * @module TalkDebugScreen
 */

/** Horodatage perf cohérent avec les logs `[OneTapPerf]` (T0, etc.). */
function perfNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Normalise un tag catégorie UI vers les codes domaine SQLite (fallback `PERSO`). */
function normalizeCategoryId(raw: unknown): string {
  const up = String(raw ?? '').trim().toUpperCase();
  if (!up) return 'PERSO';
  if (up === 'FAMILLE') return 'HOME';
  if (up === 'PRO') return 'WORK';
  if (['HOME', 'WORK', 'PERSO', 'HEALTH', 'FINANCE', 'TRAVEL', 'SOCIAL', 'SHOP', 'LEARN', 'OTHER'].includes(up)) return up;
  return 'PERSO';
}

/** Écran principal onglet Talk : capture, quotas, suggestions, feuille détail peek/full. */
export function TalkDebugScreen() {
  const { t, i18n } = useTranslation();
  const { spectrum } = useUserSpectrum();
  const intentionFlow = useOptionalIntentionContext();
  const [passProVisible, setPassProVisible] = useState(false);
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const navigation = useNavigation<BottomTabNavigationProp<AppTabParamList>>();
  const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<TrankilV2TimelineItemRow | null>(null);
  const [detailPosition, setDetailPosition] = useState<'peek' | 'full'>('full');
  const [detailPeekHeightPx, setDetailPeekHeightPx] = useState(() => capturePeekPathAHeightPx());
  const [peekCapturePhase, setPeekCapturePhase] = useState<'idle' | 'path_a' | 'path_b'>('idle');
  const peekSnapshotRef = useRef<{ categoryTag?: unknown; predictedType?: unknown; title?: unknown } | null>(null);
  const [phoenixInput, setPhoenixInput] = useState('');
  const [phoenixSubmitting, setPhoenixSubmitting] = useState(false);
  const [captureStep, setCaptureStep] = useState<'idle' | 'recording'>('idle');
  const [freeQuotaSnapshot, setFreeQuotaSnapshot] = useState<{ remaining: number; max: number } | null>(null);
  const [todayTodoCount, setTodayTodoCount] = useState(0);
  const [headerUnorganizedCount, setHeaderUnorganizedCount] = useState(0);

  const micRef = useRef<TalkCaptureMicButtonHandle | null>(null);
  const [pipelineModalVisible, setPipelineModalVisible] = useState(false);
  const [pipelineDisplayedPct, setPipelineDisplayedPct] = useState(0);
  const [pipelineResilienceOrange, setPipelineResilienceOrange] = useState(false);
  const pipelineTargetRef = useRef(0);
  const pipelineActiveTraceRef = useRef<string | null>(null);
  const pipelineNormalFinishRef = useRef(false);
  const pipelineOrangeNavScheduledRef = useRef(false);
  const pipelineContentOpacity = useRef(new Animated.Value(1)).current;

  /** Rafraîchit compteurs en-tête (tâches du jour, piggy, quota free capture). */
  const refreshPilotHeader = useCallback(async () => {
    const ymd = formatYmdLocal(new Date());
    const [unorg, todayN, snap] = await Promise.all([
      getTrankilV2UnorganizedCount(),
      countTrankilV2RootTodoTasksDueOnLocalDate(ymd),
      spectrum.isProUser ? Promise.resolve(null) : getFreeCaptureQuotaSnapshot(),
    ]);
    setHeaderUnorganizedCount(unorg);
    setTodayTodoCount(todayN);
    if (snap) {
      setFreeQuotaSnapshot({ remaining: snap.remaining, max: snap.max });
    } else {
      setFreeQuotaSnapshot(null);
    }
  }, [spectrum.isProUser]);

  useFocusEffect(
    useCallback(() => {
      void refreshPilotHeader();
    }, [refreshPilotHeader]),
  );

  useEffect(() => {
    const subs = [
      DeviceEventEmitter.addListener(INTENTIONS_CHANGED_EVENT_NAME, () => void refreshPilotHeader()),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [refreshPilotHeader]);

  /** Remet l’étape capture micro à l’état repos (annulation). */
  const hardResetToIdle = useCallback(() => {
    setCaptureStep('idle');
  }, []);

  const micLocked = !spectrum.isProUser && (freeQuotaSnapshot?.remaining ?? 1) <= 0;

  /** Gate micro : quota free épuisé → false (modal Pro si verrou). */
  const beforeStartCapture = useCallback(async (): Promise<boolean> => {
    if (micLocked) {
      setPassProVisible(true);
      return false;
    }
    return true;
  }, [micLocked]);

  /** Début d’enregistrement micro : ferme le dashboard résiduel (nouvelle capture). */
  const onMicStart = useCallback(() => {
    setCaptureStep('recording');
    setPipelineModalVisible(false);
    setPipelineResilienceOrange(false);
    pipelineOrangeNavScheduledRef.current = false;
  }, []);

  /** Ouvre le dashboard pipeline (trace alignée sur les événements `CAPTURE_PIPELINE_PROGRESS`). */
  const onDashboardPipelineOpened = useCallback((ctx: { traceId: string; onlineAtMicStop: boolean }) => {
    void ctx.onlineAtMicStop;
    pipelineActiveTraceRef.current = String(ctx.traceId || '').trim() || null;
    pipelineTargetRef.current = 4;
    pipelineNormalFinishRef.current = false;
    pipelineOrangeNavScheduledRef.current = false;
    pipelineContentOpacity.setValue(1);
    setPipelineDisplayedPct(0);
    setPipelineResilienceOrange(false);
    setPipelineModalVisible(true);
  }, [pipelineContentOpacity]);

  /** Micro « échap » : ferme l’overlay sans annuler `submitCapturePayload`. */
  const onPipelineWaitMicPress = useCallback(() => {
    setPipelineModalVisible(false);
    queueMicrotask(() => micRef.current?.exitPipelineWaitToIdle());
  }, []);

  useEffect(() => {
    if (!pipelineModalVisible) return;
    const id = setInterval(() => {
      setPipelineDisplayedPct((d) => {
        const t = pipelineTargetRef.current;
        const n = d + (t - d) * 0.12;
        return Math.abs(t - n) < 0.45 ? t : n;
      });
    }, 40);
    return () => clearInterval(id);
  }, [pipelineModalVisible]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(CAPTURE_PIPELINE_PROGRESS_EVENT, (raw: CapturePipelineProgressPayload) => {
      const trace = String(raw.trace || '').trim();
      const active = String(pipelineActiveTraceRef.current || '').trim();
      if (!trace || !active || trace !== active) return;
      const d = raw.detail;
      let setOrange = false;
      const bump = (v: number) => {
        pipelineTargetRef.current = Math.max(pipelineTargetRef.current, v);
      };
      switch (raw.phase) {
        case 'mic_stop_audio_done':
          bump(9);
          break;
        case 'mic_submit_invoke':
          bump(16);
          break;
        case 'submit_enter':
          bump(19);
          break;
        case 'submit_netinfo':
          bump(26);
          break;
        case 'netinfo_online_null_reachable':
          bump(29);
          break;
        case 'peek_snapshot_emit':
          bump(50);
          break;
        case 'peek_snapshot_offline_queue':
          setOrange = true;
          bump(100);
          break;
        case 'bulk_start':
          bump(68);
          break;
        case 'chunk_ventilated_await':
          bump(73);
          break;
        case 'chunk_persist_ok':
          bump(82);
          break;
        case 'persist_callback':
          bump(87);
          break;
        case 'peek_first_save_emit':
          bump(93);
          break;
        case 'submit_return_after_bulk':
          bump(100);
          break;
        case 'bulk_network_resilience_enqueue':
          setOrange = true;
          bump(100);
          break;
        case 'submit_offline_queued':
          if (d?.reason === 'netinfo_offline') setOrange = true;
          bump(100);
          break;
        default:
          break;
      }
      if (setOrange) setPipelineResilienceOrange(true);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!pipelineModalVisible || pipelineResilienceOrange) return;
    if (pipelineDisplayedPct < 99.2) return;
    if (pipelineNormalFinishRef.current) return;
    pipelineNormalFinishRef.current = true;
    const anim = Animated.timing(pipelineContentOpacity, {
      toValue: 0,
      duration: 420,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (!finished) return;
      setPipelineModalVisible(false);
      pipelineNormalFinishRef.current = false;
      pipelineContentOpacity.setValue(1);
      micRef.current?.exitPipelineWaitToIdle();
    });
    return () => {
      anim.stop();
      pipelineNormalFinishRef.current = false;
    };
  }, [pipelineContentOpacity, pipelineDisplayedPct, pipelineModalVisible, pipelineResilienceOrange]);

  useEffect(() => {
    if (!pipelineModalVisible || !pipelineResilienceOrange) return;
    if (pipelineDisplayedPct < 98.5) return;
    if (pipelineOrangeNavScheduledRef.current) return;
    pipelineOrangeNavScheduledRef.current = true;
    const t = setTimeout(() => {
      pipelineOrangeNavScheduledRef.current = false;
      navigation.navigate('Timeline', { initialTimeNav: 'TODAY', initialContext: 'ALL' });
      setPipelineModalVisible(false);
      pipelineContentOpacity.setValue(1);
      micRef.current?.exitPipelineWaitToIdle();
    }, 2000);
    return () => {
      clearTimeout(t);
      pipelineOrangeNavScheduledRef.current = false;
    };
  }, [navigation, pipelineContentOpacity, pipelineDisplayedPct, pipelineModalVisible, pipelineResilienceOrange]);

  const pipelineTitleText = useMemo(() => {
    if (pipelineResilienceOrange) return t('talkDebug.errorNetwork');
    if (pipelineDisplayedPct < 30) return t('talkDebug.stepTransport');
    if (pipelineDisplayedPct < 60) return t('talkDebug.stepTranscription');
    return t('talkDebug.stepAnalysis');
  }, [pipelineDisplayedPct, pipelineResilienceOrange, t]);

  const pipelineBarColor = pipelineResilienceOrange ? '#fb923c' : '#38bdf8';

  /**
   * Fin dictée côté parent : T0 perf + bannière cycle. Le pipeline Gemini + `submitCapturePayload`
   * est enchaîné dans `TalkCaptureMicButton` à la validation.
   */
  const onMicEnd = useCallback((_payload: TalkCaptureEndPayload) => {
    const t0 = perfNowMs();
    logOneTapCaptureCycleStartBanner();
    console.log(`[OneTapPerf] T0_CAPTURE_END${ONE_TAP_DEBUG_LOG_CONT}t0_ms: ${Math.round(t0)}`);
  }, []);

  /** Ferme la feuille détail (peek ou plein écran). */
  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailRow(null);
    setDetailPosition('full');
    setDetailPeekHeightPx(capturePeekPathAHeightPx());
    setPeekCapturePhase('idle');
  }, []);

  /** Évite une feuille capture résiduelle sur un onglet non focalisé (cf. SPEC routage peek). */
  useEffect(() => {
    if (isFocused) return;
    const inCapturePeekFlow =
      peekCapturePhase !== 'idle' || detailRow?.id === 'peek_pending';
    if (!detailOpen || !inCapturePeekFlow) return;
    logCaptureFlow(undefined, 'ui_peek_capture_dismissed_unfocused_tab', { screen: 'TalkDebug' });
    closeDetail();
  }, [closeDetail, detailOpen, detailRow?.id, isFocused, peekCapturePhase]);

  /** Écoute `INTENTION_PEEK_*` : ouvre / hydrate la feuille détail (cinématique peek SPEC). */
  useEffect(() => {
    const subSnap = DeviceEventEmitter.addListener(INTENTION_PEEK_SNAPSHOT_EVENT_NAME, (payload) => {
      if (!isFocusedRef.current) {
        logCaptureFlow(undefined, 'ui_peek_snapshot_skip_unfocused', { screen: 'TalkDebug' });
        return;
      }
      peekSnapshotRef.current = payload as { categoryTag?: unknown; predictedType?: unknown; title?: unknown } | null;
      const peekRow = buildPeekPendingRowFromSnapshot(
        payload as { categoryTag?: unknown; predictedType?: unknown; title?: unknown },
        normalizeCategoryId,
      );
      setDetailRow(peekRow);
      setDetailPosition('peek');
      setDetailPeekHeightPx(capturePeekPathAHeightPx());
      setPeekCapturePhase('path_a');
      setDetailOpen(true);
      logCaptureFlow(undefined, 'ui_peek_snapshot', {
        screen: 'TalkDebug',
        categoryTag: String((payload as { categoryTag?: unknown }).categoryTag ?? ''),
        predictedType: String((payload as { predictedType?: unknown }).predictedType ?? ''),
      });
    });
    const subFirstSave = DeviceEventEmitter.addListener(INTENTION_PEEK_FIRST_SAVE_EVENT_NAME, (payload) => {
      if (!isFocusedRef.current) {
        logCaptureFlow(undefined, 'ui_peek_first_save_skip_unfocused', { screen: 'TalkDebug' });
        return;
      }
      const intentionId = String((payload as any)?.intentionId ?? '').trim();
      if (!intentionId) return;
      const title = String((payload as any)?.title ?? '').trim();
      const transcript = String((payload as any)?.transcript ?? '').trim();
      const categoryId = normalizeCategoryId((payload as any)?.categoryTag);
      const type = String((payload as any)?.predictedType ?? 'NOTE').trim().toUpperCase();
      const previewRow = {
        id: intentionId,
        type,
        category_id: categoryId,
        display_title: title || t('timeline.untitled'),
        content_raw: transcript,
        due_date: null,
        metadata_json: '{}',
        status: 'TODO',
        created_at: Date.now(),
        updated_at: Date.now(),
        is_archived: 0,
        is_dirty: 0,
      } as unknown as TrankilV2TimelineItemRow;
      setPeekCapturePhase('path_b');
      setDetailPeekHeightPx(capturePeekPathBHeightPx());
      setDetailRow(previewRow);
      setDetailPosition('peek');
      setDetailOpen(true);
      logCaptureFlow(undefined, 'ui_peek_first_save', { screen: 'TalkDebug', intentionId });
      void (async () => {
        const full = await getTrankilV2IntentionById(intentionId);
        logCaptureFlow(undefined, 'ui_peek_first_save_sql_hydrate', {
          screen: 'TalkDebug',
          intentionId,
          found: Boolean(full),
        });
        if (!full) return;
        const mapped = mapTrankilIntentionToTimelineItemRow(full);
        setDetailRow((prev) => (prev && prev.id === intentionId ? mapped : prev));
      })();
    });
    return () => {
      subSnap.remove();
      subFirstSave.remove();
    };
  }, [t]);

  /** Après validation UI côté `TalkCaptureMicButton` : repasse l’étape capture à idle. */
  const onMicValidated = useCallback(() => {
    setCaptureStep('idle');
  }, []);

  /** Annulation micro : reset étape capture. */
  const onMicCancel = useCallback(async () => {
    hardResetToIdle();
  }, [hardResetToIdle]);

  /** Saisie texte « Phoenix » : même pipeline OneTap que le micro (`submitCapturePayload`, Bulk(1)). */
  const onSubmitPhoenix = useCallback(async () => {
    const transcript = phoenixInput.trim();
    if (!transcript) return;
    if (!intentionFlow) {
      Alert.alert('Capture', 'IntentionProvider manquant (Dev Client requis).');
      return;
    }
    setPhoenixSubmitting(true);
    try {
      intentionFlow.startCapture();
      logCaptureFlow(undefined, 'phoenix_submit_invoke', { transcriptLen: transcript.length });
      await intentionFlow.submitCapturePayload({ transcript, audioUri: null, lang: resolveSpeechLangForSession(i18n.language) });
      setPhoenixInput('');
    } catch (e) {
      Alert.alert('Capture', e instanceof Error ? e.message : String(e));
    } finally {
      setPhoenixSubmitting(false);
    }
  }, [i18n.language, intentionFlow, phoenixInput]);

  return (
    <View style={styles.root}>
      <PassProModal
        visible={passProVisible}
        onDismiss={() => setPassProVisible(false)}
      />
      <IntentionDetailSheet
        visible={detailOpen}
        row={detailRow}
        theme={theme}
        onClose={closeDetail}
        initialPosition={detailPosition}
        peekHeightPx={detailPeekHeightPx}
        validationMode
        peekCapturePhase={peekCapturePhase}
        captureSheetMaxHeightRatio={peekCapturePhase !== 'idle' ? CAPTURE_SHEET_FULL_MAX_RATIO : undefined}
      />
      <TalkPipelineProgressDashboard
        visible={pipelineModalVisible}
        title={pipelineTitleText}
        displayedPct={pipelineDisplayedPct}
        barColor={pipelineBarColor}
        contentOpacity={pipelineContentOpacity}
      />
      <View style={[styles.headerSafe, { paddingTop: Math.max(insets.top, 6) }]}>
        <View style={styles.phoenixRow}>
          <TextInput
            value={phoenixInput}
            onChangeText={setPhoenixInput}
            placeholder="Tape ton intention ici..."
            placeholderTextColor="rgba(226,232,240,0.55)"
            style={styles.phoenixInput}
            editable={!phoenixSubmitting}
            returnKeyType="send"
            onSubmitEditing={() => void onSubmitPhoenix()}
          />
          <TouchableOpacity
            style={[styles.phoenixSendBtn, phoenixSubmitting ? styles.disabled : null]}
            onPress={() => void onSubmitPhoenix()}
            disabled={phoenixSubmitting}
            activeOpacity={0.8}
          >
            <Text style={styles.phoenixSendText}>Envoyer</Text>
          </TouchableOpacity>
        </View>
        <PilotStatusHeader
          variant="talkDebug"
          isProUser={spectrum.isProUser}
          freeRemaining={freeQuotaSnapshot?.remaining ?? 0}
          freeMax={freeQuotaSnapshot?.max ?? 3}
          dayOfMonth={new Date().getDate()}
          todayTodoCount={todayTodoCount}
          piggyCount={headerUnorganizedCount}
          onPressCredits={() => {
            if (rootNavigationRef.isReady()) {
              rootNavigationRef.navigate('ProSubscription');
            }
          }}
          onPressCalendar={() =>
            navigation.navigate('Timeline', {
              initialTimeNav: 'TODAY',
              initialContext: 'ALL',
            })
          }
          onPressPiggy={() =>
            navigation.navigate('Timeline', {
              initialTimeNav: 'TODAY',
              initialContext: 'PIGGY',
            })
          }
          translate={t}
        />
      </View>

      <View style={styles.middleSpacer} />

      <IntentionSuggestionsBanner visible={captureStep === 'idle' && !pipelineModalVisible} bottomOffset={112} />

      <View
        style={[
          styles.captureDock,
          {
            paddingBottom: Math.max(insets.bottom, 10),
            justifyContent: captureStep === 'idle' ? 'flex-end' : 'flex-start',
          },
        ]}
      >
        <TalkCaptureMicButton
          ref={micRef}
          variant="talkDebug"
          disabled={phoenixSubmitting}
          locked={micLocked}
          lockedHintText={t('talkDebug.micQuotaUpsellHint')}
          waveformA11yLabel={t('talkDebug.voiceWaveformA11y')}
          onLockedPress={() => setPassProVisible(true)}
          beforeStart={beforeStartCapture}
          onCaptureStart={onMicStart}
          onCaptureEnd={onMicEnd}
          onCaptureCancel={onMicCancel}
          onValidated={onMicValidated}
          dashboardPipelineHost
          onDashboardPipelineOpened={onDashboardPipelineOpened}
          onPipelineWaitMicPress={onPipelineWaitMicPress}
        />
      </View>

      <DealerBoard />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111827' },
  headerSafe: { paddingHorizontal: 16, paddingBottom: 8 },
  phoenixRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 10 },
  phoenixInput: {
    flex: 1,
    color: '#e2e8f0',
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.55)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(15,23,42,0.55)',
    fontWeight: '700',
  },
  phoenixSendBtn: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#008080',
    borderWidth: 1,
    borderColor: 'rgba(236,254,255,0.35)',
  },
  phoenixSendText: { color: '#ecfeff', fontSize: 14, fontWeight: '900' },
  middleSpacer: { flex: 1, minHeight: 0 },
  captureDock: { paddingHorizontal: 20, paddingTop: 10, minHeight: 120 },
  disabled: { opacity: 0.5 },
});
