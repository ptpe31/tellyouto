/**
 * Analyse **one-tap** : une dictée → un JSON unique Gemini (type prédit, tag, données, titre).
 *
 * @module oneTapUniversalCapture
 */

import { geminiGenerateTextUserPrompt } from './geminiSemanticLab';

export const ONE_TAP_PREDICTED_TYPES = [
  'TASK',
  'RECURRING_TASK',
  'HABIT',
  'LIST',
  'ANNIVERSARY',
  'NOTE',
] as const;

export type OneTapPredictedType = (typeof ONE_TAP_PREDICTED_TYPES)[number];

export type OneTapUniversalResult = {
  predictedType: OneTapPredictedType;
  /** Étiquette courte (domaine : cuisine, pro, perso, logistique, etc.). */
  categoryTag: string;
  /** Titre court affichable. */
  title: string;
  /** Champs spécifiques au type (dates, liste inventaire, récurrence, etc.). */
  data: Record<string, unknown>;
};

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

/**
 * Valide et normalise le JSON renvoyé par Gemini pour le flux one-tap.
 *
 * @param raw — Texte brut (JSON éventuellement entouré de ```).
 * @returns Objet {@link OneTapUniversalResult}.
 * @throws {Error} Si le JSON est invalide ou le type inconnu.
 */
export function parseOneTapUniversalJson(raw: string): OneTapUniversalResult {
  const s = stripJsonFences(raw);
  const obj = JSON.parse(s) as Record<string, unknown>;
  const predictedType = String(obj.predictedType || '').trim().toUpperCase();
  if (!ONE_TAP_PREDICTED_TYPES.includes(predictedType as OneTapPredictedType)) {
    throw new Error(`ONE_TAP_INVALID_TYPE:${predictedType}`);
  }
  const title = String(obj.title || '').trim();
  if (!title) {
    throw new Error('ONE_TAP_MISSING_TITLE');
  }
  const categoryTag = String(obj.categoryTag || 'Perso').trim() || 'Perso';
  const data = obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data) ? (obj.data as Record<string, unknown>) : {};
  return {
    predictedType: predictedType as OneTapPredictedType,
    categoryTag,
    title,
    data,
  };
}

function buildOneTapPrompt(transcript: string, uiLocale: string): string {
  const loc = String(uiLocale || 'fr').toLowerCase();
  const langLine = loc.startsWith('en')
    ? 'Use English for title, categoryTag, and human-readable strings inside data when possible.'
    : 'Utilise le français pour title, categoryTag et les libellés humains dans data lorsque c’est naturel.';
  const safe = transcript.length > 12_000 ? transcript.slice(0, 12_000) : transcript;
  return `Tu es un expert en organisation et capture d’intentions vocales. Analyse la dictée et renvoie **un seul** objet JSON valide — pas de markdown, pas de commentaire hors JSON.

${langLine}

Dictée (verbatim ou nettoyée) :
"""${safe.replace(/"/g, '\\"')}"""

Réponse **obligatoire** — forme exacte :
{
  "predictedType": "TASK" | "RECURRING_TASK" | "HABIT" | "LIST" | "ANNIVERSARY" | "NOTE",
  "categoryTag": "string court (ex: Cuisine, Pro, Perso, Logistique, Sport)",
  "title": "string court et explicite",
  "data": { ... }
}

Règles par type pour **data** :
- **TASK** : { "dueDateYmd": "YYYY-MM-DD" | null, "dueTimeHm": "HH:mm" | null, "reminderMinutesBefore": number | null, "notes": string }
  - Si aucune date/heure exploitable : mets **dueDateYmd** à **null** (intention « sans date » / tirelire).
- **RECURRING_TASK** : { "cadenceDescription": string, "nextDueYmd": "YYYY-MM-DD" | null, "anchorNotes": string }
- **HABIT** : { "cadenceDescription": string, "preferredTimeHm": "HH:mm" | null, "notes": string }
- **LIST** : { "list": { "title": string, "baseCount": number, "unitLabel": string, "categories": [ { "name": string, "items": [ { "name": string, "qty": number, "unit": "g"|"kg"|"piece"|"cl"|"l", "scalable": boolean } ] } ] } }
  - Même schéma logique que les inventaires (courses, matériel, valises).
- **ANNIVERSARY** : { "personName": string, "monthDay": "MM-DD" ou "YYYY-MM-DD", "reminderDaysBefore": number | null }
- **NOTE** : { "memo": string } (peut résumer la dictée ; peut être vide).

Choix de **predictedType** :
- Liste d’achats / matériel / valise → LIST.
- Événement annuel / fête / « anniversaire » → ANNIVERSARY.
- Action ponctuelle avec date → TASK ; action répétée sans formalisme d’habitude → RECURRING_TASK.
- Routine « chaque… », sport, hygiène → HABIT.
- Simple mémo sans structure → NOTE.`;
}

