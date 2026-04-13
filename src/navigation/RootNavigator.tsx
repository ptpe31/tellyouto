import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { touchLocalDatabaseForStartup } from '../api/localDb';
import { markAppInteractive } from '../services/performance';

const Stack = createNativeStackNavigator<RootStackParamList>();

function RootNavigatorInner() {
  const theme = useTheme();
  const [ready, setReady] = useState(false);

  const refreshRoute = useCallback(async () => {
    await AsyncStorage.setItem('@tellyouto/onboarding_complete', 'true');
    setReady(true);
    void touchLocalDatabaseForStartup().catch(() => undefined);
  }, []);

  useEffect(() => {
    void refreshRoute();
  }, [refreshRoute]);

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
    <Stack.Navigator initialRouteName="App" screenOptions={{ headerShown: false }}>
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
  );
}

export function RootNavigator() {
  return <RootNavigatorInner />;
}
