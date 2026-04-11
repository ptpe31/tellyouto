import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  BarChart3,
  Bot,
  Bug,
  Clock,
  MessageCircle,
  Radar,
  Sparkles,
} from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';
import {
  DebugScreen,
  MessagingScreen,
  RadarScreen,
  RechargeScreen,
  StatsScreen,
  TimelineScreen,
} from '../screens';
import { IS_PRODUCTION } from '../config/appConfig';
import { useDebugUnlock } from '../context/DebugUnlockContext';
import { AgentStack } from './AgentStack';

const Tab = createBottomTabNavigator();

export function AppNavigator() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { unlocked: debugUnlocked } = useDebugUnlock();
  const showDebugTab = !IS_PRODUCTION || debugUnlocked;

  return (
    <Tab.Navigator
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
        name="Radar"
        component={RadarScreen}
        options={{
          title: t('tabs.radar'),
          tabBarIcon: ({ color, size }) => (
            <Radar color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Timeline"
        component={TimelineScreen}
        options={{
          title: t('tabs.timeline'),
          tabBarIcon: ({ color, size }) => (
            <Clock color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="AgentIA"
        component={AgentStack}
        options={{
          title: t('tabs.agent'),
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Bot color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Recharge"
        component={RechargeScreen}
        options={{
          title: t('tabs.recharge'),
          tabBarIcon: ({ color, size }) => (
            <Sparkles color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Messaging"
        component={MessagingScreen}
        options={{
          title: t('tabs.messaging'),
          tabBarIcon: ({ color, size }) => (
            <MessageCircle color={color} size={size} />
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
      {showDebugTab && (
        <Tab.Screen
          name="Debug"
          component={DebugScreen}
          options={{
            tabBarLabel: t('tabs.debug'),
            headerTitle: t('debug.pilotTitle'),
            tabBarIcon: ({ color, size }) => <Bug color={color} size={size} />,
          }}
        />
      )}
    </Tab.Navigator>
  );
}
