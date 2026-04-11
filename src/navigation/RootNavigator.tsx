import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import { OnboardingResetProvider } from '../context/OnboardingResetContext';
import {
  USER_SPECTRUM_STORAGE_KEY,
  useUserSpectrum,
} from '../context/UserSpectrumContext';
import { OnboardingScreen } from '../screens';
import { MainStack } from './MainStack';

const ONBOARDING_KEY = '@tellyouto/onboarding_complete';

function RootNavigatorInner() {
  const theme = useTheme();
  const { resetSpectrum } = useUserSpectrum();
  const [done, setDone] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    const v = await AsyncStorage.getItem(ONBOARDING_KEY);
    setDone(v === 'true');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleOnboardingComplete = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    setDone(true);
  }, []);

  const resetProfileToOnboarding = useCallback(async () => {
    await AsyncStorage.multiRemove([
      ONBOARDING_KEY,
      USER_SPECTRUM_STORAGE_KEY,
    ]);
    resetSpectrum();
    setDone(false);
  }, [resetSpectrum]);

  const body =
    done === null ? (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.background,
        }}
      >
        <ActivityIndicator color={theme.colors.primary} size="large" />
      </View>
    ) : !done ? (
      <OnboardingScreen onComplete={handleOnboardingComplete} />
    ) : (
      <MainStack />
    );

  return (
    <OnboardingResetProvider
      resetProfileToOnboarding={resetProfileToOnboarding}
    >
      {body}
    </OnboardingResetProvider>
  );
}

export function RootNavigator() {
  return <RootNavigatorInner />;
}
