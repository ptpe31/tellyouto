import {
  createNativeStackNavigator,
} from '@react-navigation/native-stack';
import * as SplashScreen from 'expo-splash-screen';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import { ProSubscriptionScreen } from '../screens';
import { MainStack } from './MainStack';
import type { RootStackParamList } from './types';
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
