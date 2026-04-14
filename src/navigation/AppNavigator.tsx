import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  BarChart3,
  Flower2,
  House,
  Leaf,
  Shuffle,
} from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';
import { ZenGardenScreen } from '../modules/zenGarden';
import {
  MeliMeloScreen,
  StatsScreen,
  TalkHomeScreen,
  HerbierCollectionScreen,
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
        name="MeliMelo"
        component={MeliMeloScreen}
        options={{
          headerShown: false,
          title: t('tabs.meliMelo'),
          tabBarIcon: ({ color, size }) => (
            <Shuffle color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="ZenGarden"
        component={ZenGardenScreen}
        options={{
          headerShown: false,
          title: t('tabs.zenGarden'),
          tabBarIcon: ({ color, size }) => (
            <Leaf color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Herbier"
        component={HerbierCollectionScreen}
        options={{
          headerShown: false,
          title: 'Collection',
          tabBarIcon: ({ color, size }) => (
            <Flower2 color={color} size={size} />
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