/**
 * Appelle Gemini Flash pour classifier et structurer la dictée en un coup.
 *
 * @param transcript — Texte final de la capture.
 * @param options.uiLocale — Locale UI pour orienter la langue des libellés.
 * @returns Résultat parsé + texte brut modèle (debug).
 */
export async function geminiOneTapUniversalFromTranscript(
  transcript: string,
  options: { uiLocale: string },
): Promise<{ parsed: OneTapUniversalResult; rawModelText: string }> {
  const prompt = buildOneTapPrompt(transcript, options.uiLocale);
  const rawModelText = await geminiGenerateTextUserPrompt(prompt);
  const parsed = parseOneTapUniversalJson(rawModelText);
  return { parsed, rawModelText };
}

/**
 * Données minimales par type lorsque l’utilisateur change le type dans l’UI.
 *
 * @param type — Type sélectionné.
 * @returns Objet **data** par défaut (non null).
 */
export function defaultOneTapDataForType(type: OneTapPredictedType): Record<string, unknown> {
  switch (type) {
    case 'TASK':
      return { dueDateYmd: null, dueTimeHm: null, reminderMinutesBefore: null, notes: '' };
    case 'RECURRING_TASK':
      return { cadenceDescription: '', nextDueYmd: null, anchorNotes: '' };
    case 'HABIT':
      return { cadenceDescription: '', preferredTimeHm: null, notes: '' };
    case 'LIST':
      return {
        list: {
          title: '',
          baseCount: 1,
          unitLabel: 'personne',
          categories: [{ name: '—', items: [{ name: '—', qty: 1, unit: 'piece', scalable: false }] }],
        },
      };
    case 'ANNIVERSARY':
      return { personName: '', monthDay: '', reminderDaysBefore: 7 };
    case 'NOTE':
    default:
      return { memo: '' };
  }
}

/**
 * Fusionne une ancienne charge **data** avec un nouveau type en conservant les champs compatibles (ex. titres implicites).
 *
 * @param prevType — Type précédent.
 * @param nextType — Type choisi dans le menu.
 * @param prevData — Données précédentes.
 * @param title — Titre courant (injecté dans list.title si liste vide).
 */
export function mergeOneTapDataOnTypeChange(
  prevType: OneTapPredictedType,
  nextType: OneTapPredictedType,
  prevData: Record<string, unknown>,
  title: string,
): Record<string, unknown> {
  if (prevType === nextType) return { ...prevData };
  const base = defaultOneTapDataForType(nextType);
  if (nextType === 'LIST') {
    const list = prevData.list && typeof prevData.list === 'object' ? (prevData.list as Record<string, unknown>) : null;
    if (list && Array.isArray(list.categories)) {
      return { list };
    }
    const b = base.list as Record<string, unknown>;
    return { list: { ...b, title: title || String(b.title || '') } };
  }
  if (nextType === 'TASK') {
    return {
      ...base,
      dueDateYmd: typeof prevData.dueDateYmd === 'string' ? prevData.dueDateYmd : prevData.nextDueYmd ?? null,
      notes: String(prevData.notes || prevData.memo || prevData.anchorNotes || ''),
    };
  }
  if (nextType === 'NOTE') {
    return { memo: String(prevData.memo || prevData.notes || '') };
  }
  return { ...base, ...prevData };
}
