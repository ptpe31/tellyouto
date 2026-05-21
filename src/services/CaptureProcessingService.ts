/**
 * BackgroundFetch + queue AsyncStorage pour un traitement local léger (`analyzeLocally`),
 * **sans** lien avec `offline_audio_queue` (SQLite). Voir `PROJECT_STATUS.md` §2.6.
 *
 * @module CaptureProcessingService
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { analyzeLocally } from './Gatekeeper';

const CAPTURE_PROCESSING_TASK = 'TALKNDONE_CAPTURE_PROCESSING_TASK';
const CAPTURE_QUEUE_KEY = 'talkndone.capture.processing.queue';
const CAPTURE_CHANNEL_ID = 'talkndone-capture-processing';

type PendingCaptureJob = {
  id: string;
  transcript: string;
  locale: string;
  createdAt: number;
};

if (!TaskManager.isTaskDefined(CAPTURE_PROCESSING_TASK)) {
  TaskManager.defineTask(CAPTURE_PROCESSING_TASK, async () => {
    try {
      const jobs = await readQueue();
      if (!jobs.length) return BackgroundFetch.BackgroundFetchResult.NoData;
      const next = jobs.shift() as PendingCaptureJob;
      await analyzeLocally(next.transcript, next.locale);
      await writeQueue(jobs);
      console.log('[CaptureProcessingService] background job completed', {
        id: next.id,
        remaining: jobs.length,
      });
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch (error) {
      console.warn('[CaptureProcessingService] background task error', error);
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

async function readQueue(): Promise<PendingCaptureJob[]> {
  try {
    const raw = await AsyncStorage.getItem(CAPTURE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingCaptureJob[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: PendingCaptureJob[]): Promise<void> {
  await AsyncStorage.setItem(CAPTURE_QUEUE_KEY, JSON.stringify(queue));
}

/** DEPRECATED — jamais appelé (queue AsyncStorage vide). Voir `nettoyage-code-mort.md` §9. */
export async function enqueueCaptureProcessingJob(
  _transcript: string,
  _locale: string,
): Promise<void> {
  void _transcript;
  void _locale;
}

/* enqueueCaptureProcessingJob — original : push sur CAPTURE_QUEUE_KEY */

/** Enregistre la tâche `TALKNDONE_CAPTURE_PROCESSING_TASK` si BackgroundFetch est autorisé. */
export async function configureCaptureBackgroundTask(): Promise<void> {
  if (Platform.OS === 'web') return;
  const status = await BackgroundFetch.getStatusAsync();
  if (
    status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
    status === BackgroundFetch.BackgroundFetchStatus.Denied
  ) {
    console.warn('[CaptureProcessingService] background fetch unavailable', { status });
    return;
  }
  const registered = await TaskManager.isTaskRegisteredAsync(CAPTURE_PROCESSING_TASK);
  if (!registered) {
    await BackgroundFetch.registerTaskAsync(CAPTURE_PROCESSING_TASK, {
      minimumInterval: 15 * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
    console.log('[CaptureProcessingService] task registered');
  }
}

/* ensureCaptureChannel — DEPRECATED §9 nettoyage-code-mort.md */

/** DEPRECATED — jamais appelé. Voir `nettoyage-code-mort.md` §9. */
export async function startCaptureProcessingForeground(
  _context: 'quick' | 'deep' = 'quick',
): Promise<void> {
  void _context;
}

/** DEPRECATED — jamais appelé. Voir `nettoyage-code-mort.md` §9. */
export async function stopCaptureProcessingForeground(): Promise<void> {
  /* no-op */
}

/* startCaptureProcessingForeground / stopCaptureProcessingForeground — originals in git / §9 doc */
