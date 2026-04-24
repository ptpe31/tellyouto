import {
  consumeFreeCaptureSuccessOnce,
  getFreeCaptureQuotaSnapshot,
  type FreeCaptureQuotaSnapshot,
} from '../../../src/api/trankilV2Db';

export type EconomySnapshot = {
  microCapture?: FreeCaptureQuotaSnapshot | null;
  trajetCreditBalance: number;
  hasTrajetUnlimited: boolean;
};

export async function getEconomySnapshot(): Promise<EconomySnapshot> {
  const microCapture = await getFreeCaptureQuotaSnapshot().catch(() => null);
  return { microCapture, trajetCreditBalance: 0, hasTrajetUnlimited: false };
}

export async function consumeTrajetIfNeeded(_: { enableTrafficAdjustment: boolean }): Promise<EconomySnapshot> {
  return getEconomySnapshot();
}

export async function consumeMicroIfNeeded(params: { isProUser: boolean }): Promise<FreeCaptureQuotaSnapshot | null> {
  if (params.isProUser) return getFreeCaptureQuotaSnapshot().catch(() => null);
  return consumeFreeCaptureSuccessOnce().catch(() => null);
}
