import { STRINGS } from '../constants/Strings';
import { suggestSemanticTags } from './TagMap';

const SUPPORTED_LANGS = ['fr', 'en', 'es', 'de', 'it', 'ja', 'zh', 'ar', 'ko', 'nl', 'sv'];
let trainingPromise = null;
let manager = null;
let nluUnavailable = false;

/** Cache du module chrono-node (import dynamique). */
let chronoNs = null;
let chronoPromise = null;

function normalizeLang(lang) {
  const short = (lang || 'fr').toLowerCase().slice(0, 2);
  return SUPPORTED_LANGS.includes(short) ? short : 'fr';
}

async function ensureChronoModule() {
  if (chronoNs) return chronoNs;
  if (!chronoPromise) {
    chronoPromise = (async () => {
      const mod = await import('chrono-node');
      chronoNs = mod;
      return mod;
    })();
  }
  return chronoPromise;
}

async function getChronoParserForLocale(locale) {
  const chrono = await ensureChronoModule();
  const lang = normalizeLang(locale);
  if (lang === 'fr') return chrono.fr;
  if (lang === 'de') return chrono.de;
  if (lang === 'it') return chrono.it;
  if (lang === 'es') return chrono.es;
  if (lang === 'ja') return chrono.ja;
  if (lang === 'zh') return chrono.zh;
  return chrono.en;
}

async function ensureNluModel() {
  if (nluUnavailable) return null;
  if (manager) return manager;
  if (!trainingPromise) {
    trainingPromise = (async () => {
      console.time('NLU_LOAD');
      try {
        const { NlpManager } = await import('@nlpjs/nlp');
        if (typeof NlpManager !== 'function') {
          nluUnavailable = true;
          return null;
        }
        const m = new NlpManager({
          languages: SUPPORTED_LANGS,
          forceNER: true,
        });
        const blocks = STRINGS.NLU_TRAINING;
        for (const lang of Object.keys(blocks)) {
          const conf = blocks[lang];
          for (const sample of conf.TASK) m.addDocument(lang, sample, 'intent.task');
          for (const sample of conf.HABIT) m.addDocument(lang, sample, 'intent.habit');
          for (const sample of conf.NOTE) m.addDocument(lang, sample, 'intent.note');
        }
        await m.train();
        manager = m;
        return m;
      } catch {
        nluUnavailable = true;
        return null;
      } finally {
        console.timeEnd('NLU_LOAD');
      }
    })();
  }
  return trainingPromise;
}

async function fallbackAnalyze(text, locale) {
  const words = text.split(/\s+/).filter(Boolean);
  const lang = normalizeLang(locale);
  const parser = await getChronoParserForLocale(lang);
  const parsedDate = parser.parseDate(text, new Date(), { forwardDate: true }) ?? null;
  const suggestedTags = suggestSemanticTags(text, lang);
  const lower = text.toLowerCase();
  const looksHabit = /\b(tous les jours|chaque jour|daily|every day|routine|habit)\b/i.test(lower);
  const looksTask = /\b(faire|appeler|envoyer|acheter|planifier|do|call|send|buy|plan)\b/i.test(lower);
  const localType = looksHabit ? 'HABIT' : looksTask ? 'TASK' : 'NOTE';
  const isNoise = words.length < 2;
  const isExpertNeeded = !isNoise && localType === 'NOTE';

  return {
    isNoise,
    isExpertNeeded,
    localType,
    localTags: isExpertNeeded
      ? ['semantic_fallback', 'expert_fallback']
      : ['semantic_fallback', 'local_structured'],
    reason: 'nlu_unavailable_fallback',
    shouldMarkLocalProcessed: !isExpertNeeded && localType !== 'NOTE',
    structured: {
      type: localType === 'HABIT' ? 'HABIT' : 'TASK',
      value: text,
      schedule: parsedDate,
      confidence: 0.42,
      suggestedTags,
      complexityLevel: isExpertNeeded ? 2 : 1,
    },
  };
}

