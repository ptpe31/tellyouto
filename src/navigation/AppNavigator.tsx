import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  BarChart3,
  House,
} from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';
import {
  StatsScreen,
  TalkHomeScreen,
} from '../screens';
import type { AppTabParamList } from './types';

const Tab = createBottomTabNavigator<AppTabParamList>();

export function AppNavigator() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Tab.Navigator
      initialRouteName="TalkHome"
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceDisabled,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.outlineVariant,
        },
      }}
    >
      <Tab.Screen
        name="TalkHome"
        component={TalkHomeScreen}
        options={{
          headerShown: false,
          title: t('tabs.talkHome'),
          tabBarIcon: ({ color, size }) => (
            <House color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Stats"
        component={StatsScreen}
        options={{
          title: t('tabs.stats'),
          tabBarIcon: ({ color, size }) => (
            <BarChart3 color={color} size={size} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
