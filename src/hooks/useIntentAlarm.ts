import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TrankilV2TimelineItemRow } from '../api';
import { patchMetadata } from '../api/trankilV2Db';
import { AlarmService } from '../services/alarmService';
import type { TripElasticCapsuleModel } from '../utils/tripElasticCapsuleModel';
import {
  formatHmFromUnix,
  isIntentionAlarmWitnessVisible,
  isIntentionDueToday,
  mergeMetadataJsonString,
  readIntentionAlarmSetFlag,
  resolveIntentionAlarmUnixSec,
} from '../utils/intentAlarmTemporal';
import { useProbeScheduleClock } from './useProbeScheduleClock';

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
 * Rappel natif (Horloge OS) : témoin `is_alarm_set` + action `onSetAlarm`.
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

  const alarmFlagSet = useMemo(() => readIntentionAlarmSetFlag(metadataJson), [metadataJson]);

  const witnessClockActive = Boolean(row && alarmFlagSet);
  const nowMs = useProbeScheduleClock(witnessClockActive, 60_000);

  const isAlarmSet = useMemo(() => {
    if (!row) return false;
    return isIntentionAlarmWitnessVisible(metadataJson, row, nowMs, { tripCapsuleModel });
  }, [metadataJson, nowMs, row, tripCapsuleModel]);

  const isDueToday = useMemo(() => (row ? isIntentionDueToday(row) : false), [row]);

  const onSetAlarm = useCallback(async (): Promise<boolean> => {
    if (!row?.id || row.id === 'peek_pending') return false;

    const alarmUnix = resolveIntentionAlarmUnixSec(row, { tripCapsuleModel });
    if (alarmUnix == null) return false;

    const time = formatHmFromUnix(alarmUnix);
    const title = String(row.display_title ?? '').trim() || t('timeline.untitled');
    const label = t('intentAlarm.label', { title, time });

    const opened = await AlarmService.openAlarmSelection(alarmUnix, label);
    if (!opened) return false;

    const patchResult = await patchMetadataFn(row.id, { is_alarm_set: true });
    if (patchResult === false) return false;

    const nextJson = mergeMetadataJsonString(metadataJson, { is_alarm_set: true });
    onMetadataPatched?.(nextJson);
    onPatchRow?.(row.id, { metadata_json: nextJson });
    return true;
  }, [metadataJson, onMetadataPatched, onPatchRow, patchMetadataFn, row, t, tripCapsuleModel]);

  return {
    isAlarmSet,
    isDueToday,
    onSetAlarm,
  };
}
