import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getHerbierCount, getTrankilV2UnorganizedCount, getTrankilV2UserStats } from '../api/trankilV2Db';

type SaturationContextValue = {
  isSaturated: boolean;
  animationMultiplier: number;
  interactionDelayMs: number;
  runWithWeight: (fn: () => void, options?: { bypass?: boolean }) => void;
  clearSaturationPulse: () => void;
};

const SaturationContext = createContext<SaturationContextValue | null>(null);

const INSECT_TIME_PENALTY_MS = 48 * 60 * 60 * 1000;

function estimateSwarmCount(
  unorganizedCount: number,
  lastOrganizeAt: number | null,
  hasPrestige: boolean,
  debugSpawn: number,
): number {
  let base = 0;
  if (unorganizedCount >= 4 && unorganizedCount <= 7) base = 3;
  else if (unorganizedCount > 7) base = 10;
  const stale = lastOrganizeAt != null && Date.now() - lastOrganizeAt > INSECT_TIME_PENALTY_MS;
  const raw = base + (stale ? 5 : 0) + Math.max(0, debugSpawn || 0);
  return hasPrestige ? Math.max(0, Math.floor(raw * 0.8)) : raw;
}

export function SaturationProvider({ children }: { children: React.ReactNode }) {
  const [isSaturated, setIsSaturated] = useState(false);
  const reliefUntilRef = useRef(0);

  const refresh = useCallback(async () => {
    if (Date.now() < reliefUntilRef.current) {
      setIsSaturated(false);
      return;
    }
    const [stats, unorganized, herbier] = await Promise.all([
      getTrankilV2UserStats(),
      getTrankilV2UnorganizedCount(),
      getHerbierCount(),
    ]);
    const swarm = estimateSwarmCount(
      unorganized,
      stats.last_organize_at,
      herbier > 3,
      stats.debug_spawn_flies,
    );
    setIsSaturated(stats.remaining_intents === 0 && swarm >= 8);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [refresh]);

  const clearSaturationPulse = useCallback(() => {
    reliefUntilRef.current = Date.now() + 2500;
    setIsSaturated(false);
  }, []);

  const runWithWeight = useCallback(
    (fn: () => void, options?: { bypass?: boolean }) => {
      if (options?.bypass || !isSaturated) {
        fn();
        return;
      }
      setTimeout(fn, 100);
    },
    [isSaturated],
  );

  const value = useMemo<SaturationContextValue>(
    () => ({
      isSaturated,
      animationMultiplier: isSaturated ? 1.5 : 1,
      interactionDelayMs: isSaturated ? 100 : 0,
      runWithWeight,
      clearSaturationPulse,
    }),
    [clearSaturationPulse, isSaturated, runWithWeight],
  );

  return <SaturationContext.Provider value={value}>{children}</SaturationContext.Provider>;
}

export function useSaturation() {
  const ctx = useContext(SaturationContext);
  if (!ctx) {
    throw new Error('useSaturation must be used inside SaturationProvider');
  }
  return ctx;
}

