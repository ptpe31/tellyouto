export { handleCaptureFlowError, type CaptureErrorHandlerContext } from './captureErrorHandler';
export { executeHabitCapture } from './HabitStrategy';
export {
  executeAudioMemoCapture,
  executeQuickNoteCapture,
} from './NoteStrategy';
export {
  applyPostCaptureEffects,
  buildTemporalCaptureRecap,
} from './postCaptureEffects';
export { generateProjectPlanFromDeadline, persistValidatedProjectPlan } from './ProjectStrategy';
export { buildFinalTranscriptForCapture, executeTaskCapture } from './TaskStrategy';
export type {
  CaptureChooseActionResult,
  CaptureStrategyDeps,
  OpenProjectModalOutcome,
  PostCaptureEffectsConfig,
  PostCaptureEffectsResult,
  PostCaptureMirrorType,
  SimpleCaptureOutcome,
  TemporalPersistedOutcome,
} from './types';
