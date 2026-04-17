import {
  addIaCredits,
  addPendingIaCreditSync,
  getTrankilV2UserStats,
  incrementAdVideosWatched,
  markIaRechargeWatch,
  setAdState,
  setPendingIaCreditSync,
} from '../api/trankilV2Db';
import { syncPendingIntentions } from '../api/syncService';
import { STRINGS } from '../constants/Strings';

export type AdRewardType =
  | typeof STRINGS.AD_REWARDS.REWARD_CLEAN
  | typeof STRINGS.AD_REWARDS.REWARD_SUN;

const AD_COOLDOWN_MS = 90 * 1000;
const IA_RECHARGE_COOLDOWN_MS = 60 * 1000;
const IA_RECHARGE_WINDOW_MS = 24 * 60 * 60 * 1000;
const IA_RECHARGE_DAILY_CAP = 5;

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
  const now = Date.now();
  const before = await getTrankilV2UserStats();
  const lastRecharge = before.recharge_last_video_at ?? 0;
  if (lastRecharge > 0 && now - lastRecharge < IA_RECHARGE_COOLDOWN_MS) {
    return { ok: false, creditsAfter: before.ia_credits, reason: 'recharge_cooldown' };
  }
  const windowStart = before.recharge_window_started_at ?? now;
  const windowExpired = now - windowStart >= IA_RECHARGE_WINDOW_MS;
  const watchedInWindow = windowExpired ? 0 : before.recharge_videos_in_window;
  if (watchedInWindow >= IA_RECHARGE_DAILY_CAP) {
    return { ok: false, creditsAfter: before.ia_credits, reason: 'daily_limit_reached' };
  }

  const gate = await canRunAdSession();
  if (!gate.ok) {
    return { ok: false, creditsAfter: before.ia_credits, reason: gate.reason };
  }
  const watched = await showRewardedAd(STRINGS.AD_REWARDS.REWARD_CLEAN);
  if (!watched) {
    return { ok: false, creditsAfter: before.ia_credits, reason: 'video_cancelled' };
  }
  await markIaRechargeWatch(now);
  const stats = await getTrankilV2UserStats();
  await addIaCredits(5);
  await setAdState({ ad_last_reward_at: now });
  const sync = await syncPendingIntentions();
  if (!sync.ok) {
    await addPendingIaCreditSync(5);
  } else if (stats.pending_sync_ia_credits > 0) {
    await setPendingIaCreditSync(0);
  }
  return { ok: true, creditsAfter: stats.ia_credits + 5 };
}

