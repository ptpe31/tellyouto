import { useEffect, useRef } from 'react';
import { useShareIntentContext } from 'expo-share-intent';

import { useOptionalCapturePresentation } from '../context/CapturePresentationContext';
import { useOptionalIntentionContext } from '../context/IntentionContext';
import { saveAndCompressImage, syncVaultImageToCloudIfEnabled } from '../services/fileStorage';
import { showAppToast } from '../services/appToast';
import {
  extractTranscriptFromSharedImage,
  uploadToCloudIfEnabled,
  type SharedImageFile,
} from '../services/share/shareService';
import { notifyCapturePipelineProgress } from '../utils/captureFlowLog';
import { newUuidV4 } from '../utils/uuid';

function pickFirstImageFile(files: SharedImageFile[] | undefined): SharedImageFile | null {
  if (!files?.length) return null;
  const image = files.find((f) => String(f.mimeType || '').toLowerCase().startsWith('image/'));
  return image ?? null;
}

/**
 * Écoute le Share Sheet système (expo-share-intent) et injecte le résultat
 * dans le pipeline One-Tap (`submitCapturePayload`) après analyse Vision Gemini.
 */
export function ShareIntentBootstrap() {
  const { isReady, hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntentContext();
  const intentionFlow = useOptionalIntentionContext();
  const capturePresentation = useOptionalCapturePresentation();
  const processingRef = useRef(false);
  const lastIntentKeyRef = useRef('');

  useEffect(() => {
    if (error) {
      console.warn('[ShareService] share intent error:', error);
    }
  }, [error]);

  useEffect(() => {
    if (!isReady || !hasShareIntent || !shareIntent || !intentionFlow || processingRef.current) return;

    const imageFile = pickFirstImageFile(shareIntent.files as SharedImageFile[] | undefined);
    const sharedText = String(shareIntent.text || '').trim();
    if (!imageFile?.path && !sharedText) {
      resetShareIntent();
      return;
    }

    const intentKey = [
      imageFile?.path ?? '',
      imageFile?.fileName ?? '',
      sharedText,
      String(shareIntent.type ?? ''),
    ].join('|');
    if (intentKey === lastIntentKeyRef.current) return;
    lastIntentKeyRef.current = intentKey;

    processingRef.current = true;
    const traceId = newUuidV4();
    const preassignedIntentionId = newUuidV4();

    void (async () => {
      try {
        let transcript = sharedText;

        if (imageFile?.path) {
          capturePresentation?.onProfilerStopRecordingT0();
          capturePresentation?.onPipelineDashboardOpenImmediate({ traceId });
          notifyCapturePipelineProgress(traceId, 'mic_stop_audio_done', { source: 'share_intent' });

          const vaultPath = await saveAndCompressImage(imageFile.path, preassignedIntentionId);
          notifyCapturePipelineProgress(traceId, 'mic_submit_invoke', {
            source: 'share_intent',
            intentionId: preassignedIntentionId,
          });
          await syncVaultImageToCloudIfEnabled(preassignedIntentionId);
          await uploadToCloudIfEnabled(vaultPath);

          const visionTranscript = await extractTranscriptFromSharedImage(vaultPath, 'image/jpeg');
          if (visionTranscript) {
            transcript = visionTranscript;
          }
        }

        if (!transcript.trim()) {
          if (imageFile?.path) {
            capturePresentation?.onPipelineDashboardCancelImmediate();
          }
          showAppToast('Partage ignoré : contenu vide');
          return;
        }

        await intentionFlow.submitCapturePayload({
          transcript: transcript.trim(),
          audioUri: null,
          traceId,
          preassignedIntentionId: imageFile?.path ? preassignedIntentionId : undefined,
        });
      } catch (e) {
        capturePresentation?.onPipelineDashboardCancelImmediate();
        console.warn('[ShareService] processing failed:', e instanceof Error ? e.message : String(e));
        showAppToast('Échec du traitement du partage');
      } finally {
        processingRef.current = false;
        resetShareIntent();
        lastIntentKeyRef.current = '';
      }
    })();
  }, [capturePresentation, isReady, hasShareIntent, shareIntent, intentionFlow, resetShareIntent]);

  return null;
}
