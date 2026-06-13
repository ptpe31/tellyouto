import { AppState, type AppStateStatus } from 'react-native';

import type { TrankilV2TimelineItemRow } from '../api';
import { patchMetadata } from '../api/trankilV2Db';
import { AlarmService } from './alarmService';
import { showAppToast } from './appToast';
import { scheduleOneTapUniversalReminders } from './oneTapUniversalReminders';
import type { TripElasticCapsuleModel } from '../utils/tripElasticCapsuleModel';
import {
  formatHmFromUnix,
  mergeMetadataJsonString,
  resolveIntentionAlarmUnixSec,
  resolveIntentionDueDateTimeIso,
} from '../utils/intentAlarmTemporal';

const NATIVE_ALARM_CANCEL_ELAPSED_MS = 1500;

type Translate = (key: string, options?: Record<string, string | number>) => string;

export async function runIntentionAlarmSchedule(params: {
  row: TrankilV2TimelineItemRow;
  translate: Translate;
  tripCapsuleModel?: TripElasticCapsuleModel | null;
  metadataJson?: string | null;
  patchMetadataFn?: (
    id: string,
    partial: Record<string, unknown>,
    opts?: { fromSync?: boolean; silent?: boolean },
  ) => Promise<boolean | void>;
  onMetadataPatched?: (nextMetadataJson: string) => void;
  onPatchRow?: (id: string, patch: Partial<TrankilV2TimelineItemRow>) => void;
}): Promise<boolean> {
  const {
    row,
    translate: t,
    tripCapsuleModel = null,
    metadataJson = row.metadata_json ?? null,
    patchMetadataFn = patchMetadata,
    onMetadataPatched,
    onPatchRow,
  } = params;

  if (!row.id || row.id === 'peek_pending') return false;

  const alarmUnix = resolveIntentionAlarmUnixSec(row, { tripCapsuleModel });
  const dueDateTimeIso = resolveIntentionDueDateTimeIso(row, { tripCapsuleModel });
  if (alarmUnix == null || !dueDateTimeIso) return false;

  const time = formatHmFromUnix(alarmUnix);
  const title = String(row.display_title ?? '').trim() || t('timeline.untitled');
  const label = t('intentAlarm.label', { title, time });

  const commitAlarmSet = async (active: boolean): Promise<boolean> => {
    const patchResult = await patchMetadataFn(row.id, { is_alarm_set: active });
    if (patchResult === false) return false;
    const nextJson = mergeMetadataJsonString(metadataJson, { is_alarm_set: active });
    onMetadataPatched?.(nextJson);
    onPatchRow?.(row.id, { metadata_json: nextJson });
    return true;
  };

  const notifScheduled = await scheduleOneTapUniversalReminders({
    intentionId: row.id,
    title,
    data: { dueDateTime: dueDateTimeIso },
    translate: t,
  });

  const nativeOpened = await AlarmService.openAlarmSelection(alarmUnix, label);

  if (notifScheduled) {
    const committed = await commitAlarmSet(true);
    if (committed) showAppToast(t('intentAlarm.scheduledToast', { time }), 3200);
    return committed;
  }

  if (!nativeOpened) {
    showAppToast(t('intentAlarm.scheduleFailed'), 3200);
    return false;
  }

  const openedAt = Date.now();
  const listener = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next !== 'active') return;
    listener.remove();
    const elapsed = Date.now() - openedAt;
    if (elapsed < NATIVE_ALARM_CANCEL_ELAPSED_MS) {
      void commitAlarmSet(false);
      showAppToast(t('intentAlarm.alarmCancelled'), 2800);
      return;
    }
    void commitAlarmSet(true).then((ok) => {
      if (ok) showAppToast(t('intentAlarm.openClockHint', { time }), 3200);
    });
  });
  setTimeout(() => listener.remove(), 120_000);

  return true;
}
