/**
 * Mode « produit fini » : masque l’onglet Debug.
 * Déverrouillage : 5 appuis sur la version dans Réglages co-pilote (Agent → Réglages).
 */
export const IS_PRODUCTION = true;

/**
 * Nombre max d’intentions épinglées dans l’Espace Sacré (Cockpit / TalkDebugScreen).
 * Valeur compilée — destinée à être pilotée par Firebase Remote Config (`max_pins_count`).
 */
export const MAX_PINS_COUNT = 2;
