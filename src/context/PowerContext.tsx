import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

/**
 * Contexte « puissance » adaptative : budget d’attention / mode sobre pour l’agent.
 * Placeholder extensible (batterie, réseau, foreground).
 */
type PowerContextValue = {
  /** 0–1 capacité disponible pour tâches non critiques */
  energyScore: number;
  /** Réduit animations / sync en arrière-plan */
  isLowPower: boolean;
  setEnergyScore: (n: number) => void;
  setLowPower: (v: boolean) => void;
};

const PowerContext = createContext<PowerContextValue | undefined>(undefined);

export function PowerProvider({ children }: { children: React.ReactNode }) {
  const [energyScore, setEnergyScoreState] = useState(1);
  const [isLowPower, setLowPower] = useState(false);

  const setEnergyScore = useCallback((n: number) => {
    setEnergyScoreState(Math.min(1, Math.max(0, n)));
  }, []);

  const value = useMemo(
    () => ({
      energyScore,
      isLowPower,
      setEnergyScore,
      setLowPower,
    }),
    [energyScore, isLowPower, setEnergyScore, setLowPower],
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
