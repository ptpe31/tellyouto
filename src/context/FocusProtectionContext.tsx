import React, { createContext, useContext, useMemo, useState } from 'react';

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

  const value = useMemo(
    () => ({ isProtectionActive, setProtectionActive }),
    [isProtectionActive],
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
