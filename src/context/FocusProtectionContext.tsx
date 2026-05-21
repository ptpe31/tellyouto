import React, { createContext, useContext, useMemo, useState } from 'react';

/**
 * Mode « Protection » : terrain préparé pour réduire les interruptions pendant une Capsule.
 * DEPRECATED côté effet : `useFocusProtection` n’est appelé nulle part (§12 nettoyage-code-mort.md).
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
