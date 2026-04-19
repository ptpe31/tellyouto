import NetInfo from '@react-native-community/netinfo';
import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { countOfflineFirstAiPendingNotes } from '../api';
import { showAppToast } from '../services/appToast';

/**
 * Au lancement et au retour réseau : rappel discret si des notes attendent encore le tri IA.
 */
export function OfflineFirstPendingBootstrap() {
  const { t } = useTranslation();
  const lastNudgeAt = useRef(0);

  const maybeNudge = useCallback(async () => {
    try {
      const n = await countOfflineFirstAiPendingNotes();
      if (n <= 0) return;
      const now = Date.now();
      if (now - lastNudgeAt.current < 12_000) return;
      lastNudgeAt.current = now;
      showAppToast(t('capture.pendingAiNetworkBack', { count: n }), 5200);
    } catch {
      /* ignore */
    }
  }, [t]);

  useEffect(() => {
    void maybeNudge();
    const unsub = NetInfo.addEventListener((state) => {
      if (state.isConnected) void maybeNudge();
    });
    return () => unsub();
  }, [maybeNudge]);

  return null;
}
