/**
 * Événement global : toute mutation d’intentions Trankil v2 (ou legacy) doit l’émettre
 * pour rafraîchir Timeline, Radar, etc.
 */
export const INTENTIONS_CHANGED_EVENT_NAME = 'talkndone/intentions_changed';
export const INTENTION_PEEK_SNAPSHOT_EVENT_NAME = 'talkndone/intention_peek_snapshot';
export const INTENTION_PEEK_FIRST_SAVE_EVENT_NAME = 'talkndone/intention_peek_first_save';
/** Début capture micro : `DealerBoard` monte sur Talk écoute pour aspiration immédiate. */
export const MICRO_CAPTURE_START_EVENT_NAME = 'talkndone/micro_capture_start';
/** Peek Path B différé : flush après fermeture de l’overlay pipeline global. */
export const CAPTURE_DEFERRED_PEEK_FIRST_SAVE_FLUSH_EVENT_NAME = 'talkndone/capture_deferred_peek_first_save_flush';
/** Sprint final overlay à 100 % (reset sélection DealerBoard, etc.). */
export const CAPTURE_PIPELINE_SPRINT_COMPLETE_EVENT_NAME = 'talkndone/capture_pipeline_sprint_complete';
