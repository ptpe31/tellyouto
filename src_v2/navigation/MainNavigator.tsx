import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { Bug, Home, List } from 'lucide-react-native';

import { useTranslation } from '../i18n';
import { HomeScreen } from '../screens/HomeScreen';
import { TimelineScreen } from '../screens/TimelineScreen';
import { TalkDebugScreen } from '../screens/TalkDebugScreen';

export type RootTabsParamList = {
  Home: undefined;
  Timeline: undefined;
  TalkDebug: undefined;
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
          name="TalkDebug"
          component={TalkDebugScreen}
          options={{
            title: t('TAB_DEBUG'),
            tabBarIcon: ({ color, size }) => <Bug color={color} size={size} />,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
