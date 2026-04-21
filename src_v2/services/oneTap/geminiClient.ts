import type { OneTapUniversalResult, UiLocale } from '../../types/oneTap';
import { parseWireJson, seedWireFromSkeleton, type OneTapWireJson } from './wireProtocol';
import {
  ensureGeminiDiscoveryInitialized,
  getGeminiDiscoveredLeader,
  getGeminiDiscoveryMode,
  reportGeminiLeaderFailure,
} from '../gemini/GeminiDiscovery';
import type { TimeSpec } from '../time/TimeResolver';
import { resolveTimeSpec } from '../time/TimeResolver';

type ApiVersion = 'v1' | 'v1beta';

let cachedFastTrack: { modelId: string; apiVersion: ApiVersion } | null = null;
let cachedFastTrackAtMs = 0;
const FAST_TRACK_TTL_MS = 30 * 60 * 1000;

type GeminiOneTapOptions = {
  apiKey: string;
  modelId: string;
  uiLocale: UiLocale;
  transcript: string;
  seed: OneTapUniversalResult;
  refNowIso?: string;
  signal?: AbortSignal;
};

function toIsoNoMs(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function formatRefLabelUtc(d: Date, uiLocale: UiLocale): string {
  const daysEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
  const daysFr = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const;
  const monthsEn = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ] as const;
  const monthsFr = [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
  ] as const;
  const dayIdx = d.getUTCDay();
  const dd = d.getUTCDate();
  const mmIdx = d.getUTCMonth();
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  if (uiLocale === 'en') {
    return `${daysEn[dayIdx]}, ${monthsEn[mmIdx]} ${dd}, ${yyyy}, ${hh}:${mi} UTC`;
  }
  return `${daysFr[dayIdx]} ${dd} ${monthsFr[mmIdx]} ${yyyy}, ${hh}:${mi} UTC`;
}

const ALLOWED_CATEGORIES = [
  'Courses',
  'Famille',
  'Santé',
  'Travail',
  'Sport',
  'Social',
  'Finance',
  'Légal',
  'Appel',
  'Logistique',
] as const;

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeCategory(raw: string): (typeof ALLOWED_CATEGORIES)[number] {
  const t = stripAccents(String(raw || '').trim().toLowerCase());
  if (!t) return 'Social';
  if (t.includes('course') || t.includes('shopping') || t.includes('grocer')) return 'Courses';
  if (t.includes('famill') || t.includes('parent') || t.includes('enfant') || t.includes('kids')) return 'Famille';
  if (t.includes('sante') || t.includes('medical') || t.includes('dent') || t.includes('opht') || t.includes('doctor')) return 'Santé';
  if (t.includes('travail') || t.includes('work') || t.includes('pro')) return 'Travail';
  if (t.includes('sport') || t.includes('tennis') || t.includes('run') || t.includes('gym')) return 'Sport';
  if (t.includes('social') || t.includes('ami') || t.includes('friends') || t.includes('perso') || t.includes('personnel')) return 'Social';
  if (t.includes('finance') || t.includes('banque') || t.includes('bank') || t.includes('impot') || t.includes('tax')) return 'Finance';
  if (t.includes('legal') || t.includes('jurid') || t.includes('passeport') || t.includes('carte') || t.includes('visa')) return 'Légal';
  if (t.includes('appel') || t.includes('call') || t.includes('rappeler') || t.includes('phone')) return 'Appel';
  if (t.includes('logist') || t.includes('poste') || t.includes('colis') || t.includes('train') || t.includes('gare')) return 'Logistique';
  const pascal = String(raw || '').trim();
  if ((ALLOWED_CATEGORIES as readonly string[]).includes(pascal)) return pascal as (typeof ALLOWED_CATEGORIES)[number];
  return 'Social';
}

