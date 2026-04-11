export type FocusCapsuleMode = 'chrono' | 'pomodoro';

export type RootStackParamList = {
  Onboarding: undefined;
  App: undefined;
};

export type MainStackParamList = {
  Tabs: undefined;
  FocusCapsule: { intentionId: string; mode?: FocusCapsuleMode };
};

export type AppTabParamList = {
  Radar: { from?: string } | undefined;
  Timeline: { from?: string } | undefined;
  AgentIA: undefined;
  Recharge: undefined;
  Messaging: undefined;
  Stats: undefined;
  Debug: undefined;
};
