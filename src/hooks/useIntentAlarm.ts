import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TrankilV2TimelineItemRow } from '../api';
import { patchMetadata } from '../api/trankilV2Db';
import { runIntentionAlarmSchedule } from '../services/intentionAlarmSchedule';
import type { TripElasticCapsuleModel } from '../utils/tripElasticCapsuleModel';
import {
  buildIntentAlarmVisibilityDebug,
  hasIntentionSchedulableDueDate,
  isIntentionAlarmWitnessVisible,
  readIntentionAlarmSetFlag,
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

  const alarmFlagSet = useMemo(() => readIntentionAlarmSetFlag(metadataJson), [metadataJson]);

  const witnessClockActive = Boolean(row && alarmFlagSet);
  const nowMs = useProbeScheduleClock(witnessClockActive, 60_000);

  const isAlarmSet = useMemo(() => {
    if (!row) return false;
    return isIntentionAlarmWitnessVisible(metadataJson, row, nowMs, { tripCapsuleModel });
  }, [metadataJson, nowMs, row, tripCapsuleModel]);

  const hasDueDate = useMemo(() => (row ? hasIntentionSchedulableDueDate(row) : false), [row]);

  useEffect(() => {
    if (!__DEV__ || !row?.id) return;
    console.log(
      '[IntentAlarm] useIntentAlarm',
      buildIntentAlarmVisibilityDebug(row, { tripCapsuleModel }),
    );
  }, [row, tripCapsuleModel]);

  const onSetAlarm = useCallback(async (): Promise<boolean> => {
    if (!row?.id || row.id === 'peek_pending') return false;
    return runIntentionAlarmSchedule({
      row,
      translate: t,
      tripCapsuleModel,
      metadataJson,
      patchMetadataFn,
      onMetadataPatched,
      onPatchRow,
    });
  }, [metadataJson, onMetadataPatched, onPatchRow, patchMetadataFn, row, t, tripCapsuleModel]);

  return {
    isAlarmSet,
    hasDueDate,
    onSetAlarm,
  };
}
