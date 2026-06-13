import { useCallback, useMemo, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { TrankilV2TimelineItemRow } from '../api';
import { patchMetadata } from '../api/trankilV2Db';
import { AlarmService } from '../services/alarmService';
import { showAppToast } from '../services/appToast';
import { scheduleOneTapUniversalReminders } from '../services/oneTapUniversalReminders';
import type { TripElasticCapsuleModel } from '../utils/tripElasticCapsuleModel';
import {
  formatHmFromUnix,
  hasIntentionSchedulableDueDate,
  isIntentionAlarmWitnessVisible,
  mergeMetadataJsonString,
  readIntentionAlarmSetFlag,
  resolveIntentionAlarmUnixSec,
  resolveIntentionDueDateTimeIso,
} from '../utils/intentAlarmTemporal';
import { useProbeScheduleClock } from './useProbeScheduleClock';

/** Retour rapide depuis l'horloge native (< 1,5 s) ≈ annulation utilisateur. */
const NATIVE_ALARM_CANCEL_ELAPSED_MS = 1500;

export type UseIntentAlarmOptions = {
  metadataJson?: string | null;
  tripCapsuleModel?: TripElasticCapsuleModel | null;
  onPatchRow?: (id: string, patch: Partial<TrankilV2TimelineItemRow>) => void;
  onMetadataPatched?: (nextMetadataJson: string) => void;
  patchMetadataFn?: (
    id: string,
    partial: Record<string, unknown>,
    opts?: { fromSync?: boolean; silent?: boolean },
  ) => Promise<boolean | void>;
};

/**
 * Alarme universelle : notification locale + horloge OS + témoin `is_alarm_set`.
 * Le témoin disparaît 15 min après l’heure effective de l’intention.
 */
export function useIntentAlarm(
  row: TrankilV2TimelineItemRow | null | undefined,
  options: UseIntentAlarmOptions = {},
) {
  const { t } = useTranslation();
  const {
    metadataJson: metadataJsonOverride,
    tripCapsuleModel = null,
    onPatchRow,
    onMetadataPatched,
    patchMetadataFn = patchMetadata,
  } = options;
  const metadataJson = metadataJsonOverride ?? row?.metadata_json ?? null;
  const nativeResumeListenerRef = useRef<ReturnType<typeof AppState.addEventListener> | null>(null);

  const alarmFlagSet = useMemo(() => readIntentionAlarmSetFlag(metadataJson), [metadataJson]);

  const witnessClockActive = Boolean(row && alarmFlagSet);
  const nowMs = useProbeScheduleClock(witnessClockActive, 60_000);

  const isAlarmSet = useMemo(() => {
    if (!row) return false;
    return isIntentionAlarmWitnessVisible(metadataJson, row, nowMs, { tripCapsuleModel });
  }, [metadataJson, nowMs, row, tripCapsuleModel]);

  const hasDueDate = useMemo(() => (row ? hasIntentionSchedulableDueDate(row) : false), [row]);

  const commitAlarmSet = useCallback(
    async (active: boolean): Promise<boolean> => {
      if (!row?.id || row.id === 'peek_pending') return false;

      const patchResult = await patchMetadataFn(row.id, { is_alarm_set: active });
      if (patchResult === false) return false;

      const nextJson = mergeMetadataJsonString(metadataJson, { is_alarm_set: active });
      onMetadataPatched?.(nextJson);
      onPatchRow?.(row.id, { metadata_json: nextJson });
      return true;
    },
    [metadataJson, onMetadataPatched, onPatchRow, patchMetadataFn, row],
  );

  const clearNativeResumeListener = useCallback(() => {
    nativeResumeListenerRef.current?.remove();
    nativeResumeListenerRef.current = null;
  }, []);

  const onSetAlarm = useCallback(async (): Promise<boolean> => {
    if (!row?.id || row.id === 'peek_pending') return false;

    const alarmUnix = resolveIntentionAlarmUnixSec(row, { tripCapsuleModel });
    const dueDateTimeIso = resolveIntentionDueDateTimeIso(row, { tripCapsuleModel });
    if (alarmUnix == null || !dueDateTimeIso) return false;

    const time = formatHmFromUnix(alarmUnix);
    const title = String(row.display_title ?? '').trim() || t('timeline.untitled');
    const label = t('intentAlarm.label', { title, time });

    clearNativeResumeListener();

    const notifScheduled = await scheduleOneTapUniversalReminders({
      intentionId: row.id,
      title,
      data: { dueDateTime: dueDateTimeIso },
      translate: t,
    });

    const nativeOpened = await AlarmService.openAlarmSelection(alarmUnix, label);

    if (notifScheduled) {
      const committed = await commitAlarmSet(true);
      if (committed) {
        showAppToast(t('intentAlarm.scheduledToast', { time }), 3200);
      }
      return committed;
    }

    if (!nativeOpened) {
      showAppToast(t('intentAlarm.scheduleFailed'), 3200);
      return false;
    }

    const openedAt = Date.now();
    const listener = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') return;
      clearNativeResumeListener();
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
    nativeResumeListenerRef.current = listener;
    setTimeout(() => clearNativeResumeListener(), 120_000);

    return true;
  }, [clearNativeResumeListener, commitAlarmSet, row, t, tripCapsuleModel]);

  return {
    isAlarmSet,
    hasDueDate,
    onSetAlarm,
  };
}
