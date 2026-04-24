import { updateTrankilV2IntentionArchiveState } from '../../api/trankilV2Db';
import { scheduleTrankilV2IntentionAlarmById } from '../alarmManager';
import { syncIntentionCalendarMirror } from '../calendarMirrorSync';
import { logActivity } from '../UserActivityService';
import type {
  PostCaptureEffectsConfig,
  PostCaptureEffectsResult,
  PostCaptureMirrorType,
  TemporalRecapIntroKey,
} from './types';

/**
 * Centralise miroir calendrier, archivage auto et alarmes après une capture locale.
 * Chaque effet est isolé : un échec n’empêche pas les suivants ni la réussite métier.
 */
export async function applyPostCaptureEffects(
  intentionId: string,
  type: PostCaptureMirrorType,
  params: { title: string; dueDateYmd: string | null; metadataJson?: string },
  config: PostCaptureEffectsConfig,
): Promise<PostCaptureEffectsResult> {
  let syncedCalendar = false;
  let archived = false;
  let alarmOk = false;

  try {
    if (config.calendarSyncEnabled && config.isProUser) {
      try {
        const sync = await syncIntentionCalendarMirror({
          intentionId,
          type,
          title: params.title,
          dueDateYmd: params.dueDateYmd,
          metadataJson: params.metadataJson,
          enabled: true,
          calendarId: config.selectedCalendarId,
        });
        syncedCalendar = Boolean(sync.synced);
      } catch {
        // Miroir calendrier : best-effort
      }
    }

    if (syncedCalendar && config.autoArchiveAfterCalendarSync && config.isProUser) {
      try {
        await updateTrankilV2IntentionArchiveState(intentionId, true);
        void logActivity('CALENDAR_SYNC_ARCHIVE', 0, {
          intention_id: intentionId,
          intention_type: type,
        });
        archived = true;
      } catch {
        // Archivage : best-effort
      }
    }

    if (config.alarmSyncEnabled && config.isProUser) {
      try {
        const alarm = await scheduleTrankilV2IntentionAlarmById(intentionId);
        alarmOk = Boolean(alarm.ok);
      } catch {
        // Alarme : best-effort
      }
    }
  } catch {
    // Enveloppe résiliente
  }

  return { syncedCalendar, archived, alarmOk };
}

export function buildTemporalCaptureRecap(
  introKey: TemporalRecapIntroKey,
  result: PostCaptureEffectsResult,
  translate: (key: string) => string,
): string {
  const parts = [translate(introKey)];
  if (result.syncedCalendar) parts.push(translate('talkDebug.taskQuickRecapCalendar'));
  if (result.archived) parts.push(translate('talkDebug.taskQuickRecapArchive'));
  if (result.alarmOk) parts.push(translate('talkDebug.taskQuickRecapAlarm'));
  return parts.join(' · ');
}