/**
 * Analyse locale semantique NLU (NLP.js + Chrono).
 * @param {string} input
 * @param {string} locale
 * @returns {{
 *  isNoise: boolean,
 *  isExpertNeeded: boolean,
 *  localType: 'TASK' | 'HABIT' | 'NOTE',
 *  localTags: string[],
 *  reason: string,
 *  shouldMarkLocalProcessed: boolean,
 *  structured: {
 *    type: 'TASK' | 'HABIT',
 *    value: string,
 *    schedule: Date | null,
 *    confidence: number,
 *    suggestedTags: string[],
 *    complexityLevel: 1 | 2
 *  }
 * }}
 */
export async function analyzeLocally(input, locale = 'fr') {
  const text = (input || '').trim();
  const words = text.split(/\s+/).filter(Boolean);

  if (!text) {
    return {
      isNoise: true,
      isExpertNeeded: false,
      localType: 'NOTE',
      localTags: ['noise', 'empty'],
      reason: 'empty_input',
      shouldMarkLocalProcessed: false,
      structured: { type: 'TASK', value: '', schedule: null, confidence: 0 },
    };
  }

  const m = await ensureNluModel();
  if (!m) {
    return fallbackAnalyze(text, locale);
  }
  const lang = normalizeLang(locale);
  let nlu;
  try {
    nlu = await m.process(lang, text);
  } catch {
    return fallbackAnalyze(text, locale);
  }
  const parser = await getChronoParserForLocale(lang);
  const parsedDate = parser.parseDate(text, new Date(), { forwardDate: true }) ?? null;
  const confidence = Number(nlu.score ?? 0);
  const intent = nlu.intent || 'intent.note';
  const isHabit = intent === 'intent.habit';
  const inferredType = isHabit ? 'HABIT' : intent === 'intent.note' ? 'NOTE' : 'TASK';
  const suggestedTags = suggestSemanticTags(text, lang);
  const isLongAndAmbiguous = words.length >= 20 && confidence < 0.78;
  const hasTimeEntity = parsedDate != null;
  const looksActionable = intent === 'intent.task' || intent === 'intent.habit';
  const shouldRouteExpert = !looksActionable || isLongAndAmbiguous || confidence < 0.52;

  const isNoise = words.length < 2 && confidence < 0.35;
  if (isNoise) {
    return {
      isNoise: true,
      isExpertNeeded: false,
      localType: 'NOTE',
      localTags: ['noise', 'low_confidence'],
      reason: 'too_short_unknown',
      shouldMarkLocalProcessed: false,
      structured: {
        type: 'TASK',
        value: text,
        schedule: hasTimeEntity ? parsedDate : null,
        confidence,
        suggestedTags,
        complexityLevel: 2,
      },
    };
  }

  return {
    isNoise: false,
    isExpertNeeded: shouldRouteExpert,
    localType: inferredType,
    localTags: shouldRouteExpert
      ? ['semantic', 'expert_fallback']
      : ['semantic', 'local_structured'],
    reason: shouldRouteExpert ? 'low_semantic_confidence' : 'semantic_structured_ok',
    shouldMarkLocalProcessed: !shouldRouteExpert && inferredType !== 'NOTE',
    structured: {
      type: inferredType === 'HABIT' ? 'HABIT' : 'TASK',
      value: text,
      schedule: hasTimeEntity ? parsedDate : null,
      confidence,
      suggestedTags,
      complexityLevel: shouldRouteExpert ? 2 : 1,
    },
  };
}

/**
 * API historique minimaliste.
 * @param {string} input
 * @returns {{ isExpertNeeded: boolean }}
 */
export async function gatekeep(input, locale = 'fr') {
  const result = await analyzeLocally(input, locale);
  return { isExpertNeeded: result.isExpertNeeded };
}
