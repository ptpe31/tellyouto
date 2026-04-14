import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { FocusCapsuleScreen } from '../components/FocusCapsule';
import { useSaturation } from '../context/SaturationContext';
import { SemanticBrainLabScreen } from '../screens/SemanticBrainLabScreen';
import { AppNavigator } from './AppNavigator';
import type { MainStackParamList } from './types';

const Stack = createNativeStackNavigator<MainStackParamList>();

export function MainStack() {
  const { t } = useTranslation();
  const { animationMultiplier } = useSaturation();
  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false, animationDuration: Math.round(360 * animationMultiplier) }}
    >
      <Stack.Screen name="Tabs" component={AppNavigator} />
      <Stack.Screen
        name="FocusCapsule"
        component={FocusCapsuleScreen}
        options={{
          presentation: 'fullScreenModal',
          animation: 'fade_from_bottom',
          animationDuration: Math.round(560 * animationMultiplier),
        }}
      />
      <Stack.Screen
        name="SemanticBrainLab"
        component={SemanticBrainLabScreen}
        options={{
          headerShown: true,
          title: t('navigation.semanticBrainLabHeader'),
          presentation: 'card',
        }}
      />
    </Stack.Navigator>
  );
}
