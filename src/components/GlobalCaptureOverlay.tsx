import React, { useCallback, useEffect, useRef } from 'react';
import { DeviceEventEmitter, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getFreeCaptureQuotaSnapshot } from '../api/trankilV2Db';
import { AIUniversalProgressOverlay } from './AIUniversalProgressOverlay';
import { PassProModal } from './PassProModal';
import {
  TalkCaptureMicButton,
  type TalkCaptureMicButtonHandle,
} from './TalkCaptureMicButton';
import { TALK_CAPTURE_DEBUG_EVENT } from '../constants/talkCaptureDebug';
import {
  INTENTION_PEEK_FIRST_SAVE_EVENT_NAME,
  INTENTIONS_CHANGED_EVENT_NAME,
} from '../constants/intentionEvents';
import { useCapturePresentation } from '../context/CapturePresentationContext';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { useCapturePipelineOverlay } from '../hooks/useCapturePipelineOverlay';
import { rootNavigationRef } from '../navigation/rootNavigationRef';

/**
 * Calque global persistant : micro unique + overlay pipeline IA.
 * Monté dans `App.tsx` (sibling de `AppNavigation`, inside `IntentionProvider`).
 */
export function GlobalCaptureOverlay() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { spectrum } = useUserSpectrum();
  const {
    config,
    isPipelineOverlayVisible,
    setPipelineOverlayVisible,
    pipelineOverlayVisibleRef,
    captureRecordingActive,
    setCaptureRecordingActive,
    invokeLifecycle,
  } = useCapturePresentation();

  const micRef = useRef<TalkCaptureMicButtonHandle | null>(null);
  const [passProVisible, setPassProVisible] = React.useState(false);
  const [freeQuotaSnapshot, setFreeQuotaSnapshot] = React.useState<{ remaining: number; max: number } | null>(null);

  const refreshQuota = useCallback(async () => {
    if (spectrum.isProUser) {
      setFreeQuotaSnapshot(null);
      return;
    }
    const snap = await getFreeCaptureQuotaSnapshot();
    setFreeQuotaSnapshot({ remaining: snap.remaining, max: snap.max });
  }, [spectrum.isProUser]);

  useEffect(() => {
    void refreshQuota();
    const sub = DeviceEventEmitter.addListener(INTENTIONS_CHANGED_EVENT_NAME, () => void refreshQuota());
    return () => sub.remove();
  }, [refreshQuota]);

  const micLocked = !spectrum.isProUser && (freeQuotaSnapshot?.remaining ?? 1) <= 0;

  const pipeline = useCapturePipelineOverlay({
    micRef,
    pipelineModalVisible: isPipelineOverlayVisible,
    setPipelineOverlayVisible,
    pipelineOverlayVisibleRef,
    onPipelineSprintComplete: () => invokeLifecycle('onPipelineSprintComplete'),
  });

  const deferPeekRef = useRef(pipeline.deferPeekFirstSaveIfOverlayVisible);
  deferPeekRef.current = pipeline.deferPeekFirstSaveIfOverlayVisible;

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(INTENTION_PEEK_FIRST_SAVE_EVENT_NAME, (payload) => {
      if (!pipelineOverlayVisibleRef.current && !isPipelineOverlayVisible) return;
      deferPeekRef.current(payload);
    });
    return () => sub.remove();
  }, [isPipelineOverlayVisible, pipelineOverlayVisibleRef]);

  const beforeStartCapture = useCallback(async (): Promise<boolean> => {
    if (micLocked) {
      setPassProVisible(true);
      return false;
    }
    return true;
  }, [micLocked]);

  const onCaptureStart = useCallback(() => {
    setCaptureRecordingActive(true);
    pipeline.onMicStartPipelineReset();
    invokeLifecycle('onCaptureStart');
  }, [invokeLifecycle, pipeline, setCaptureRecordingActive]);

  const onCaptureValidated = useCallback(() => {
    setCaptureRecordingActive(false);
    invokeLifecycle('onCaptureValidated');
  }, [invokeLifecycle, setCaptureRecordingActive]);

  const onCaptureCancel = useCallback(() => {
    setCaptureRecordingActive(false);
    invokeLifecycle('onCaptureCancel');
  }, [invokeLifecycle, setCaptureRecordingActive]);

  const variant = config.variant ?? 'timeline';
  const isTalkDebug = variant === 'talkDebug';
  const dashboardPipelineHost = Boolean(config.dashboardPipelineHost);

  if (config.micHidden) {
    return (
      <>
        <PassProModal visible={passProVisible} onDismiss={() => setPassProVisible(false)} />
        <AIUniversalProgressOverlay
          isVisible={isPipelineOverlayVisible}
          progress={pipeline.pipelineDisplayedPct}
          label={pipeline.pipelineTitleText}
          barColor={pipeline.pipelineBarColor}
        />
      </>
    );
  }

  return (
    <>
      <PassProModal visible={passProVisible} onDismiss={() => setPassProVisible(false)} />
      <AIUniversalProgressOverlay
        isVisible={isPipelineOverlayVisible}
        progress={pipeline.pipelineDisplayedPct}
        label={pipeline.pipelineTitleText}
        barColor={pipeline.pipelineBarColor}
      />
      <View
        pointerEvents="box-none"
        style={[
          styles.host,
          isTalkDebug && styles.hostTalkDebug,
          isTalkDebug && captureRecordingActive && styles.hostTalkDebugRecording,
          { paddingBottom: Math.max(insets.bottom, isTalkDebug ? 10 : 12) },
        ]}
      >
        <TalkCaptureMicButton
          ref={micRef}
          variant={variant}
          compact={config.compact ?? true}
          disabled={config.disabled}
          locked={micLocked}
          lockedHintText={config.lockedHintText ?? t('talkDebug.micQuotaUpsellHint')}
          waveformA11yLabel={config.waveformA11yLabel ?? t('talkDebug.voiceWaveformA11y')}
          onLockedPress={() => {
            if (rootNavigationRef.isReady()) {
              rootNavigationRef.navigate('ProSubscription');
            } else {
              setPassProVisible(true);
            }
          }}
          beforeStart={beforeStartCapture}
          onCaptureStart={onCaptureStart}
          onCaptureCancel={onCaptureCancel}
          onValidated={onCaptureValidated}
          dashboardPipelineHost={dashboardPipelineHost}
          onPipelineDashboardOpenImmediate={pipeline.onPipelineDashboardOpenImmediate}
          onPipelineDashboardCancelImmediate={pipeline.onPipelineDashboardCancelImmediate}
          onPipelineWaitMicPress={pipeline.onPipelineWaitMicPress}
          onProfilerStopRecordingT0={pipeline.onProfilerStopRecordingT0}
          onCaptureEnd={({ transcript }) => {
            if (variant === 'timeline') {
              DeviceEventEmitter.emit(TALK_CAPTURE_DEBUG_EVENT, {
                mode: 'quick',
                at: Date.now(),
                rawTranscript: transcript,
              });
            }
          }}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingTop: 8,
    zIndex: 50,
  },
  hostTalkDebug: {
    paddingHorizontal: 20,
    alignItems: 'stretch',
  },
  hostTalkDebugRecording: {
    top: 0,
    justifyContent: 'flex-start',
    paddingTop: 8,
  },
});
