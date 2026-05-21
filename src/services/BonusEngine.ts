/**
 * Moteur de bonus (crédits IA, zen_points, streak local).
 * Les fonctions « optimal reward » liées au nudge disponibilité sont DEPRECATED — voir nettoyage-code-mort.md (§4).
 */
import {
  incrementLocalActionStreak,
  logBonusEvent,
  recordLocalAffinityEvent,
  setLocalActionStreak,
  updateGrowth,
} from '../api/trankilV2Db';
import { STRINGS } from '../constants/Strings';

/* DEPRECATED — nudge « 2 minutes disponibles » (AvailabilityNudgeModal)
export type OptimalReward =
  | { mode: 'credits'; bonusType: 'ia_credits'; amount: 2; message: string }
  | { mode: 'points'; bonusType: 'zen_points'; amount: 5; message: string };

export function getOptimalReward(userStats: TrankilV2UserStatsRow): OptimalReward { ... }

async function applyReward(bonusType: OptimalReward['bonusType']): Promise<void> { ... }

export async function triggerOptimalBonus(): Promise<{ message: string }> { ... }

export async function recordBonusReaction(
  bonusType: BonusEventType,
  accepted: boolean,
): Promise<void> { ... }
*/

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
