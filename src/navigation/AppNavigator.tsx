import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  BarChart3,
  Bot,
  Clock,
  MessageCircle,
  Radar,
} from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';
import {
  AgentIAScreen,
  MessagingScreen,
  RadarScreen,
  StatsScreen,
  TimelineScreen,
} from '../screens';

const Tab = createBottomTabNavigator();

export function AppNavigator() {
  const { t } = useTranslation();
  const theme = useTheme();

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
        component={AgentIAScreen}
        options={{
          title: t('tabs.agent'),
          tabBarIcon: ({ color, size }) => <Bot color={color} size={size} />,
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
    </Tab.Navigator>
  );
}
