import {
  getTrankilV2UserStats,
  incrementAdVideosWatched,
  incrementBehaviorScores,
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
  const stats = await getTrankilV2UserStats();
  const now = Date.now();
  if (rewardType === STRINGS.AD_REWARDS.REWARD_CLEAN) {
    return setAdState({
      remaining_intents: 10,
      weather_mode: 'CLOUDY',
      vibrancy_mode: 0.82,
      ad_last_reward_at: now,
      ad_video_streak: Math.max(1, stats.ad_video_streak + 1),
    });
  }
  const next = await setAdState({
    weather_mode: 'SUNNY',
    vibrancy_mode: 1.0,
    flower_boosts: stats.flower_boosts + 3,
    ad_last_reward_at: now,
    ad_video_streak: 0,
  });
  await incrementBehaviorScores({ aestheticDelta: 1.4 });
  return next;
}

export async function getSuggestedAdRewardType(): Promise<AdRewardType> {
  const stats = await getTrankilV2UserStats();
  if (stats.weather_mode === 'CLOUDY' && stats.ad_video_streak >= 1) {
    return STRINGS.AD_REWARDS.REWARD_SUN;
  }
  return STRINGS.AD_REWARDS.REWARD_CLEAN;
}

