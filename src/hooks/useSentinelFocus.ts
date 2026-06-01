import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TrankilV2TimelineItemRow } from '../api';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import {
  hasSentinelFocusClockInterest,
  isSentinelFocusSlotVisible,
  pickSentinelFocus,
  type SentinelFocusPick,
} from '../utils/sentinelFocusSelection';
import { useProbeScheduleClock } from './useProbeScheduleClock';

export type UseSentinelFocusOptions = {
  rows: TrankilV2TimelineItemRow[];
  todayYmd: string;
};

export type UseSentinelFocusResult = SentinelFocusPick & {
  visible: boolean;
};

/** Priorité 1 : scan actif · Priorité 2 : suggestion de configuration Sentinel. */
export function useSentinelFocus({ rows, todayYmd }: UseSentinelFocusOptions): UseSentinelFocusResult {
  const { i18n } = useTranslation();
  const { spectrum } = useUserSpectrum();
  const isProUser = spectrum.isProUser;

  const clockActive = useMemo(
    () => hasSentinelFocusClockInterest(rows, { todayYmd, isProUser, locale: i18n.language }),
    [rows, todayYmd, isProUser, i18n.language],
  );

  const nowMs = useProbeScheduleClock(clockActive, 10_000);

  const pick = useMemo(
    () =>
      pickSentinelFocus(rows, {
        todayYmd,
        isProUser,
        locale: i18n.language,
        nowMs,
      }),
    [rows, todayYmd, isProUser, i18n.language, nowMs],
  );

  const visible = isSentinelFocusSlotVisible(pick, {
    locale: i18n.language,
    isProUser,
    nowMs,
    todayYmd,
  });

  return {
    ...pick,
    visible,
  };
}
