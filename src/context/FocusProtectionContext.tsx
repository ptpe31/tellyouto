import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

/**
 * Mode « Protection » : terrain préparé pour réduire les interruptions pendant une Capsule.
 * (Simulation côté notifications — brancher expo-notifications plus tard.)
 */
type FocusProtectionContextValue = {
  isProtectionActive: boolean;
  setProtectionActive: (v: boolean) => void;
};

const FocusProtectionContext = createContext<
  FocusProtectionContextValue | undefined
>(undefined);

export function FocusProtectionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isProtectionActive, setProtectionActive] = useState(false);

  const setProtectionActive = useCallback((v: boolean) => {
    setProtectionActive(v);
  }, []);

  const value = useMemo(
    () => ({ isProtectionActive, setProtectionActive }),
    [isProtectionActive, setProtectionActive],
  );

  return (
    <FocusProtectionContext.Provider value={value}>
      {children}
    </FocusProtectionContext.Provider>
  );
}

export function useFocusProtection() {
  const ctx = useContext(FocusProtectionContext);
  if (!ctx) {
    throw new Error(
      'useFocusProtection must be used within FocusProtectionProvider',
    );
  }
  return ctx;
}
