import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { DeviceEventEmitter } from 'react-native';

import { DATABASE_RESET_COMPLETE_EVENT } from '../api/localDb';
import {
  loadPowerState,
  savePowerState,
} from '../api/powerStorage';

/**
 * Énergie du co-pilote : score 0–1 + réservoir de secondes pour l’agent (recharges).
 * Persistance locale (AsyncStorage) via powerStorage.
 */
type PowerContextValue = {
  /** 0–1 capacité ressentie pour l’interface */
  energyScore: number;
  /** Secondes créditées à l’agent (récompenses recharge) */
  agentEnergySeconds: number;
  isLowPower: boolean;
  setEnergyScore: (n: number) => void;
  setLowPower: (v: boolean) => void;
  /** Ajoute du temps-agent après une pause sensorielle réussie */
  addAgentEnergySeconds: (seconds: number) => void;
  /** Boost léger du score (ex. après recharge) */
  boostEnergyScore: (delta: number) => void;
};

const PowerContext = createContext<PowerContextValue | undefined>(undefined);

export function PowerProvider({ children }: { children: React.ReactNode }) {
  const [energyScore, setEnergyScoreState] = useState(1);
  const [agentEnergySeconds, setAgentEnergySeconds] = useState(0);
  const [isLowPower, setLowPower] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await loadPowerState();
      if (cancelled) return;
      setEnergyScoreState(s.energyScore);
      setAgentEnergySeconds(s.agentEnergySeconds);
      setLowPower(s.isLowPower);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void savePowerState({
      energyScore,
      agentEnergySeconds,
      isLowPower,
    });
  }, [energyScore, agentEnergySeconds, isLowPower, hydrated]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      DATABASE_RESET_COMPLETE_EVENT,
      () => {
        setEnergyScoreState(1);
        setAgentEnergySeconds(0);
        setLowPower(false);
        setHydrated(true);
      },
    );
    return () => sub.remove();
  }, []);

  const setEnergyScore = useCallback((n: number) => {
    setEnergyScoreState(Math.min(1, Math.max(0, n)));
  }, []);

  const addAgentEnergySeconds = useCallback((seconds: number) => {
    const add = Math.max(0, Math.round(seconds));
    setAgentEnergySeconds((prev) => prev + add);
  }, []);

  const boostEnergyScore = useCallback((delta: number) => {
    setEnergyScoreState((prev) => Math.min(1, Math.max(0, prev + delta)));
  }, []);

  const value = useMemo(
    () => ({
      energyScore,
      agentEnergySeconds,
      isLowPower,
      setEnergyScore,
      setLowPower,
      addAgentEnergySeconds,
      boostEnergyScore,
    }),
    [
      energyScore,
      agentEnergySeconds,
      isLowPower,
      setEnergyScore,
      addAgentEnergySeconds,
      boostEnergyScore,
    ],
  );

  return (
    <PowerContext.Provider value={value}>{children}</PowerContext.Provider>
  );
}

export function usePower() {
  const ctx = useContext(PowerContext);
  if (!ctx) {
    throw new Error('usePower must be used within PowerProvider');
  }
  return ctx;
}
