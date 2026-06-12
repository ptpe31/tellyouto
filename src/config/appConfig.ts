/**
 * Mode « produit fini » : masque l’onglet Debug.
 * Déverrouillage : 5 appuis sur la version dans Réglages co-pilote (Agent → Réglages).
 */
export const IS_PRODUCTION = true;

/**
 * Mode Solo Local 100 % autonome : contourne Firebase (Auth, Firestore, proxy Functions)
 * et appelle Google AI Studio directement via `EXPO_PUBLIC_GEMINI_API_KEY`.
 * Réversible : absent ou `false` → comportement proxy Firebase inchangé.
 */
export const IS_LOCAL_MODE = process.env.EXPO_PUBLIC_LOCAL_MODE === 'true';

/** Clé Gemini embarquée (dev / mode local uniquement — jamais en build store prod). */
export const LOCAL_GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim() ?? '';

/**
 * Nombre max d’intentions épinglées dans l’Espace Sacré (Cockpit / TalkDebugScreen).
 * Valeur compilée — destinée à être pilotée par Firebase Remote Config (`max_pins_count`).
 */
export const MAX_PINS_COUNT = 2;
