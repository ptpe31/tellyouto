import {
  addIaCredits,
  getTrankilV2UserStats,
  incrementAdVideosWatched,
  setAdState,
} from '../api/trankilV2Db';
import { STRINGS } from '../constants/Strings';

export type AdRewardType =
  | typeof STRINGS.AD_REWARDS.REWARD_CLEAN
  | typeof STRINGS.AD_REWARDS.REWARD_SUN;

const AD_COOLDOWN_MS = 90 * 1000;

export async function canRunAdSession(): Promise<{ ok: boolean; reason?: string }> {
  const stats = await getTrankilV2UserStats();
  if (
    stats.ad_last_reward_at != null &&
    Date.now() - stats.ad_last_reward_at < AD_COOLDOWN_MS
  ) {
    return { ok: false, reason: STRINGS.ads.cooldownActive };
  }
  return { ok: true };
}

/** Mock rewarded ad provider. */
export async function showRewardedAd(_rewardType: AdRewardType): Promise<boolean> {
  await new Promise((r) => setTimeout(r, 1200));
  await incrementAdVideosWatched(1);
  return true;
}

export async function applyAdReward(rewardType: AdRewardType) {
  const now = Date.now();
  if (rewardType === STRINGS.AD_REWARDS.REWARD_CLEAN) {
    await addIaCredits(3);
    return setAdState({ ad_last_reward_at: now });
  }
  await addIaCredits(1);
  return setAdState({ ad_last_reward_at: now });
}

export async function getSuggestedAdRewardType(): Promise<AdRewardType> {
  await getTrankilV2UserStats();
  return STRINGS.AD_REWARDS.REWARD_CLEAN;
}

export async function runManualIaRechargeVideo(): Promise<{
  ok: boolean;
  creditsAfter: number;
  reason?: string;
}> {
  const gate = await canRunAdSession();
  if (!gate.ok) {
    const stats = await getTrankilV2UserStats();
    return { ok: false, creditsAfter: stats.ia_credits, reason: gate.reason };
  }
  const watched = await showRewardedAd(STRINGS.AD_REWARDS.REWARD_CLEAN);
  if (!watched) {
    const stats = await getTrankilV2UserStats();
    return { ok: false, creditsAfter: stats.ia_credits, reason: 'video_cancelled' };
  }
  const stats = await getTrankilV2UserStats();
  await addIaCredits(5);
  await setAdState({ ad_last_reward_at: Date.now() });
  return { ok: true, creditsAfter: stats.ia_credits + 5 };
}

