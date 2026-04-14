import {
  addRemainingIntents,
  addFlowerBoosts,
  addMagicShakePasses,
  addPshittSprays,
  getTrankilV2UserStats,
  incrementLocalActionStreak,
  incrementBehaviorScores,
  logBonusEvent,
  recordLocalAffinityEvent,
  setLocalActionStreak,
  type BonusEventType,
  type TrankilV2UserStatsRow,
} from '../api/trankilV2Db';
import { STRINGS } from '../constants/Strings';

export type OptimalReward =
  | { mode: 'utility'; bonusType: 'utility_credits'; amount: 2; message: string }
  | { mode: 'utility'; bonusType: 'utility_magic_shake'; amount: 1; message: string }
  | { mode: 'aesthetic'; bonusType: 'aesthetic_flower_boost'; amount: 5; message: string }
  | { mode: 'aesthetic'; bonusType: 'aesthetic_pshitt'; amount: 1; message: string };

export function getOptimalReward(userStats: TrankilV2UserStatsRow): OptimalReward {
  if (userStats.remaining_intents === 0) {
    if (userStats.magic_shake_passes <= 0) {
      return {
        mode: 'utility',
        bonusType: 'utility_magic_shake',
        amount: 1,
        message: STRINGS.BONUS_MESSAGES.utilityMagicShake,
      };
    }
    return {
      mode: 'utility',
      bonusType: 'utility_credits',
      amount: 2,
      message: STRINGS.BONUS_MESSAGES.utilityCredits,
    };
  }
  if (userStats.pshitt_sprays <= 0) {
    return {
      mode: 'aesthetic',
      bonusType: 'aesthetic_pshitt',
      amount: 1,
      message: STRINGS.BONUS_MESSAGES.aestheticPshitt,
    };
  }
  return {
    mode: 'aesthetic',
    bonusType: 'aesthetic_flower_boost',
    amount: 5,
    message: STRINGS.BONUS_MESSAGES.aestheticFlowerBoost,
  };
}

async function applyReward(bonusType: OptimalReward['bonusType']): Promise<void> {
  if (bonusType === 'utility_credits') {
    await addRemainingIntents(2);
    await incrementBehaviorScores({ utilityDelta: 1.2 });
    return;
  }
  if (bonusType === 'utility_magic_shake') {
    await addMagicShakePasses(1);
    return;
  }
  if (bonusType === 'aesthetic_pshitt') {
    await addPshittSprays(1);
    return;
  }
  await addFlowerBoosts(5);
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
  if (accepted) {
    if (bonusType === 'utility_credits' || bonusType === 'utility_magic_shake') {
      await incrementBehaviorScores({ utilityDelta: 0.8 });
      return;
    }
    if (bonusType === 'aesthetic_flower_boost' || bonusType === 'aesthetic_pshitt') {
      await incrementBehaviorScores({ aestheticDelta: 0.8 });
      return;
    }
    return;
  }
  if (bonusType === 'utility_credits' || bonusType === 'utility_magic_shake') {
    await incrementBehaviorScores({ utilityDelta: 0.2 });
    return;
  }
  if (bonusType === 'aesthetic_flower_boost' || bonusType === 'aesthetic_pshitt') {
    await incrementBehaviorScores({ aestheticDelta: -0.3, utilityDelta: 0.25 });
  }
}

export async function onLocalAiValidated(): Promise<{
  streak: number;
  superBonusGranted: boolean;
  message?: string;
}> {
  await recordLocalAffinityEvent(true);
  const next = await incrementLocalActionStreak();
  if (next.local_action_streak >= 5) {
    await addPshittSprays(1);
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

