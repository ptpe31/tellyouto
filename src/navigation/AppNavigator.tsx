import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';
import { BarChart3, Bug, CalendarDays, House, Mic } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DeviceEventEmitter,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { useTheme } from 'react-native-paper';

import {
  DATABASE_RESET_COMPLETE_EVENT,
  INTENTIONS_CHANGED_EVENT_NAME,
  LOCAL_DB_RESET_EVENT,
} from '../api/localDb';
import { DATA_CHANGED_EVENT } from '../constants/appEvents';
import { DebugScreen, StatsScreen, TimelineScreen, TalkDebugScreen } from '../screens';
import { canShowStats } from '../services/userProfilingService';
import { rootNavigationRef } from './rootNavigationRef';
import type { AppTabParamList } from './types';

const Tab = createBottomTabNavigator<AppTabParamList>();

function findDeepestFocusedRouteName(state: unknown): string | undefined {
  if (!state || typeof state !== 'object') return undefined;
  const s = state as { index?: number; routes?: { name?: string; state?: unknown }[] };
  const index = typeof s.index === 'number' ? s.index : 0;
  const routes = s.routes;
  if (!routes?.length) return undefined;
  const route = routes[index];
  if (!route) return undefined;
  if (route.state) return findDeepestFocusedRouteName(route.state);
  return typeof route.name === 'string' ? route.name : undefined;
}

export function AppNavigator() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [isStatsVisible, setIsStatsVisible] = useState(false);

  const updateStatsVisibility = useCallback(async () => {
    try {
      const next = await canShowStats();
      setIsStatsVisible((prev) => {
        if (prev !== next) {
          if (Platform.OS === 'android') {
            const ui = UIManager as { setLayoutAnimationEnabledExperimental?: (v: boolean) => void };
            ui.setLayoutAnimationEnabledExperimental?.(true);
          }
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        }
        return next;
      });
    } catch {
      setIsStatsVisible(false);
    }
  }, []);

  useEffect(() => {
    void updateStatsVisibility();
  }, [updateStatsVisibility]);

  useEffect(() => {
    const subs = [
      DeviceEventEmitter.addListener(DATA_CHANGED_EVENT, () => {
        void updateStatsVisibility();
      }),
      DeviceEventEmitter.addListener(INTENTIONS_CHANGED_EVENT_NAME, () => {
        void updateStatsVisibility();
      }),
      DeviceEventEmitter.addListener(DATABASE_RESET_COMPLETE_EVENT, () => {
        void updateStatsVisibility();
      }),
      DeviceEventEmitter.addListener(LOCAL_DB_RESET_EVENT, () => {
        void updateStatsVisibility();
      }),
    ];
    return () => {
      subs.forEach((s) => s.remove());
    };
  }, [updateStatsVisibility]);

  useEffect(() => {
    if (isStatsVisible) return;
    if (!rootNavigationRef.isReady()) return;
    const root = rootNavigationRef.getRootState();
    if (!root) return;
    if (findDeepestFocusedRouteName(root) !== 'Stats') return;
    rootNavigationRef.dispatch(
      CommonActions.navigate({
        name: 'App',
        params: { screen: 'Tabs', params: { screen: 'TalkDebug' } },
      } as never),
    );
  }, [isStatsVisible]);

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
        component={TalkDebugScreen}
        options={{
          headerShown: false,
          title: t('tabs.talkHome'),
          tabBarIcon: ({ color, size }) => (
            <House color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="TalkDebug"
        component={TalkDebugScreen}
        options={{
          headerShown: false,
          title: t('tabs.talkDebug'),
          tabBarIcon: ({ color, size }) => (
            <Mic color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Timeline"
        component={TimelineScreen}
        options={{
          title: 'Timeline',
          tabBarIcon: ({ color, size }) => (
            <CalendarDays color={color} size={size} />
          ),
        }}
      />
      {isStatsVisible ? (
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
      ) : null}
      {__DEV__ ? (
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
      ) : null}
    </Tab.Navigator>
  );
}
