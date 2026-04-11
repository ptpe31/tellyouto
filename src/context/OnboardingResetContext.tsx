import React, { createContext, useContext } from 'react';

type OnboardingResetContextValue = {
  /** Efface onboarding + spectre AsyncStorage et renvoie vers le diagnostic 5 situations. */
  resetProfileToOnboarding: () => Promise<void>;
};

const OnboardingResetContext = createContext<
  OnboardingResetContextValue | undefined
>(undefined);

export function OnboardingResetProvider({
  children,
  resetProfileToOnboarding,
}: {
  children: React.ReactNode;
  resetProfileToOnboarding: () => Promise<void>;
}) {
  return (
    <OnboardingResetContext.Provider value={{ resetProfileToOnboarding }}>
      {children}
    </OnboardingResetContext.Provider>
  );
}

export function useOnboardingReset() {
  const ctx = useContext(OnboardingResetContext);
  if (!ctx) {
    throw new Error('useOnboardingReset must be used within OnboardingResetProvider');
  }
  return ctx;
}
