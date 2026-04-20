export type IntentionKind = 'TRIP' | 'HABIT' | 'TIMER' | 'BIRTHDAY' | 'NOTE';

export type IntentionDraftTrip = {
  kind: 'TRIP';
  destination: string;
  arrivalTime: string;
  safetyBuffer: number;
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
};

export type IntentionDraft =
  | IntentionDraftTrip
  | IntentionDraftHabit
  | IntentionDraftTimer
  | IntentionDraftBirthday
  | IntentionDraftNote;

export type IntentionMachineStatus =
  | 'IDLE'
  | 'CAPTURING'
  | 'PARSING_GEMINI'
  | 'REVIEWING'
  | 'SAVING'
  | 'SUCCESS';

export type IntentionMachineState = {
  status: IntentionMachineStatus;
  transcript: string;
  audioUri: string | null;
  drafts: IntentionDraft[];
  error: string | null;
};

export type IntentionMachineEvent =
  | { type: 'CAPTURE_START' }
  | { type: 'CAPTURE_CANCEL' }
  | { type: 'CAPTURE_RECEIVED'; transcript: string; audioUri: string | null }
  | { type: 'PARSE_SUCCESS'; drafts: IntentionDraft[] }
  | { type: 'PARSE_ERROR'; error: string }
  | { type: 'UPDATE_DRAFT'; index: number; draft: IntentionDraft }
  | { type: 'SAVE_START' }
  | { type: 'SAVE_SUCCESS' }
  | { type: 'SAVE_ERROR'; error: string }
  | { type: 'DISMISS_REVIEW' }
  | { type: 'RESET' };

export const INITIAL_INTENTION_MACHINE_STATE: IntentionMachineState = {
  status: 'IDLE',
  transcript: '',
  audioUri: null,
  drafts: [],
  error: null,
};

export function intentionStateMachineReducer(
  state: IntentionMachineState,
  event: IntentionMachineEvent,
): IntentionMachineState {
  switch (event.type) {
    case 'CAPTURE_START':
      return { ...state, status: 'CAPTURING', error: null };
    case 'CAPTURE_CANCEL':
      return { ...INITIAL_INTENTION_MACHINE_STATE };
    case 'CAPTURE_RECEIVED':
      return {
        ...state,
        status: 'PARSING_GEMINI',
        transcript: event.transcript,
        audioUri: event.audioUri,
        error: null,
      };
    case 'PARSE_SUCCESS':
      return {
        ...state,
        status: event.drafts.length > 0 ? 'REVIEWING' : 'IDLE',
        drafts: event.drafts,
        error: event.drafts.length > 0 ? null : 'INTENTION_EMPTY',
      };
    case 'PARSE_ERROR':
      return { ...state, status: 'IDLE', drafts: [], error: event.error };
    case 'UPDATE_DRAFT': {
      const next = [...state.drafts];
      if (event.index < 0 || event.index >= next.length) return state;
      next[event.index] = event.draft;
      return { ...state, drafts: next };
    }
    case 'SAVE_START':
      return { ...state, status: 'SAVING', error: null };
    case 'SAVE_SUCCESS':
      return { ...state, status: 'SUCCESS', error: null };
    case 'SAVE_ERROR':
      return { ...state, status: 'REVIEWING', error: event.error };
    case 'DISMISS_REVIEW':
      return { ...INITIAL_INTENTION_MACHINE_STATE };
    case 'RESET':
      return { ...INITIAL_INTENTION_MACHINE_STATE };
    default:
      return state;
  }
}
