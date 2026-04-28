import type { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  App: undefined;
  ProSubscription: undefined;
};

/** Paramètres optionnels pour ouvrir la Timeline sur un pilote précis (ex. depuis Talk Debug). */
export type TimelineTabParams = {
  initialTimeNav?: 'TODAY' | 'TOMORROW' | 'WEEK' | 'CUSTOM';
  initialContext?: 'ALL' | 'HOME' | 'WORK' | 'PIGGY' | 'ARCHIVES';
};

export type AppTabParamList = {
  TalkDebug: undefined;
  Timeline: TimelineTabParams | undefined;
  Debug: undefined;
};

export type MainStackParamList = {
  Tabs: NavigatorScreenParams<AppTabParamList> | undefined;
};