function buildPrompt(params: {
  uiLocale: UiLocale;
  transcript: string;
  seed: OneTapWireJson;
  nowIso: string;
}): string {
  const lang = params.uiLocale === 'en' ? 'en' : 'fr';
  const t = params.transcript.length > 2400 ? params.transcript.slice(0, 2400) : params.transcript;
  const text = JSON.stringify(t.replace(/\|/g, ' ').trim());
  const nowIso = JSON.stringify(params.nowIso);
  const refLabel = formatRefLabelUtc(new Date(params.nowIso), params.uiLocale);
  const cats = ALLOWED_CATEGORIES.join(', ');
  const strictLang = [
    'Detect the input language and output lang as ISO-639-1 (fr,en,es,de,ja,...)',
    'Strict rule: the refined title t MUST be written exclusively in lang.',
    'Never translate the title to another language.',
    'Example: "Arzttermin" must stay "Arzttermin", not "Rendez-vous médecin".',
  ].join('\n');

  return [
    'You are the TranKil assistant.',
    'Return ONLY a SINGLE JSON object (no markdown, no code fences).',
    `Reference Time: ${refLabel}`,
    strictLang,
    `Category c must be EXACTLY one of: ${cats}.`,
    'Content generation:',
    '- If the user asks for a list (ingredients, steps, ideas, shopping list), set p="LIST" and generate l as an array of items in lang.',
    '- For recipe prompts (e.g. "Cassoulet for 4"), generate ingredients as l (10-20 items max).',
    '- For "steps"/"étapes", generate short steps as l.',
    'Smart-Scaling for ephemeral lists:',
    '- If a pivot quantity is detected (e.g. "5 days", "4 people", "2 weeks"), include smartScaling.',
    '- smartScaling.pivotValue is the detected number. smartScaling.unitLabel is the unit (in lang).',
    '- smartScaling.items is the generated base list for ONE unit.',
    '- For each item: qty is for 1 unit, and isScalable indicates if qty should be multiplied by pivotValue.',
    'Logistics extraction (HIGH FIDELITY):',
    '- hasLogistics is true as soon as any place is mentioned (Berlin, Capitole, 123 Baker Street, etc).',
    '- isLocationIncomplete is true if the destination cannot be used as-is by a GPS (e.g. "at the office", "a cafe in Paris").',
    'You MUST include this object in EVERY response, without exception:',
    '"logistics": { "hasLogistics": boolean, "destination": string|null, "isLocationIncomplete": boolean }',
    'destination must be the raw address or raw place name (no rewriting).',
    'Temporal labeler: Extract temporal components, do NOT compute dates.',
    'If the user mentions a recurrence, set isRecurring=true and set timeSpec.type="NONE". Put the recurrence text in recurrenceRaw.',
    'Output JSON shape:',
    '{ "lang": "fr", "p": "NOTE|TASK|HABIT|RECURRING_TASK|LIST|ANNIVERSARY", "t": "Emoji + Title", "c": "Category", "l": [], "smartScaling": null, "logistics": { "hasLogistics": false, "destination": null, "isLocationIncomplete": false }, "isRecurring": false, "recurrenceRaw": null, "timeSpec": { "type": "FIXED|RELATIVE|VAGUE|NONE", "rawDay": null, "rawTime": null, "value": null } }',
    `refNowIso=${nowIso}`,
    `text=${text}`,
  ].join('\n');
}

function isoToYmdHm(iso: string): { ymd: string; hm: string } | null {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  const hh = String(dt.getUTCHours()).padStart(2, '0');
  const mm = String(dt.getUTCMinutes()).padStart(2, '0');
  return { ymd: `${y}-${m}-${d}`, hm: `${hh}:${mm}` };
}

