import AsyncStorage from '@react-native-async-storage/async-storage';

export type UserTier = 'free' | 'premium';

export type EconomySnapshot = {
  userTier: UserTier;
  microCountDaily: number;
  trajetCreditBalance: number;
  hasTrajetUnlimited: boolean;
};

const KEY_TIER = '@phoenix_v2/user_tier';
const KEY_TRAJET_BALANCE = '@phoenix_v2/trajet_credit_balance';
const KEY_TRAJET_UNLIMITED = '@phoenix_v2/has_trajet_unlimited';

function coerceTier(raw: string | null): UserTier {
  return raw === 'premium' ? 'premium' : 'free';
}

function coerceInt(raw: string | null): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function coerceBool(raw: string | null): boolean {
  return raw === '1' || raw === 'true';
}

export async function getEconomySnapshot(): Promise<EconomySnapshot> {
  const [tierRaw, balanceRaw, unlimitedRaw] = await Promise.all([
    AsyncStorage.getItem(KEY_TIER),
    AsyncStorage.getItem(KEY_TRAJET_BALANCE),
    AsyncStorage.getItem(KEY_TRAJET_UNLIMITED),
  ]);
  return {
    userTier: coerceTier(tierRaw),
    microCountDaily: 0,
    trajetCreditBalance: coerceInt(balanceRaw),
    hasTrajetUnlimited: coerceBool(unlimitedRaw),
  };
}

export async function setEconomySnapshot(patch: Partial<EconomySnapshot>): Promise<EconomySnapshot> {
  const cur = await getEconomySnapshot();
  const next: EconomySnapshot = {
    userTier: patch.userTier ?? cur.userTier,
    microCountDaily: patch.microCountDaily ?? cur.microCountDaily,
    trajetCreditBalance:
      typeof patch.trajetCreditBalance === 'number' && Number.isFinite(patch.trajetCreditBalance)
        ? Math.max(0, Math.floor(patch.trajetCreditBalance))
        : cur.trajetCreditBalance,
    hasTrajetUnlimited: patch.hasTrajetUnlimited ?? cur.hasTrajetUnlimited,
  };
  await Promise.all([
    AsyncStorage.setItem(KEY_TIER, next.userTier),
    AsyncStorage.setItem(KEY_TRAJET_BALANCE, String(next.trajetCreditBalance)),
    AsyncStorage.setItem(KEY_TRAJET_UNLIMITED, next.hasTrajetUnlimited ? '1' : '0'),
  ]);
  return next;
}

export async function consumeTrajetIfNeeded(params: { enableTrafficAdjustment: boolean }): Promise<EconomySnapshot> {
  const cur = await getEconomySnapshot();
  if (!params.enableTrafficAdjustment) return cur;
  if (cur.hasTrajetUnlimited) return cur;
  if (cur.trajetCreditBalance <= 0) return cur;
  return setEconomySnapshot({ trajetCreditBalance: cur.trajetCreditBalance - 1 });
}

