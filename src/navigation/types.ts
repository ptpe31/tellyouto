import type { NavigatorScreenParams } from '@react-navigation/native';

import type { AgentStackParamList } from './AgentStack';

export type FocusCapsuleMode = 'chrono' | 'pomodoro';

export type RootStackParamList = {
  Onboarding: undefined;
  App: undefined;
  ProSubscription: undefined;
};

/** Paramètres optionnels pour ouvrir la Timeline sur un pilote précis (ex. depuis Talk Debug). */
export type TimelineTabParams = {
  initialTimeNav?: 'TODAY' | 'TOMORROW' | 'WEEK' | 'CUSTOM';
  initialContext?: 'ALL' | 'HOME' | 'WORK' | 'PIGGY' | 'ARCHIVES';
};

export type AppTabParamList = {
  TalkHome: undefined;
  Radar: undefined;
  Timeline: TimelineTabParams | undefined;
  AgentIA: NavigatorScreenParams<AgentStackParamList> | undefined;
  Recharge: undefined;
  Stats: undefined;
  Debug: undefined;
};

export type MainStackParamList = {
  Tabs: NavigatorScreenParams<AppTabParamList> | undefined;
  FocusCapsule: { intentionId: string; mode?: FocusCapsuleMode };
  /** Lab test : audio .m4a → Gemini + comparaison IA locale (aucune persistance DB). */
  SemanticBrainLab: undefined;
};
