import { DeviceEventEmitter } from 'react-native';

import type { TrankilV2TimelineItemRow } from '../../api';
import { patchMetadata, trankilV2SqliteBarrier, updateTrankilV2IntentionRemindToLeave } from '../../api/trankilV2Db';
import { INTENTIONS_CHANGED_EVENT_NAME } from '../../constants/intentionEvents';
import type { TripSurveillanceUiState } from '../../utils/tripSurveillanceButton';
import { isPass2UnlockedMeta } from '../../utils/tripTimelineCard';
import { cancelTripMission } from './sentinelTripMission';
import { reconcileSentinelForIntentionIdImmediate } from './sentinelReconciler';

const PASS2_UNLOCKED = 1;

export type TripSurveillanceToggleResult =
  | 'toggled_on'
  | 'toggled_off'
  | 'pro_redirect'
  | 'incomplete'
  | 'noop';

function safeParseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mergePass2Unlocked(metadataJson: string | null | undefined): string {
  const root = safeParseJsonObject(metadataJson) ?? {};
  return JSON.stringify({ ...root, pass2_unlocked: PASS2_UNLOCKED });
}

export async function toggleTripSurveillanceForRow(input: {
  row: TrankilV2TimelineItemRow;
  uiState: TripSurveillanceUiState;
}): Promise<{
  result: TripSurveillanceToggleResult;
  patch?: Partial<TrankilV2TimelineItemRow>;
}> {
  const { row, uiState } = input;

  if (uiState === 'all_day') return { result: 'noop' };
  if (uiState === 'free_locked') return { result: 'pro_redirect' };
  if (uiState === 'pro_incomplete') return { result: 'incomplete' };

  if (uiState === 'pro_active') {
    await updateTrankilV2IntentionRemindToLeave(row.id, false);
    await cancelTripMission(row.id);
    return {
      result: 'toggled_off',
      patch: { remind_to_leave: 0 },
    };
  }

  await updateTrankilV2IntentionRemindToLeave(row.id, true, { silent: true });
  await trankilV2SqliteBarrier();
  await reconcileSentinelForIntentionIdImmediate(row.id);
  DeviceEventEmitter.emit(INTENTIONS_CHANGED_EVENT_NAME, {
    source: 'trankil_v2',
    id: row.id,
    reason: 'user_edit',
  });

  const meta = safeParseJsonObject(row.metadata_json);
  const patch: Partial<TrankilV2TimelineItemRow> = { remind_to_leave: 1 };
  if (!isPass2UnlockedMeta(meta)) {
    await patchMetadata(row.id, { pass2_unlocked: PASS2_UNLOCKED });
    patch.metadata_json = mergePass2Unlocked(row.metadata_json);
  }

  return { result: 'toggled_on', patch };
}
