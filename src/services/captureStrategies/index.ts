/**
 * Barrel capture — types actifs ; stratégies pré-OneTap DEPRECATED (§10 nettoyage-code-mort.md).
 */
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

/* DEPRECATED — plus importé hors barrel
export { handleCaptureFlowError, type CaptureErrorHandlerContext } from './captureErrorHandler';
export { executeHabitCapture } from './HabitStrategy';
export { executeListInventoryCapture } from './ListStrategy';
export { executeAudioMemoCapture, executeQuickNoteCapture } from './NoteStrategy';
export { applyPostCaptureEffects, buildTemporalCaptureRecap } from './postCaptureEffects';
export { generateProjectPlanFromDeadline, persistValidatedProjectPlan } from './ProjectStrategy';
export { buildFinalTranscriptForCapture, executeTaskCapture } from './TaskStrategy';
*/

// Stubs réexportés si besoin de compilation transitoire :
export { buildFinalTranscriptForCapture, executeTaskCapture } from './TaskStrategy';
export { applyPostCaptureEffects, buildTemporalCaptureRecap } from './postCaptureEffects';
