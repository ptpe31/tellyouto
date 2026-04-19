import type { TalkCaptureDebugPayload } from '../../constants/talkCaptureDebug';

/** Types supportés par le miroir calendrier post-capture. */
export type PostCaptureMirrorType = 'TASK' | 'HABIT';

export interface PostCaptureEffectsConfig {
  isProUser: boolean;
  calendarSyncEnabled: boolean;
  alarmSyncEnabled: boolean;
  autoArchiveAfterCalendarSync: boolean;
  selectedCalendarId: string | null;
}

export interface PostCaptureEffectsResult {
  syncedCalendar: boolean;
  archived: boolean;
  alarmOk: boolean;
}

/** Dépendances injectées pour rester testables et découplées de React. */
export interface CaptureStrategyDeps {
  newId: () => string;
  spectrum: { locale: string; isProUser: boolean };
  withTimeout: <T>(promise: Promise<T>, ms: number) => Promise<T | null>;
  parseDueDateFromText: (text: string) => string | null;
  emitTalkDebug: (payload: TalkCaptureDebugPayload) => void;
  persistAudioMemoFile: (uri: string) => Promise<string>;
  translate: (key: string, options?: Record<string, string | number>) => string;
}

export type TemporalRecapIntroKey = 'talkDebug.taskQuickRecapIntro' | 'talkDebug.habitQuickRecapIntro';

/** Issue standardisée après persistance SQLite (tâche / habitude). */
export interface TemporalPersistedOutcome {
  kind: 'persisted_temporal';
  intentionId: string;
  mirrorType: PostCaptureMirrorType;
  title: string;
  dueDateYmd: string | null;
  metadataJson?: string;
  recapIntroI18nKey: TemporalRecapIntroKey;
}

/** Note ou mémo audio : feedback immédiat, pas d’effets miroir. */
export interface SimpleCaptureOutcome {
  kind: 'simple_note_or_audio';
  successFeedbackI18nKey: string;
}

export interface OpenProjectModalOutcome {
  kind: 'open_project_deadline_modal';
}

export type CaptureChooseActionSuccess =
  | { outcome: TemporalPersistedOutcome }
  | { outcome: SimpleCaptureOutcome }
  | { outcome: OpenProjectModalOutcome };

export type CaptureChooseActionResult =
  | ({ ok: true } & CaptureChooseActionSuccess)
  | { ok: false; error: unknown; code?: 'AUDIO_MISSING' };
