import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { AgentIAScreen } from '../screens/AgentIAScreen';
import { AgentSettingsScreen } from '../screens/AgentSettingsScreen';

export type AgentStackParamList = {
  AgentMain: undefined;
  AgentSettings: undefined;
};

const Stack = createNativeStackNavigator<AgentStackParamList>();

export function AgentStack() {
  const { t } = useTranslation();

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: true,
      }}
    >
      <Stack.Screen
        name="AgentMain"
        component={AgentIAScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AgentSettings"
        component={AgentSettingsScreen}
        options={{ title: t('ally.settingsTitle') }}
      />
    </Stack.Navigator>
  );
}
