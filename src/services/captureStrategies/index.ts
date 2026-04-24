export { handleCaptureFlowError, type CaptureErrorHandlerContext } from './captureErrorHandler';
export { executeHabitCapture } from './HabitStrategy';
export { executeListInventoryCapture } from './ListStrategy';
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
  OfflineRawNoteSavedOutcome,
  OpenProjectModalOutcome,
  PostCaptureEffectsConfig,
  PostCaptureEffectsResult,
  PostCaptureMirrorType,
  SimpleCaptureOutcome,
  TemporalPersistedOutcome,
} from './types';
