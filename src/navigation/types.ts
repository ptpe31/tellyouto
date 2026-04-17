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
  /** Lab test : audio .m4a → Gemini + comparaison IA locale (aucune persistance DB). */
  SemanticBrainLab: undefined;
  TalkDebug: undefined;
};

export type AppTabParamList = {
  TalkHome: undefined;
  TalkDebug: undefined;
  MeliMelo: undefined;
  ZenGarden: undefined;
  Radar: undefined;
  Timeline: undefined;
  AgentIA: NavigatorScreenParams<AgentStackParamList> | undefined;
  Recharge: undefined;
  Stats: undefined;
  Debug: undefined;
};