function mergeRefine(seed: OneTapUniversalResult, wire: OneTapWireJson, refNowIso: string): OneTapUniversalResult {
  const predictedType = wire.isRecurring ? 'RECURRING_TASK' : wire.p ?? seed.predictedType;
  const categoryTagRaw = (wire.c ?? wire.k ?? seed.categoryTag).trim().slice(0, 80) || seed.categoryTag;
  const categoryTag = normalizeCategory(categoryTagRaw);
  const title = (wire.t ?? seed.title).trim().slice(0, 200) || seed.title;
  const data = { ...seed.data };
  if (typeof wire.lang === 'string' && wire.lang.trim()) data.lang = wire.lang.trim().toLowerCase().slice(0, 8);
  const logistics =
    wire.logistics && typeof wire.logistics === 'object'
      ? {
          hasLogistics: Boolean(wire.logistics.hasLogistics),
          destination:
            typeof wire.logistics.destination === 'string' && wire.logistics.destination.trim()
              ? wire.logistics.destination.trim().slice(0, 160)
              : null,
          isLocationIncomplete: Boolean(wire.logistics.isLocationIncomplete),
        }
      : {
          hasLogistics: typeof wire.hasLogistics === 'boolean' ? wire.hasLogistics : false,
          destination:
            typeof wire.destination === 'string' && wire.destination.trim() ? wire.destination.trim().slice(0, 160) : null,
          isLocationIncomplete: typeof wire.isLocationIncomplete === 'boolean' ? wire.isLocationIncomplete : false,
        };
  data.logistics = logistics;
  data.hasLogistics = logistics.hasLogistics;
  data.isLocationIncomplete = logistics.isLocationIncomplete;
  if (logistics.destination) {
    const dest = logistics.destination;
    data.destinationName = dest;
    data.locationLabel = dest;
  }
  if (wire.isRecurring && typeof wire.recurrenceRaw === 'string' && wire.recurrenceRaw.trim()) {
    data.cadenceDescription = wire.recurrenceRaw.trim().slice(0, 120);
  }
  const timeSpec = !wire.isRecurring ? ((wire.timeSpec ?? null) as TimeSpec | null) : null;
  const resolved = timeSpec ? resolveTimeSpec(timeSpec, refNowIso) : null;
  if (resolved) {
    data.dueAtIso = resolved.dueAtIso;
    data.dueDateYmd = resolved.dueDateYmd;
    if (predictedType === 'HABIT' || predictedType === 'RECURRING_TASK') data.preferredTimeHm = resolved.dueTimeHm;
    else data.dueTimeHm = resolved.dueTimeHm;
  }
  if (typeof wire.e === 'number' && Number.isFinite(wire.e)) {
    data.elasticityFactor = Math.max(0, Math.min(1, wire.e));
  }
  if (wire.d) data.dueDateYmd = wire.d;
  if (wire.h) {
    if (predictedType === 'HABIT' || predictedType === 'RECURRING_TASK') data.preferredTimeHm = wire.h;
    else data.dueTimeHm = wire.h;
  }
  if (wire.n) data.notes = wire.n;
  if (wire.v) {
    data.destinationName = wire.v;
    if (!data.locationLabel) data.locationLabel = wire.v;
  }
  if (wire.l) data.listItems = wire.l;
  if (wire.smartScaling && typeof wire.smartScaling === 'object') {
    const sc = wire.smartScaling as unknown as {
      pivotValue?: unknown;
      unitLabel?: unknown;
      items?: unknown;
    };
    const pivotValue = typeof sc.pivotValue === 'number' && Number.isFinite(sc.pivotValue) ? Math.max(1, Math.floor(sc.pivotValue)) : null;
    const unitLabel = typeof sc.unitLabel === 'string' ? sc.unitLabel.trim().slice(0, 24) : '';
    const itemsRaw = Array.isArray(sc.items) ? sc.items : [];
    const items = itemsRaw
      .map((x) => x as { t?: unknown; qty?: unknown; isScalable?: unknown })
      .filter((x) => typeof x.t === 'string' && x.t.trim())
      .slice(0, 40)
      .map((x) => ({
        t: String(x.t).trim().slice(0, 80),
        qty: typeof x.qty === 'number' && Number.isFinite(x.qty) ? x.qty : 1,
        isScalable: typeof x.isScalable === 'boolean' ? x.isScalable : true,
      }));
    if (pivotValue && unitLabel && items.length) {
      data.smartScaling = { pivotValue, unitLabel, items };
      if (!data.listItems || data.listItems.length === 0) data.listItems = items.map((i) => i.t);
    }
  }
  if (wire.a) data.personName = wire.a;
  if (wire.g) data.monthDay = wire.g;
  if (wire.m) data.memo = wire.m;
  return { predictedType, categoryTag, title, data };
}

