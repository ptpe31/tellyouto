export type IntentionKind = 'TRIP' | 'TASK' | 'HABIT' | 'TIMER' | 'BIRTHDAY' | 'NOTE';

export type IntentionDraftTrip = {
  kind: 'TRIP';
  destination: string;
  arrivalTime: string;
  safetyBuffer: number;
  elasticJumpEnabled?: boolean;
};

export type IntentionDraftTask = {
  kind: 'TASK';
  title: string;
  time: string;
  notes: string;
};

export type IntentionDraftHabit = {
  kind: 'HABIT';
  title: string;
  time: string;
  frequency: 'daily' | 'weekly';
};

export type IntentionDraftTimer = {
  kind: 'TIMER';
  label: string;
  durationSec: number;
};

export type IntentionDraftBirthday = {
  kind: 'BIRTHDAY';
  personName: string;
  age: number | null;
  date: string;
  specialTasks: string[];
};

export type IntentionDraftNote = {
  kind: 'NOTE';
  content: string;
  title?: string;
  isAudioMemo?: boolean;
  isPendingAnalysis?: boolean;
  rawTranscript?: string;
};

export type IntentionDraft =
  | IntentionDraftTrip
  | IntentionDraftTask
  | IntentionDraftHabit
  | IntentionDraftTimer
  | IntentionDraftBirthday
  | IntentionDraftNote;
