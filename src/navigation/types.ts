import type { NavigatorScreenParams } from '@react-navigation/native';

import type { AgentStackParamList } from './AgentStack';

export type FocusCapsuleMode = 'chrono' | 'pomodoro';

export type RootStackParamList = {
  App: undefined;
  ProSubscription: undefined;
};

export type MainStackParamList = {
  Tabs: undefined;
  FocusCapsule: { intentionId: string; mode?: FocusCapsuleMode };
};

export type AppTabParamList = {
  Radar: undefined;
  Timeline: undefined;
  AgentIA: NavigatorScreenParams<AgentStackParamList> | undefined;
  Recharge: undefined;
  Stats: undefined;
  Debug: undefined;
};
