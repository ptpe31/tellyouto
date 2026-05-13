/**
 * Onglets principaux : **TalkDebug** (capture / one-tap), **Timeline** (SQLite), **Debug** (outils).
 * `initialRouteName` Talk — voir `PROJECT_STATUS.md` §1.2.
 *
 * @module navigation/AppNavigator
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Bug, CalendarDays, MessageCircle } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { useTheme } from 'react-native-paper';

import {
  DebugScreen,
  TimelineScreen,
  TalkDebugScreen,
} from '../screens';
import type { AppTabParamList } from './types';

const Tab = createBottomTabNavigator<AppTabParamList>();

/** Bottom tabs : Talk (capture), Timeline, Debug. */
export function AppNavigator() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isWeb = Platform.OS === 'web';

  return (
    <Tab.Navigator
      initialRouteName="TalkDebug"
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceDisabled,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.outlineVariant,
          display: isWeb ? 'none' : 'flex',
        },
      }}
    >
      <Tab.Screen
        name="TalkDebug"
        component={TalkDebugScreen}
        options={{
          headerShown: false,
          title: t('tabs.talkHome'),
          tabBarIcon: ({ color, size }) => (
            <MessageCircle color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Timeline"
        component={TimelineScreen}
        options={{
          headerTitle: '',
          tabBarLabel: t('timeline.title'),
          tabBarIcon: ({ color, size }) => (
            <CalendarDays color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Debug"
        component={DebugScreen}
        options={{
          title: t('tabs.debug'),
          tabBarIcon: ({ color, size }) => (
            <Bug color={color} size={size} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
