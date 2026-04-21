import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { Home, List, Settings } from 'lucide-react-native';

import { useTranslation } from '../i18n';
import { HomeScreen } from '../screens/HomeScreen';
import { TimelineScreen } from '../screens/TimelineScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type RootTabsParamList = {
  Home: undefined;
  Timeline: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<RootTabsParamList>();

export function MainNavigator() {
  const { t } = useTranslation();
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: '#0b1220', borderTopColor: 'rgba(148,163,184,0.18)' },
          tabBarActiveTintColor: '#f8fafc',
          tabBarInactiveTintColor: 'rgba(226,232,240,0.62)',
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            title: t('TAB_HOME'),
            tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Timeline"
          component={TimelineScreen}
          options={{
            title: t('TAB_TIMELINE'),
            tabBarIcon: ({ color, size }) => <List color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            title: t('TAB_SETTINGS'),
            tabBarIcon: ({ color, size }) => <Settings color={color} size={size} />,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

