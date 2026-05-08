/**
 * Événement global : toute mutation d’intentions Trankil v2 (ou legacy) doit l’émettre
 * pour rafraîchir Timeline, Radar, etc.
 */
export const INTENTIONS_CHANGED_EVENT_NAME = 'talkndone/intentions_changed';
export const INTENTION_PEEK_SNAPSHOT_EVENT_NAME = 'talkndone/intention_peek_snapshot';
export const INTENTION_PEEK_FIRST_SAVE_EVENT_NAME = 'talkndone/intention_peek_first_save';