export async function geminiRefineOneTapJson(params: GeminiOneTapOptions): Promise<OneTapUniversalResult | null> {
  const refNow = params.refNowIso ? new Date(params.refNowIso) : new Date();
  const refNowIso = toIsoNoMs(Number.isNaN(refNow.getTime()) ? new Date() : refNow);
  const prompt = buildPrompt({
    uiLocale: params.uiLocale,
    transcript: params.transcript,
    seed: seedWireFromSkeleton(params.seed),
    nowIso: refNowIso,
  });

  const shouldRetryWithFallback = (status: number, msg: string | null): boolean => {
    const m = (msg ?? '').toLowerCase();
    if (status === 404 || status === 503 || status === 429) return true;
    if (status === 400 && (m.includes('api version') || m.includes('not found') || m.includes('not supported'))) return true;
    return false;
  };

  const shouldTryOtherApiVersion = (status: number, msg: string | null): boolean => {
    const m = (msg ?? '').toLowerCase();
    if (status === 404) return true;
    if (status === 400 && (m.includes('api version') || m.includes('not supported'))) return true;
    return false;
  };

  const doFetch = async (
    apiVersion: 'v1' | 'v1beta',
    modelId: string,
  ): Promise<{ ok: boolean; status: number; rawText: string | null; errorPreview: string | null }> => {
    const url = new URL(`https://generativelanguage.googleapis.com/${apiVersion}/models/${modelId}:generateContent`);
    url.searchParams.set('key', params.apiKey);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Connection: 'keep-alive' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          topP: 0.1,
          topK: 1,
          candidateCount: 1,
          maxOutputTokens: 900,
        },
      }),
      signal: params.signal,
    });
    let rawText: string | null = null;
    let errorPreview: string | null = null;
    try {
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        error?: { message?: string };
      };
      rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
      if (!res.ok) {
        errorPreview = json?.error?.message ? String(json.error.message).slice(0, 240) : null;
      }
    } catch {
      rawText = null;
      try {
        const txt = await res.text();
        if (!res.ok) errorPreview = txt.trim().slice(0, 240) || null;
      } catch {
        errorPreview = null;
      }
    }
    return {
      ok: res.ok,
      status: res.status,
      rawText: typeof rawText === 'string' ? rawText : null,
      errorPreview,
    };
  };

  const tryOne = async (
    modelId: string,
    apiVersion: ApiVersion,
  ): Promise<{ result: OneTapUniversalResult | null; status: number | null; errorPreview: string | null }> => {
    let r = await doFetch(apiVersion, modelId);
    if (!r.ok && apiVersion === 'v1' && shouldTryOtherApiVersion(r.status, r.errorPreview)) {
      const rBeta = await doFetch('v1beta', modelId);
      if (rBeta.ok) r = rBeta;
    }
    if (!r.ok) {
      if (__DEV__) {
        console.warn(
          `[OneTapGemini] HTTP ${r.status} model=${modelId}${r.errorPreview ? ` | ${r.errorPreview}` : ''}`,
        );
      }
      return { result: null, status: r.status, errorPreview: r.errorPreview };
    }
    if (typeof r.rawText !== 'string') return { result: null, status: r.status, errorPreview: 'empty rawText' };
    const wire = parseWireJson(r.rawText);
    if (!wire) {
      if (__DEV__) {
        console.warn(`[OneTapGemini] parseWireJson failed model=${modelId} preview=${r.rawText.slice(0, 140)}`);
      }
      return { result: null, status: r.status, errorPreview: 'parseWireJson failed' };
    }
    const merged = mergeRefine(params.seed, wire, refNowIso);
    if (!merged.title || merged.title.trim() === '') return { result: null, status: r.status, errorPreview: 'empty title' };
    if (!merged.categoryTag || merged.categoryTag.trim() === '' || merged.categoryTag.trim() === '—') {
      return { result: null, status: r.status, errorPreview: 'empty category' };
    }
    return { result: merged, status: r.status, errorPreview: null };
  };

  await ensureGeminiDiscoveryInitialized(params.apiKey);
  const discovered = getGeminiDiscoveredLeader();
  if (discovered) {
    const first = await tryOne(discovered.modelId, discovered.apiVersion);
    if (first.result) return first.result;
    if (getGeminiDiscoveryMode() === 'bulk') return null;
    if (first.status !== null && shouldRetryWithFallback(first.status, first.errorPreview)) {
      await reportGeminiLeaderFailure(params.apiKey, discovered.modelId);
      const next = getGeminiDiscoveredLeader();
      if (next) {
        const second = await tryOne(next.modelId, next.apiVersion);
        if (second.result) return second.result;
      }
    }
  }

  const now = Date.now();
  const cached = cachedFastTrack && now - cachedFastTrackAtMs < FAST_TRACK_TTL_MS ? cachedFastTrack : null;
  const modelId = (cached?.modelId || params.modelId).trim().replace(/^models\//, '');
  const apiVersion: ApiVersion = cached?.apiVersion ?? 'v1';
  if (modelId) {
    const r = await tryOne(modelId, apiVersion);
    if (r.result) return r.result;
  }
  return null;
}
