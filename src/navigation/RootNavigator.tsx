import {
  createNativeStackNavigator,
} from '@react-navigation/native-stack';
import * as SplashScreen from 'expo-splash-screen';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, InteractionManager, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import { ProSubscriptionScreen } from '../screens';
import { MainStack } from './MainStack';
import type { RootStackParamList } from './types';
import { touchLocalDatabaseForStartup } from '../api/localDb';
import { markAppInteractive } from '../services/performance';
import { useSaturation } from '../context/SaturationContext';

const Stack = createNativeStackNavigator<RootStackParamList>();

function RootNavigatorInner() {
  const theme = useTheme();
  const { animationMultiplier } = useSaturation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  /** SQLite après première frame interactive + léger délai pour ne pas concurrencer le TTI */
  useEffect(() => {
    if (!ready) return;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const task = InteractionManager.runAfterInteractions(() => {
      timeoutId = setTimeout(() => {
        void touchLocalDatabaseForStartup().catch(() => undefined);
      }, 500);
    });
    return () => {
      task.cancel();
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    void SplashScreen.hideAsync();
    markAppInteractive();
  }, [ready]);

  if (!ready) {
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
    <Stack.Navigator
      initialRouteName="App"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="App" component={MainStack} />
      <Stack.Screen
        name="ProSubscription"
        component={ProSubscriptionScreen}
        options={{
          presentation: 'modal',
          headerShown: false,
          animation: 'slide_from_bottom',
          animationDuration: Math.round(380 * animationMultiplier),
        }}
      />
    </Stack.Navigator>
  );
}

export function RootNavigator() {
  return <RootNavigatorInner />;
}
