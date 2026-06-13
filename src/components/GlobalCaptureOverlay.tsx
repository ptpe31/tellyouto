import React, { useMemo } from 'react';
import { DeviceEventEmitter, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AIUniversalProgressOverlay } from './AIUniversalProgressOverlay';
import { PassProModal } from './PassProModal';
import { TalkCaptureMicButton } from './TalkCaptureMicButton';
import { TALK_CAPTURE_DEBUG_EVENT } from '../constants/talkCaptureDebug';
import {
  resolveGlobalCaptureOverlayBottom,
  resolveTalkDebugMicDockTopPx,
  TALK_DEBUG_MIC_DOCK_MIN_HEIGHT,
} from '../constants/captureOverlayLayout';
import { useCapturePresentation } from '../context/CapturePresentationContext';

/**
 * Calque global persistant : micro unique (absolute bottom) + overlay pipeline IA.
 */
export function GlobalCaptureOverlay() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const {
    config,
    captureRecordingActive,
    isPipelineOverlayVisible,
    pipelineDisplayedPct,
    pipelineTitleText,
    pipelineBarColor,
    micRef,
    micLocked,
    passProVisible,
    setPassProVisible,
    openLockedMicUpsell,
    beforeStartCapture,
    onCaptureStart,
    onCaptureCancel,
    onCaptureValidated,
    onPipelineDashboardOpenImmediate,
    onPipelineDashboardCancelImmediate,
    onPipelineWaitMicPress,
    onProfilerStopRecordingT0,
  } = useCapturePresentation();

  const variant = config.variant ?? 'timeline';
  const isTalkDebug = variant === 'talkDebug';
  const dashboardPipelineHost = Boolean(config.dashboardPipelineHost);
  const showGlobalMic = !config.micHidden;

  const overlayBottom = useMemo(
    () => resolveGlobalCaptureOverlayBottom(insets.bottom),
    [insets.bottom],
  );

  const pipelineVerticalAnchorBand = useMemo(() => {
    if (!isTalkDebug) return null;
    const topPx = config.pipelineAnchorTopPx;
    if (topPx == null || topPx <= 0) return null;
    const bottomPx = resolveTalkDebugMicDockTopPx(windowHeight, insets.bottom);
    if (bottomPx <= topPx) return null;
    return { topPx, bottomPx };
  }, [config.pipelineAnchorTopPx, insets.bottom, isTalkDebug, windowHeight]);

  return (
    <>
      <PassProModal visible={passProVisible} onDismiss={() => setPassProVisible(false)} />
      <AIUniversalProgressOverlay
        isVisible={isPipelineOverlayVisible}
        progress={pipelineDisplayedPct}
        label={pipelineTitleText}
        barColor={pipelineBarColor}
        verticalAnchorBand={pipelineVerticalAnchorBand}
      />
      {showGlobalMic ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.host,
            isTalkDebug && styles.hostTalkDebug,
            isTalkDebug &&
              (captureRecordingActive ? styles.hostTalkDebugRecording : styles.hostTalkDebugIdle),
            { bottom: overlayBottom },
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
            onLockedPress={openLockedMicUpsell}
            beforeStart={beforeStartCapture}
            onCaptureStart={onCaptureStart}
            onCaptureCancel={onCaptureCancel}
            onValidated={onCaptureValidated}
            dashboardPipelineHost={dashboardPipelineHost}
            onPipelineDashboardOpenImmediate={onPipelineDashboardOpenImmediate}
            onPipelineDashboardCancelImmediate={onPipelineDashboardCancelImmediate}
            onPipelineWaitMicPress={onPipelineWaitMicPress}
            onProfilerStopRecordingT0={onProfilerStopRecordingT0}
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
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 50,
  },
  hostTalkDebug: {
    paddingHorizontal: 20,
    alignItems: 'stretch',
  },
  /** Repos : micro ancré en bas du dock (au-dessus tab bar via `bottom` du host). */
  hostTalkDebugIdle: {
    justifyContent: 'flex-end',
    minHeight: TALK_DEBUG_MIC_DOCK_MIN_HEIGHT,
  },
  /** Capture : toolbar en bas, transcript au-dessus (grow upward). */
  hostTalkDebugRecording: {
    justifyContent: 'flex-end',
  },
});
