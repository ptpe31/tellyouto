import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TrankilV2TimelineItemRow } from '../api';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import { pickSentinelFocus, type SentinelFocusPick } from '../utils/sentinelFocusSelection';

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

  const pick = useMemo(
    () =>
      pickSentinelFocus(rows, {
        todayYmd,
        isProUser,
        locale: i18n.language,
      }),
    [rows, todayYmd, isProUser, i18n.language],
  );

  const visible = Boolean(pick.activeTrip ?? pick.unconfiguredTrip);

  return {
    ...pick,
    visible,
  };
}
