import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import * as SplashScreen from 'expo-splash-screen';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import { OnboardingResetProvider } from '../context/OnboardingResetContext';
import {
  USER_SPECTRUM_STORAGE_KEY,
  useUserSpectrum,
} from '../context/UserSpectrumContext';
import { OnboardingScreen, ProSubscriptionScreen } from '../screens';
import { MainStack } from './MainStack';
import { rootNavigationRef } from './rootNavigationRef';
import type { RootStackParamList } from './types';
import {
  ONBOARDING_CHANNELS_SKIPPED_KEY,
  RADAR_CHANNELS_NUDGE_DISMISSED_KEY,
} from '../data/onboardingFlags';
import { touchLocalDatabaseForStartup } from '../api/localDb';
import { markAppInteractive } from '../services/performance';

const ONBOARDING_KEY = '@tellyouto/onboarding_complete';

const Stack = createNativeStackNavigator<RootStackParamList>();

function RootNavigatorInner() {
  const theme = useTheme();
  const { resetSpectrum } = useUserSpectrum();
  const [ready, setReady] = useState(false);
  const [initialRoute, setInitialRoute] = useState<
    keyof RootStackParamList | null
  >(null);

  const refreshRoute = useCallback(async () => {
    const v = await AsyncStorage.getItem(ONBOARDING_KEY);
    setInitialRoute(v === 'true' ? 'App' : 'Onboarding');
    setReady(true);
    /** Ne pas bloquer le TTI sur la file SQLite : ouverture paresseuse après premier rendu. */
    void touchLocalDatabaseForStartup().catch(() => undefined);
  }, []);

  useEffect(() => {
    void refreshRoute();
  }, [refreshRoute]);

  useEffect(() => {
    if (!ready || initialRoute === null) return;
    void SplashScreen.hideAsync();
    markAppInteractive();
  }, [ready, initialRoute]);

  const resetProfileToOnboarding = useCallback(async () => {
    await AsyncStorage.multiRemove([
      ONBOARDING_KEY,
      USER_SPECTRUM_STORAGE_KEY,
      ONBOARDING_CHANNELS_SKIPPED_KEY,
      RADAR_CHANNELS_NUDGE_DISMISSED_KEY,
    ]);
    resetSpectrum();
    if (rootNavigationRef.isReady()) {
      rootNavigationRef.reset({
        index: 0,
        routes: [{ name: 'Onboarding' }],
      });
    }
  }, [resetSpectrum]);

  if (!ready || initialRoute === null) {
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

  return (
    <OnboardingResetProvider resetProfileToOnboarding={resetProfileToOnboarding}>
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Onboarding">
          {({
            navigation,
          }: {
            navigation: NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;
          }) => (
            <OnboardingScreen
              onComplete={async () => {
                await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
                navigation.reset({ index: 0, routes: [{ name: 'App' }] });
              }}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="App" component={MainStack} />
        <Stack.Screen
          name="ProSubscription"
          component={ProSubscriptionScreen}
          options={{
            presentation: 'modal',
            headerShown: false,
            animation: 'slide_from_bottom',
          }}
        />
      </Stack.Navigator>
    </OnboardingResetProvider>
  );
}

export function RootNavigator() {
  return <RootNavigatorInner />;
}
