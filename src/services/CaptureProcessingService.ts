import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { getNotifications } from './notifications';
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

let activeNotificationId: string | null = null;

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

export async function enqueueCaptureProcessingJob(
  transcript: string,
  locale: string,
): Promise<void> {
  const trimmed = transcript.trim();
  if (!trimmed) return;
  const queue = await readQueue();
  queue.push({
    id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    transcript: trimmed,
    locale: locale || 'fr',
    createdAt: Date.now(),
  });
  await writeQueue(queue);
}

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

async function ensureCaptureChannel(): Promise<void> {
  const notifications = getNotifications();
  if (!notifications || Platform.OS !== 'android') return;
  await notifications.setNotificationChannelAsync(CAPTURE_CHANNEL_ID, {
    name: 'Traitement capture',
    importance: notifications.AndroidImportance.LOW,
    lockscreenVisibility: notifications.AndroidNotificationVisibility.PRIVATE,
    vibrationPattern: [0],
    showBadge: false,
    sound: null,
  });
}

export async function startCaptureProcessingForeground(
  context: 'quick' | 'deep' = 'quick',
): Promise<void> {
  const notifications = getNotifications();
  if (!notifications) return;
  try {
    await ensureCaptureChannel();
    const id = await notifications.scheduleNotificationAsync({
      content: {
        title: 'TalkNDone actif',
        body:
          context === 'deep'
            ? 'Traitement vocal en cours, reste actif en arrière-plan.'
            : 'Analyse locale en cours, reste actif en arrière-plan.',
        sticky: true,
        autoDismiss: false,
        priority: notifications.AndroidNotificationPriority.MAX,
        data: { kind: 'capture_processing' },
      },
      trigger: null,
    });
    activeNotificationId = id;
  } catch (error) {
    console.warn('[CaptureProcessingService] start foreground notification failed', error);
  }
}

export async function stopCaptureProcessingForeground(): Promise<void> {
  const notifications = getNotifications();
  if (!notifications) return;
  try {
    if (activeNotificationId) {
      await notifications.dismissNotificationAsync(activeNotificationId);
      activeNotificationId = null;
      return;
    }
    const presented = await notifications.getPresentedNotificationsAsync();
    const matching = presented.find((n) => n.request.content.data?.kind === 'capture_processing');
    if (matching) {
      await notifications.dismissNotificationAsync(matching.request.identifier);
    }
  } catch (error) {
    console.warn('[CaptureProcessingService] stop foreground notification failed', error);
  }
}
