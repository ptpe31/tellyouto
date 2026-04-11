import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { FocusCapsuleScreen } from '../components/FocusCapsule';
import { AppNavigator } from './AppNavigator';
import type { MainStackParamList } from './types';

const Stack = createNativeStackNavigator<MainStackParamList>();

export function MainStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={AppNavigator} />
      <Stack.Screen
        name="FocusCapsule"
        component={FocusCapsuleScreen}
        options={{
          presentation: 'fullScreenModal',
          animation: 'fade_from_bottom',
          animationDuration: 560,
        }}
      />
    </Stack.Navigator>
  );
}
