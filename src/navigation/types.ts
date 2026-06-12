/**
 * Types des piles / onglets : racine native, stack principal, tabs Talk·Timeline·Debug.
 *
 * @module navigation/types
 */
import type { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  App: undefined;
  ProSubscription: undefined;
  ProjectList: { id?: string } | undefined;
};

/** Paramètres optionnels pour ouvrir la Timeline sur un pilote précis (ex. depuis Talk Debug). */
export type TimelineTabParams = {
  initialTimeNav?: 'TODAY' | 'TOMORROW' | 'WEEK' | 'CUSTOM' | 'ALL';
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
