/**
 * Stack minimal au-dessus des tabs : une seule route `Tabs` → `AppNavigator`.
 *
 * @module navigation/MainStack
 */
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { useSaturation } from '../context/SaturationContext';
import { AppNavigator } from './AppNavigator';
import type { MainStackParamList } from './types';

const Stack = createNativeStackNavigator<MainStackParamList>();

/** Conteneur stack entre la racine et la barre d’onglets. */
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
