import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { useSaturation } from '../context/SaturationContext';
import { AppNavigator } from './AppNavigator';
import type { MainStackParamList } from './types';

const Stack = createNativeStackNavigator<MainStackParamList>();

export function MainStack() {
  const { animationMultiplier } = useSaturation();
  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false, animationDuration: Math.round(360 * animationMultiplier) }}
    >
      <Stack.Screen name="Tabs" component={AppNavigator} />
    </Stack.Navigator>
  );
}
