import { useEffect, useRef } from 'react';
import { useShareIntentContext } from 'expo-share-intent';

import { useOptionalIntentionContext } from '../context/IntentionContext';
import { showAppToast } from '../services/appToast';
import {
  extractTranscriptFromSharedImage,
  saveSharedImageToLocal,
  uploadToCloudIfEnabled,
  type SharedImageFile,
} from '../services/share/shareService';
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

    void (async () => {
      try {
        let transcript = sharedText;
        if (imageFile?.path) {
          const localPath = await saveSharedImageToLocal(imageFile.path, imageFile.fileName);
          await uploadToCloudIfEnabled(localPath);
          const visionTranscript = await extractTranscriptFromSharedImage(localPath, imageFile.mimeType);
          if (visionTranscript) {
            transcript = visionTranscript;
          }
        }
        if (!transcript.trim()) {
          showAppToast('Partage ignoré : contenu vide');
          return;
        }
        await intentionFlow.submitCapturePayload({
          transcript: transcript.trim(),
          audioUri: null,
          traceId,
        });
      } catch (e) {
        console.warn('[ShareService] processing failed:', e instanceof Error ? e.message : String(e));
        showAppToast('Échec du traitement du partage');
      } finally {
        processingRef.current = false;
        resetShareIntent();
        lastIntentKeyRef.current = '';
      }
    })();
  }, [isReady, hasShareIntent, shareIntent, intentionFlow, resetShareIntent]);

  return null;
}
