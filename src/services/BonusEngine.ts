import {
  addIaCredits,
  getTrankilV2UserStats,
  incrementLocalActionStreak,
  logBonusEvent,
  recordLocalAffinityEvent,
  setLocalActionStreak,
  updateGrowth,
  type BonusEventType,
  type TrankilV2UserStatsRow,
} from '../api/trankilV2Db';
import { STRINGS } from '../constants/Strings';

export type OptimalReward =
  | { mode: 'credits'; bonusType: 'ia_credits'; amount: 2; message: string }
  | { mode: 'points'; bonusType: 'zen_points'; amount: 5; message: string };

export function getOptimalReward(userStats: TrankilV2UserStatsRow): OptimalReward {
  if (userStats.ia_credits === 0) {
    return {
      mode: 'credits',
      bonusType: 'ia_credits',
      amount: 2,
      message: STRINGS.BONUS_MESSAGES.utilityCredits,
    };
  }
  return {
    mode: 'points',
    bonusType: 'zen_points',
    amount: 5,
    message: STRINGS.BONUS_MESSAGES.aestheticFlowerBoost,
  };
}

async function applyReward(bonusType: OptimalReward['bonusType']): Promise<void> {
  if (bonusType === 'ia_credits') {
    await addIaCredits(2);
    return;
  }
  await updateGrowth(5);
}

export async function triggerOptimalBonus(): Promise<{ message: string }> {
  const stats = await getTrankilV2UserStats();
  const reward = getOptimalReward(stats);
  await applyReward(reward.bonusType);
  await recordBonusReaction(reward.bonusType as BonusEventType, true);
  return { message: reward.message };
}

export async function recordBonusReaction(
  bonusType: BonusEventType,
  accepted: boolean,
): Promise<void> {
  await logBonusEvent(bonusType, accepted);
  void accepted;
}

export async function onLocalAiValidated(): Promise<{
  streak: number;
  superBonusGranted: boolean;
  message?: string;
}> {
  await recordLocalAffinityEvent(true);
  const next = await incrementLocalActionStreak();
  if (next.local_action_streak >= 5) {
    await updateGrowth(8);
    await setLocalActionStreak(0);
    await logBonusEvent('super_bonus_local_streak', true);
    return {
      streak: 0,
      superBonusGranted: true,
      message: STRINGS.BONUS_MESSAGES.superBonusLocal,
    };
  }
  return { streak: next.local_action_streak, superBonusGranted: false };
}

export async function resetLocalStreakOnExpert(): Promise<void> {
  await recordLocalAffinityEvent(false);
  await setLocalActionStreak(0);
}

