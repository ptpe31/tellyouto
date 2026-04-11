export type FocusCapsuleMode = 'chrono' | 'pomodoro';

export type MainStackParamList = {
  Tabs: undefined;
  FocusCapsule: { intentionId: string; mode?: FocusCapsuleMode };
};
