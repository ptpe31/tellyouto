import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import { OnboardingScreen } from '../screens';
import { MainStack } from './MainStack';

const ONBOARDING_KEY = '@tellyouto/onboarding_complete';

export function RootNavigator() {
  const theme = useTheme();
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

  if (done === null) {
    return (
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
    );
  }

  if (!done) {
    return <OnboardingScreen onComplete={handleOnboardingComplete} />;
  }

  return <MainStack />;
}
