export type FocusCapsuleMode = 'chrono' | 'pomodoro';

export type RootStackParamList = {
  Onboarding: undefined;
  App: undefined;
};

export type MainStackParamList = {
  Tabs: undefined;
  FocusCapsule: { intentionId: string; mode?: FocusCapsuleMode };
};
