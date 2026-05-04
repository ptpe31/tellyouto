/**
 * Analyse **one-tap** : dictée → **Dual-Path** (intention rapide + affinage cloud).
 *
 * ## Dual-Path
 *
 * - **Path A — squelette local** ({@link inferOneTapSkeletonFromTranscript}) : heuristiques sur le texte (mots-clés type
 *   LIST/TASK/…) + **chrono-node** pour dates/heures. Exécution **synchrone**, sans réseau : la modale peut s’ouvrir
 *   tout de suite avec un brouillon cohérent.
 * - **Path B — affinage Gemini** ({@link refineOneTapWithGeminiCompressed}) : le squelette est sérialisé en une **ligne
 *   compacte** (`wireLineFromSkeleton`), injectée dans un prompt court avec la dictée ; le modèle renvoie la même
 *   « grammaire » KEY:value|… que l’UI fusionne via {@link mergeWireIntoOneTapSkeleton}. Option **streaming** :
 *   {@link parsePartialWireLine} alimente des mises à jour partielles tant que le buffer n’est pas complet.
 *
 * {@link geminiOneTapUniversalFromTranscript} enchaîne A puis B en **non-streaming** (ex. flux machine à intentions
 * sans UI Talk) et journalise des métriques prompt/Gemini dans la console.
 *
 * ## Repères de performance (Talk / Debug)
 *
 * Les horodatages suivants correspondent à {@link OneTapPerfMsSnapshot} et aux logs `[OneTapPerf]` dans
 * `TalkDebugScreen` (`stopCapture`). Ce ne sont **pas** des durées cumulées : ce sont des instantanés `performance.now()`
 * (ms depuis l’origine de la navigation), sauf `geminiMs` et `totalFromT1Ms` qui sont des **delta**.
 *
 * | Champ / log | Signification |
 * |-------------|----------------|
 * | **T0** (`t0`) | Instant où la capture vocale est terminée (micro/recognition stoppés). Début du funnel « utilisateur voit quelque chose ». |
 * | **T1** (`t1`) | Début du traitement **async** Dual-Path en arrière-plan (après squelette local + ouverture modale). |
 * | **T3** (`t3`) | Fin du pipeline async (pre-save optimiste + refine Gemini + remplacement draft). **Il n’y a pas de T2** dans le payload — l’intervalle réseau Gemini est isolé dans `geminiMs`. |
 * | **geminiMs** | Durée approximative de l’appel Gemini (stream) : fin streaming − début streaming. |
 * | **totalFromT1Ms** | `t3 - t1` : tout ce qui suit l’entrée en arrière-plan (Firestore + réseau + parsing). |
 *
 * ## Self-healing (modèle Gemini)
 *
 * Ce fichier ne choisit pas l’ID de modèle : les appels passent par {@link geminiSemanticLab} →
 * {@link geminiRemoteModelSteering}. En cas d’échec (Remote Config, modèle déprécié, 404), la couche steering applique
 * **listModels**, file priorisée courte, persistance de secours 24h — voir la doc du module steering.
 *
 * @module oneTapUniversalCapture
 * @see `src/constants/talkCaptureDebug.ts` — type `OneTapPerfMsSnapshot` (t0, t1, t3, geminiMs, totalFromT1Ms).
 */

import * as chrono from 'chrono-node';

import { VERBOSE_DEBUG } from '../config/verboseDebug';
import { getDebugUserTierOverrideCached } from './debugUserTierOverride';
import { getActiveGeminiModelId } from './geminiRemoteModelSteering';
import type { ListItemDraft } from './listIntentionModel';
import {
  geminiGenerateOneTapCompressedLine,
  geminiStreamOneTapCompressedLine,
  logGeminiApiPathBResolvedSuccess,
  type GeminiHttpSettledMeta,
  type GeminiPathBLogAnchor,
} from './geminiSemanticLab';

/** Continuation des blocs multi-lignes — alignement vertical dans Metro (`[OneTap]`, `[OneTapPerf]`). */
export const ONE_TAP_DEBUG_LOG_CONT = '\n  | ';
const OT_LOG = ONE_TAP_DEBUG_LOG_CONT;

/**
 * Séparateur visuel au **début de cycle** (T0 — fin capture). Appeler depuis l’écran qui déclenche le dual-path
 * (ex. Talk après `perfNowMs` T0) ou en tête de {@link geminiOneTapUniversalFromTranscript}.
 */
export function logOneTapCaptureCycleStartBanner(): void {
  const when = new Date().toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
  console.log(
    `************************************************************\n🚀 NOUVELLE CAPTURE : ${when}\n************************************************************`,
  );
}
import { cleanTranscriptText, generateSmartTitle } from './smartTitle';

export function splitBulkTranscript(raw: string): string[] {
  const text = String(raw || '');
  const chunks = text.includes('**') ? text.split('**').map((s) => s.trim()).filter(Boolean) : [text.trim()].filter(Boolean);
  console.log('********* DÉBUT SÉQUENCEUR *********');
  console.log('[SEQUENCER] 🧩 Texte brut reçu:', text);
  console.log('[SEQUENCER] 🔪 Chunks détectés (' + chunks.length + ') :', chunks);
  return chunks;
}

export const ONE_TAP_PREDICTED_TYPES = [
  'TASK',
  'RECURRING_TASK',
  'HABIT',
  'TRIP',
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

export const ONE_TAP_CATEGORY_CODES = [
  'HOME',
  'WORK',
  'PERSO',
  'HEALTH',
  'FINANCE',
  'TRAVEL',
  'SOCIAL',
  'SHOP',
  'LEARN',
  'OTHER',
] as const;

export type OneTapCategoryCode = (typeof ONE_TAP_CATEGORY_CODES)[number];

function normalizeOneTapCategoryCode(raw: string | null | undefined): OneTapCategoryCode {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return 'PERSO';
  if (s === 'FAMILLE') return 'HOME';
  if (s === 'PRO') return 'WORK';
  if ((ONE_TAP_CATEGORY_CODES as readonly string[]).includes(s)) return s as OneTapCategoryCode;
  return 'PERSO';
}

export type OneTapRecurrence = {
  summary?: string;
  frequency?: string;
  byWeekday?: number;
};

export type OneTapListDraftItem = {
  name: string;
  baseQuantity: number;
  unit: string;
  scalable: boolean;
  includeInSave?: boolean;
};

export type OneTapListDraftCategory = {
  name: string;
  items: OneTapListDraftItem[];
};

export type OneTapListDraftBlock = {
  title: string;
  baseCount: number;
  unitLabel: string;
  categories: OneTapListDraftCategory[];
};

function perfNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function universalTemporalDefaults(): Record<string, unknown> {
  return { dueDateTime: null, recurrence: null };
}

function normalizeUniversalTemporalInData(data: Record<string, unknown>): Record<string, unknown> {
  const next = { ...data };
  const due = next.dueDateTime;
  if (due === undefined || due === null || due === '') {
    next.dueDateTime = null;
  } else if (typeof due === 'string') {
    const trimmed = due.trim();
    if (!trimmed) {
      next.dueDateTime = null;
    } else {
      const dt = new Date(trimmed);
      next.dueDateTime = Number.isNaN(dt.getTime()) ? null : dt.toISOString();
    }
  } else {
    next.dueDateTime = null;
  }

  const rec = next.recurrence;
  if (rec === undefined || rec === null) {
    next.recurrence = null;
  } else if (typeof rec === 'object' && !Array.isArray(rec)) {
    const ro = rec as Record<string, unknown>;
    const summary = String(ro.summary ?? ro.description ?? ro.naturalLanguage ?? '').trim();
    const frequency = String(ro.frequency ?? ro.cadence ?? '').trim().toLowerCase() || null;
    const byWeekday = ro.byWeekday;
    const hasBy =
      byWeekday !== undefined && byWeekday !== null && String(byWeekday).trim() !== '';
    const hasSignal = Boolean(summary) || Boolean(frequency) || hasBy;
    if (!hasSignal) {
      next.recurrence = null;
    } else {
      next.recurrence = {
        ...(summary ? { summary } : {}),
        ...(frequency ? { frequency } : {}),
        ...(hasBy ? { byWeekday: Number(byWeekday) } : {}),
      };
    }
  } else {
    next.recurrence = null;
  }

  const destName = next.destination_name;
  next.destination_name =
    typeof destName === 'string' ? destName.trim().slice(0, 400) : '';
  next.remind_to_leave = Boolean(next.remind_to_leave);
  const locAddr = next.location_address;
  next.location_address =
    typeof locAddr === 'string' ? locAddr.trim().slice(0, 500) : '';

  next.logisticsPotential = Boolean(next.logisticsPotential);
  if (!next.logisticsPotential && (next.destination_name || next.location_address)) {
    next.logisticsPotential = true;
  }

  return next;
}

function syncYmdHmFromDueDateTime(data: Record<string, unknown>): Record<string, unknown> {
  const iso = typeof data.dueDateTime === 'string' ? data.dueDateTime.trim() : '';
  if (!iso) return data;
  const dt = new Date(iso);
  const ms = dt.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return data;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return { ...data, dueDateYmd: `${y}-${m}-${d}`, dueTimeHm: `${hh}:${mm}` };
}

function universalTailFromPrev(prevData: Record<string, unknown>): Record<string, unknown> {
  const dueDateTime =
    prevData.dueDateTime === undefined || prevData.dueDateTime === null
      ? null
      : typeof prevData.dueDateTime === 'string'
        ? prevData.dueDateTime.trim() || null
        : null;
  const recurrence =
    prevData.recurrence === undefined || prevData.recurrence === null
      ? null
      : typeof prevData.recurrence === 'object' && !Array.isArray(prevData.recurrence)
        ? (prevData.recurrence as Record<string, unknown>)
        : null;
  const tail: Record<string, unknown> = { dueDateTime, recurrence };
  if (typeof prevData.logisticsPotential === 'boolean') {
    tail.logisticsPotential = prevData.logisticsPotential;
  }
  if (typeof prevData.destination_name === 'string' && prevData.destination_name.trim()) {
    tail.destination_name = prevData.destination_name.trim();
  }
  if (typeof prevData.remind_to_leave === 'boolean' || prevData.remind_to_leave === 1) {
    tail.remind_to_leave = Boolean(prevData.remind_to_leave);
  }
  if (typeof prevData.location_address === 'string') {
    tail.location_address = prevData.location_address;
  }
  return tail;
}

function stripJsonFences(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

/** Segments KEY:value d’une ligne compacte (Path B). */
export type OneTapWireFields = Record<string, string>;

export type OneTapIntentJson = {
  type: string;
  incomplete?: boolean;
  category?: string;
  content?: string;
  notes?: string;
  due?: string;
  recurrence?: string;
  preferredTime?: string;
  title?: string;
  items?: ListItemDraft[] | unknown;
  baseCount?: unknown;
  unitLabel?: unknown;
  destination?: string;
  address?: string;
  placeId?: string;
  lat?: unknown;
  lng?: unknown;
  arrivalDue?: string;
};

function shouldSuggestDueFromTranscript(transcript: string): boolean {
  const t = String(transcript || '').toLowerCase();
  if (!t.trim()) return false;
  if (/\b(demain|aujourd'hui|ce soir|après-demain|avant\s+\d{1,2}h|\bà\s*\d{1,2}(?::\d{2})?)\b/i.test(t)) return true;
  if (/\b(rdv|rendez-vous|meeting|réunion)\b/i.test(t)) return true;
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(t)) return true;
  if (/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(t)) return true;
  return false;
}

function annotateIncompletes(intents: OneTapIntentJson[], transcript: string, skeleton: OneTapUniversalResult): OneTapIntentJson[] {
  const suggestDue = shouldSuggestDueFromTranscript(transcript);
  const skData = (skeleton.data ?? {}) as Record<string, unknown>;
  const skAddr = String(skData.location_address ?? '').trim();
  return intents.map((it) => {
    const type = String(it.type ?? '').trim().toUpperCase();
    if (type === 'HABIT' || type === 'RECURRING_TASK') {
      const recurrence = String(it.recurrence ?? '').trim();
      return { ...it, incomplete: !recurrence };
    }
    if (type === 'TRIP') {
      const addr = String(it.address ?? '').trim();
      return { ...it, incomplete: !addr && !skAddr };
    }
    if (type === 'TASK') {
      const due = String(it.due ?? '').trim();
      return { ...it, incomplete: suggestDue && !due };
    }
    if (type === 'LIST') {
      const itemsLen = Array.isArray(it.items) ? (it.items as unknown[]).length : 0;
      return { ...it, incomplete: itemsLen <= 0 };
    }
    return { ...it, incomplete: false };
  });
}

function parseBulletPipeIntentsFromBuffer(buffer: string, partial: boolean): OneTapIntentJson[] {
  const s = String(buffer || '');
  const parts = s.split('\n');
  const lines = partial && !s.endsWith('\n') ? parts.slice(0, -1) : parts;
  const intents: OneTapIntentJson[] = [];
  let currentList: OneTapIntentJson | null = null;

  const normalizeDueInput = (raw: string): string => {
    const trimmed = String(raw || '').trim();
    if (!trimmed || trimmed.toLowerCase() === 'null') return '';
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(trimmed)) {
      return trimmed.replace(' ', 'T') + ':00';
    }
    return trimmed;
  };

  const normalizeType = (raw: string): 'TASK' | 'TRIP' | 'NOTE' | 'HABIT' | 'LIST' | '' => {
    const t = String(raw || '').trim().toUpperCase();
    if (t === 'TASK' || t === 'TRIP' || t === 'NOTE' || t === 'HABIT' || t === 'LIST') return t;
    return '';
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (!line.startsWith('>') || line.startsWith('>>')) continue;
    const body = line.slice(1).trim();
    if (!body) continue;
    const segs = body
      .split('|')
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
    if (segs.length < 3) continue;
    const type = normalizeType(segs[0]);
    if (!type) continue;
    const content = String(segs[1] ?? '').trim();
    if (!content) continue;
    const segmentCategory = segs[2];
    const categoryId = normalizeOneTapCategoryCode(segmentCategory);
    if (VERBOSE_DEBUG) {
      console.log('[GeminiDebug] 🗺️ MAPPING_CHECK:', { segmentCategory, resolvedCategoryId: categoryId });
    }
    const due = normalizeDueInput(segs[3] ?? '');
    if (type === 'TRIP') {
      intents.push({ type: 'TRIP', destination: content, arrivalDue: due, category: categoryId });
    } else if (type === 'TASK') {
      intents.push({ type: 'TASK', content, due, category: categoryId });
    } else if (type === 'NOTE') {
      intents.push({ type: 'NOTE', content, category: categoryId });
    } else if (type === 'HABIT') {
      intents.push({ type: 'HABIT', content, recurrence: due, category: categoryId });
    } else if (type === 'LIST') {
      const baseCountRaw = parseInt(String(segs[3] ?? '1').trim(), 10);
      const baseCount = Number.isFinite(baseCountRaw) && baseCountRaw > 0 ? baseCountRaw : 1;
      currentList = { type: 'LIST', title: content, baseCount, unitLabel: 'personne', items: [], category: categoryId };
      intents.push(currentList);
    }
    currentList = type === 'LIST' ? currentList : null;
  }
  return intents;
}

function parseJsonIntentsFromBuffer(buffer: string, partial: boolean): OneTapIntentJson[] {
  const base = String(buffer || '').trim();
  if (!base) return [];
  if (partial && !base.endsWith('}')) return [];
  const startIdx = base.indexOf('{');
  const s = startIdx >= 0 ? base.slice(startIdx) : base;
  const obj = tryParseJsonObjectBestEffort(s);
  if (!obj) return [];
  const intentsRaw = (obj as { intents?: unknown }).intents;
  if (!Array.isArray(intentsRaw) || intentsRaw.length === 0) return [];
  const out: OneTapIntentJson[] = [];
  for (const it of intentsRaw) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
    const r = it as Record<string, unknown>;
    const type = normalizeIntentType(String(r.type ?? ''));
    if (!type) continue;
    const category = typeof r.category === 'string' ? normalizeOneTapCategoryCode(r.category) : '';
    if (type === 'LIST') {
      const title = String(r.title ?? r.content ?? '').trim();
      if (!title) continue;
      const baseCountRaw = Number(r.baseCount ?? 1);
      const baseCount = Number.isFinite(baseCountRaw) && baseCountRaw > 0 ? baseCountRaw : 1;
      const unitLabel = typeof r.unitLabel === 'string' ? r.unitLabel.trim().slice(0, 40) : 'personne';
      out.push({ type: 'LIST', title, baseCount, unitLabel: unitLabel || 'personne', items: r.items, category });
      continue;
    }
    if (type === 'TASK') {
      const content = String(r.content ?? r.title ?? '').trim();
      if (!content) continue;
      const due = typeof r.due === 'string' ? String(r.due).trim() : '';
      const notes = typeof r.notes === 'string' ? r.notes.trim() : '';
      out.push({ type: 'TASK', content, due, ...(notes ? { notes } : {}), category });
      continue;
    }
    if (type === 'TRIP') {
      const destination = String(r.destination ?? r.content ?? r.title ?? '').trim();
      if (!destination) continue;
      const arrivalDue = typeof r.arrivalDue === 'string' ? r.arrivalDue.trim() : typeof r.due === 'string' ? r.due.trim() : '';
      out.push({ type: 'TRIP', destination, arrivalDue, category });
      continue;
    }
    if (type === 'NOTE') {
      const content = String(r.content ?? r.title ?? '').trim();
      if (!content) continue;
      out.push({ type: 'NOTE', content, category });
      continue;
    }
    if (type === 'HABIT') {
      const content = String(r.content ?? r.title ?? '').trim();
      if (!content) continue;
      const recurrence = typeof r.recurrence === 'string' ? r.recurrence.trim() : '';
      const preferredTime = typeof r.preferredTime === 'string' ? r.preferredTime.trim() : '';
      out.push({ type: 'HABIT', content, recurrence, ...(preferredTime ? { preferredTime } : {}), category });
      continue;
    }
  }
  return out;
}

/**
 * Sérialise le squelette Path A en une **seule ligne** `KEY:value|KEY:value` consommée par Gemini Path B.
 *
 * Clés usuelles : `P` (type), `K` (catégorie), `T` (titre), et selon le type `D`/`H`/`N` (tâche), `L` (liste), `A`/`G`
 * (anniversaire), `C` (récurrence/habitude). Les `|` dans le texte sont neutralisés pour éviter de casser le découpage.
 *
 * @param s — Résultat {@link inferOneTapSkeletonFromTranscript} ou fusion précédente.
 * @returns Ligne compacte passée à {@link buildCompressedGeminiPrompt} comme « seed ».
 */
function wireLineFromSkeleton(s: OneTapUniversalResult): string {
  const safeTitle = s.title.replace(/\|/g, ' ').trim().slice(0, 90);
  const parts = [`P:${s.predictedType}`, `K:${s.categoryTag}`, `T:${safeTitle}`];
  const d = s.data;
  if (s.predictedType === 'TASK') {
    const y = typeof d.dueDateYmd === 'string' ? d.dueDateYmd.trim() : '';
    const h = typeof d.dueTimeHm === 'string' ? d.dueTimeHm.trim() : '';
    if (y) parts.push(`D:${y}`);
    if (h) parts.push(`H:${h}`);
    const notes = typeof d.notes === 'string' ? d.notes.trim().slice(0, 120) : '';
    if (notes) parts.push(`N:${notes.replace(/\|/g, ' ')}`);
    const dest = typeof d.destination_name === 'string' ? d.destination_name.trim().slice(0, 120) : '';
    if (dest) parts.push(`V:${dest.replace(/\|/g, ' ')}`);
  }
  if (s.predictedType === 'ANNIVERSARY') {
    const pn = typeof d.personName === 'string' ? d.personName.trim() : '';
    const g = typeof d.monthDay === 'string' ? d.monthDay.trim() : '';
    if (pn) parts.push(`A:${pn.replace(/\|/g, ' ')}`);
    if (g) parts.push(`G:${g}`);
  }
  if (s.predictedType === 'HABIT' || s.predictedType === 'RECURRING_TASK') {
    const c =
      typeof d.cadenceDescription === 'string' ? d.cadenceDescription.trim().slice(0, 120) : '';
    if (c) parts.push(`C:${c.replace(/\|/g, ' ')}`);
    const destH =
      typeof d.destination_name === 'string' ? d.destination_name.trim().slice(0, 120) : '';
    if (destH) parts.push(`V:${destH.replace(/\|/g, ' ')}`);
  }
  if (s.predictedType === 'LIST') {
    const list = d.list && typeof d.list === 'object' ? (d.list as Record<string, unknown>) : null;
    const cats = list && Array.isArray(list.categories) ? list.categories : [];
    const names: string[] = [];
    for (const c of cats) {
      const items = (c as { items?: unknown[] })?.items;
      if (!Array.isArray(items)) continue;
      for (const it of items) {
        const n = typeof (it as { name?: string })?.name === 'string' ? String((it as { name: string }).name).trim() : '';
        if (n && n !== '—') names.push(n);
      }
    }
    if (names.length) parts.push(`L:${names.join(';').slice(0, 400)}`);
  }
  return parts.join('|');
}

export function parseOneTapWireLine(line: string): OneTapWireFields {
  const s = String(line || '')
    .trim()
    .replace(/^[`"'«»\s]+/, '')
    .replace(/[`"'«»\s]+$/, '');
  const out: OneTapWireFields = {};
  for (const seg of s.split('|')) {
    const idx = seg.indexOf(':');
    if (idx <= 0) continue;
    const k = seg.slice(0, idx).trim().toUpperCase();
    const v = seg.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export function parseOneTapWireLineBlocks(line: string): OneTapWireFields[] {
  const s = String(line || '')
    .trim()
    .replace(/^[`"'«»\s]+/, '')
    .replace(/[`"'«»\s]+$/, '');
  const out: OneTapWireFields[] = [];
  let cur: OneTapWireFields = {};
  for (const seg of s.split('|')) {
    const idx = seg.indexOf(':');
    if (idx <= 0) continue;
    const k = seg.slice(0, idx).trim().toUpperCase();
    const v = seg.slice(idx + 1).trim();
    if (!k) continue;
    if (k === 'P' && Object.keys(cur).length > 0) {
      out.push(cur);
      cur = {};
    }
    cur[k] = v;
  }
  if (Object.keys(cur).length > 0) out.push(cur);
  return out;
}

/** Parse incrémental (streaming) : n’utilise que les segments complets KEY:value. */
export function parsePartialWireLine(buffer: string): OneTapWireFields {
  const segments = String(buffer || '').split('|');
  const out: OneTapWireFields = {};
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i === segments.length - 1 && !seg.includes(':')) break;
    const idx = seg.indexOf(':');
    if (idx <= 0) continue;
    const k = seg.slice(0, idx).trim().toUpperCase();
    const v = seg.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export function parsePartialWireLineBlocks(buffer: string): OneTapWireFields[] {
  const segments = String(buffer || '').split('|');
  const out: OneTapWireFields[] = [];
  let cur: OneTapWireFields = {};
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i === segments.length - 1 && !seg.includes(':')) break;
    const idx = seg.indexOf(':');
    if (idx <= 0) continue;
    const k = seg.slice(0, idx).trim().toUpperCase();
    const v = seg.slice(idx + 1).trim();
    if (!k) continue;
    if (k === 'P' && Object.keys(cur).length > 0) {
      out.push(cur);
      cur = {};
    }
    cur[k] = v;
  }
  if (Object.keys(cur).length > 0) out.push(cur);
  return out;
}

function tryParseJsonObjectBestEffort(raw: string): Record<string, unknown> | null {
  const s = stripJsonFences(raw);
  if (!s || s[0] !== '{') return null;
  const tryOnce = (t: string) => {
    try {
      const o = JSON.parse(t) as unknown;
      if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch {
      /* */
    }
    return null;
  };
  let hit = tryOnce(s);
  if (hit) return hit;
  let pad = s;
  for (let i = 0; i < 20 && !hit; i++) {
    pad += '}';
    hit = tryOnce(pad);
  }
  return hit;
}

function tryParseJsonArrayBestEffort(raw: string): unknown[] | null {
  const s = stripJsonFences(raw);
  if (!s || s[0] !== '[') return null;
  const tryOnce = (t: string) => {
    try {
      const o = JSON.parse(t) as unknown;
      if (Array.isArray(o)) return o;
    } catch {
      /* */
    }
    return null;
  };
  let hit = tryOnce(s);
  if (hit) return hit;
  let pad = s;
  for (let i = 0; i < 40 && !hit; i++) {
    pad += ']';
    hit = tryOnce(pad);
  }
  return hit;
}

function buildListDataFromWireItems(items: string[], title: string): Record<string, unknown> {
  const clean = items.map((x) => x.trim()).filter(Boolean).slice(0, 48);
  if (clean.length === 0) return defaultOneTapDataForType('LIST');
  return {
    ...universalTemporalDefaults(),
    list: {
      title: title.slice(0, 120) || 'Liste',
      baseCount: 1,
      unitLabel: 'personne',
      categories: [
        {
          name: '—',
          items: clean.map((name) => ({
            name,
            baseQuantity: 1,
            unit: 'piece',
            scalable: true,
          })),
        },
      ],
    },
  };
}

function parseWireListItems(raw: string): string[] {
  const base = String(raw || '').replace(/\|/g, ' ').trim();
  if (!base) return [];
  const normalized = base.replace(/\r\n/g, '\n').replace(/[•·]/g, '\n');
  let parts = normalized.split(/[\n;]+/);
  if (parts.length <= 1 && normalized.includes(',')) {
    parts = normalized.split(',');
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const cleaned = p
      .trim()
      .replace(/^\s*(?:[-*]\s*|\d+\s*[.)-]\s*)/, '')
      .trim()
      .replace(/\s{2,}/g, ' ')
      .slice(0, 120);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= 48) break;
  }
  return out;
}

function normalizeWireHm(h: string): string | null {
  const m = h.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function normalizeIntentType(raw: string): 'TASK' | 'LIST' | 'HABIT' | 'TRIP' | 'NOTE' | null {
  const t = String(raw || '').trim().toUpperCase();
  if (t === 'TASK' || t === 'LIST' || t === 'HABIT' || t === 'TRIP' || t === 'NOTE') return t;
  return null;
}

function coerceItemsArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of raw) {
    const s = String(it ?? '').trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s.slice(0, 120));
    if (out.length >= 48) break;
  }
  return out;
}

function normalizeListUnit(u: unknown): string {
  const s = String(u ?? 'piece')
    .trim()
    .toLowerCase();
  if (s === 'g' || s === 'kg' || s === 'piece' || s === 'cl' || s === 'l') return s;
  if (s === 'pcs' || s === 'pc' || s === 'pièce' || s === 'pieces' || s === 'unité' || s === 'unite')
    return 'piece';
  if (s === 'ml') return 'cl';
  return 'piece';
}

function coerceListItems(
  raw: unknown,
  baseCount: number,
): { name: string; baseQuantity: number; unit: string; scalable: boolean }[] {
  if (!Array.isArray(raw)) return [];
  const out: { name: string; baseQuantity: number; unit: string; scalable: boolean }[] = [];
  const seen = new Set<string>();
  for (const it of raw) {
    if (typeof it === 'string') {
      const name = it.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: name.slice(0, 120), baseQuantity: 1, unit: 'piece', scalable: true });
      if (out.length >= 48) break;
      continue;
    }
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
    const r = it as Record<string, unknown>;
    const name = String(r.name ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const q1 = r.baseQuantity;
    const q2 = r.qty;
    const q = Number(q1 ?? q2 ?? 1);
    const n = Number.isFinite(q) && q > 0 ? q : 1;
    const normBaseCount = Number.isFinite(baseCount) && baseCount > 0 ? baseCount : 1;
    const baseQuantity = q1 !== undefined ? n : Math.max(0.000001, n / normBaseCount);
    const unit = normalizeListUnit(r.unit);
    const scalable = r.scalable !== undefined ? Boolean(r.scalable) : true;
    out.push({ name: name.slice(0, 120), baseQuantity, unit, scalable });
    if (out.length >= 48) break;
  }
  return out;
}

function mergeIntentArrayIntoOneTapSkeleton(
  skeleton: OneTapUniversalResult,
  intents: OneTapIntentJson[],
): OneTapUniversalResult {
  const mergedBase = { ...(skeleton.data as Record<string, unknown>) };
  const out: Record<string, unknown> = { ...mergedBase, intents };
  let title = skeleton.title;
  let categoryTag = skeleton.categoryTag;
  let hasTrip = false;
  let tripTitle = '';

  for (const rawIntent of intents) {
    const type = normalizeIntentType(rawIntent?.type);
    if (!type) continue;
    const cat = typeof rawIntent.category === 'string' ? rawIntent.category.trim().slice(0, 80) : '';
    if (cat) categoryTag = cat;
    if (type === 'LIST') {
      const listTitle = typeof rawIntent.title === 'string' ? rawIntent.title.trim() : '';
      const baseCountRaw = Number((rawIntent as { baseCount?: unknown }).baseCount ?? 1);
      const baseCount = Number.isFinite(baseCountRaw) ? Math.max(1, Math.round(baseCountRaw)) : 1;
      const unitLabel =
        typeof (rawIntent as { unitLabel?: unknown }).unitLabel === 'string'
          ? String((rawIntent as { unitLabel: string }).unitLabel).trim().slice(0, 40) || 'personne'
          : 'personne';
      const itemsObj = coerceListItems(rawIntent.items, baseCount);
      const itemsStr = itemsObj.length ? [] : coerceItemsArray(rawIntent.items);
      if (itemsObj.length || itemsStr.length) {
        out.list = {
          title: (listTitle || skeleton.title).trim().slice(0, 120) || 'Liste',
          baseCount,
          unitLabel,
          categories: [
            {
              name: '—',
              items: itemsObj.length
                ? itemsObj.map((it) => ({
                    name: it.name,
                    baseQuantity: it.baseQuantity,
                    unit: it.unit,
                    scalable: it.scalable,
                    includeInSave: true,
                  }))
                : itemsStr.map((name) => ({
                    name,
                    baseQuantity: 1,
                    unit: 'piece',
                    scalable: true,
                    includeInSave: true,
                  })),
            },
          ],
        };
        if (listTitle) title = listTitle.slice(0, 200);
      }
    }
    if (type === 'TASK') {
      const content = typeof rawIntent.content === 'string' ? rawIntent.content.trim() : '';
      if (content && (!title || title === skeleton.title)) title = content.slice(0, 200);
      const due = typeof rawIntent.due === 'string' ? rawIntent.due.trim() : '';
      if (due) out.dueDateTime = due;
      const notes = typeof rawIntent.notes === 'string' ? rawIntent.notes.trim() : '';
      if (notes) out.notes = notes.slice(0, 2000);
    }
    if (type === 'HABIT') {
      const content = typeof rawIntent.content === 'string' ? rawIntent.content.trim() : '';
      if (content && (!title || title === skeleton.title)) title = content.slice(0, 200);
      const rec = typeof rawIntent.recurrence === 'string' ? rawIntent.recurrence.trim() : '';
      if (rec) {
        out.cadenceDescription = rec.slice(0, 500);
        out.recurrence = { summary: rec.slice(0, 500) };
      }
      const pref = typeof rawIntent.preferredTime === 'string' ? rawIntent.preferredTime.trim() : '';
      if (pref && /^\d{1,2}:\d{2}$/.test(pref)) out.preferredTimeHm = normalizeWireHm(pref) ?? pref;
    }
    if (type === 'TRIP') {
      const dest = typeof rawIntent.destination === 'string' ? rawIntent.destination.trim() : '';
      if (dest) {
        hasTrip = true;
        if (!tripTitle) tripTitle = dest.slice(0, 200);
        out.logisticsPotential = true;
        out.destination_name = dest.slice(0, 400);
      }
      const addr = typeof rawIntent.address === 'string' ? rawIntent.address.trim() : '';
      if (addr) out.location_address = addr.slice(0, 500);
      const placeId = typeof rawIntent.placeId === 'string' ? rawIntent.placeId.trim() : '';
      if (placeId) out.location_place_id = placeId.slice(0, 200);
      const lat = Number(rawIntent.lat);
      const lng = Number(rawIntent.lng);
      if (Number.isFinite(lat)) out.location_lat = lat;
      if (Number.isFinite(lng)) out.location_lng = lng;
      const due = typeof rawIntent.arrivalDue === 'string' ? rawIntent.arrivalDue.trim() : '';
      if (due) out.dueDateTime = due;
    }
    if (type === 'NOTE') {
      const content = typeof rawIntent.content === 'string' ? rawIntent.content.trim() : '';
      if (content) out.memo = content.slice(0, 4000);
    }
  }

  const data = normalizeUniversalTemporalInData(out);
  const rawNextTitle = (hasTrip ? tripTitle : title).trim().slice(0, 200) || skeleton.title;
  const nextTitle = rawNextTitle;
  const baseType = hasTrip ? 'TRIP' : skeleton.predictedType;
  return { ...skeleton, predictedType: baseType, categoryTag, title: nextTitle, data };
}

function patchDataFromWire(wire: OneTapWireFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (wire.D && /^\d{4}-\d{2}-\d{2}$/.test(wire.D)) out.dueDateYmd = wire.D;
  if (wire.D && /^\d{4}-\d{2}-\d{2}$/.test(wire.D)) out.nextDueYmd = wire.D;
  const hm = wire.H ? normalizeWireHm(wire.H) : null;
  if (hm) {
    out.dueTimeHm = hm;
    out.preferredTimeHm = hm;
  }
  if (wire.C) out.cadenceDescription = wire.C.slice(0, 500);
  if (wire.R) out.recurrence = { summary: wire.R.slice(0, 500) };
  if (wire.N) {
    const note = wire.N.replace(/\|/g, ' ').trim();
    if (note) {
      out.notes = note.slice(0, 2000);
      out.memo = note.slice(0, 4000);
      out.anchorNotes = note.slice(0, 2000);
    }
  }
  if (wire.L) {
    const items = parseWireListItems(wire.L);
    if (items.length) {
      out.list = (buildListDataFromWireItems(items, wire.T || '').list as Record<string, unknown>) ?? undefined;
    }
  }
  if (wire.A) out.personName = wire.A.slice(0, 200);
  if (wire.G) out.monthDay = wire.G.slice(0, 32);
  return out;
}

function mergeLogisticsFromWire(
  wire: OneTapWireFields,
  mergedBase: Record<string, unknown>,
): Record<string, unknown> {
  const v = wire.V?.replace(/\|/g, ' ').trim().slice(0, 400) ?? '';
  if (!v) return {};
  const out: Record<string, unknown> = {
    logisticsPotential: true,
    destination_name: v,
  };
  const existingLoc =
    typeof mergedBase.location_address === 'string' ? mergedBase.location_address.trim() : '';
  if (!existingLoc) {
    out.location_address = v;
  }
  return out;
}

/** Log terminal : lieu reconnu (IA ou mémoire SQLite). */
export function logOneTapLogisticsRecognized(place: string, source: 'IA' | 'Mémoire'): void {
  const label = String(place || '').trim().slice(0, 400);
  if (!label) return;
  const safe = label.replace(/'/g, "’");
  console.log(`[OneTapLogistics] 📍 Lieu reconnu: '${safe}' | Source: ${source}`);
}

export function mergeWireIntoOneTapSkeleton(
  skeleton: OneTapUniversalResult,
  wire: OneTapWireFields,
): OneTapUniversalResult {
  const categoryTag = normalizeOneTapCategoryCode(wire.K || skeleton.categoryTag).slice(0, 80);
  const rawTitle = (wire.T?.trim() || skeleton.title || 'Note').trim().slice(0, 200);
  const title = rawTitle;
  const mergedBase = { ...(skeleton.data as Record<string, unknown>) };
  const wirePatch = patchDataFromWire(wire);
  const logisticsPatch = mergeLogisticsFromWire(wire, { ...mergedBase, ...wirePatch });
  const data = normalizeUniversalTemporalInData({ ...mergedBase, ...wirePatch, ...logisticsPatch });
  return { ...skeleton, categoryTag, title, data };
}

function detectLangForOneTapPrompt(transcript: string, fallback: string): string {
  const raw = String(transcript || '');
  const t = raw.toLowerCase();
  const scoreEn = (t.match(/\b(the|a|an|to|for|with|without|today|tomorrow|please|meeting|call|buy)\b/g) ?? []).length;
  const scoreFr = (t.match(/\b(le|la|les|des|un|une|je|tu|vous|pour|avec|sans|aujourd'hui|demain|réunion|rdv)\b/g) ?? [])
    .length;
  const hasAccents = /[àâäçéèêëîïôöùûüÿœ]/i.test(raw);
  const base = String(fallback || '').trim();
  const norm = base.toLowerCase();
  if (scoreEn > scoreFr && !hasAccents) return norm.startsWith('en') ? base : 'en-US';
  if (scoreEn > 0 && scoreFr === 0 && !hasAccents) return 'en-US';
  if (scoreFr > scoreEn || hasAccents) return norm.startsWith('fr') ? base : 'fr-FR';
  return base || 'auto';
}

function baseLangFromBcp47(bcp47: string): string {
  const s = String(bcp47 || '').trim();
  if (!s || s === 'und') return 'auto';
  return s.split(/[-_]/)[0]?.toLowerCase() || 'auto';
}

const TRIP_TRIGGER_TERMS_FR = [
  'aller',
  'rendez-vous',
  'rdv',
  'chez',
  'déplacement',
  'deplacement',
  'déplacer',
  'deplacer',
  'en train',
  'avion',
  'gare',
  'aéroport',
  'aeroport',
  'hôpital',
  'hopital',
  'dentiste',
  'kiné',
  'kine',
  'piscine',
  'tennis',
  'foot',
  'gym',
  'salle de sport',
  'séance',
  'seance',
  'salle',
] as const;

const TRIP_TRIGGER_TERMS_EN = [
  'go to',
  'going to',
  'visit',
  'travel',
  'head to',
  'arrive at',
  'airport',
  'station',
  'hotel',
] as const;

const TRIP_TRIGGER_TERMS_EXTRA = ['pêche', 'peche', 'étang', 'etang', 'cabane', 'school'] as const;

const TRIP_TRIGGER_PATTERN_FR = new RegExp(`\\b(${TRIP_TRIGGER_TERMS_FR.join('|')})\\b`, 'i');
const TRIP_TRIGGER_PATTERN_EN = new RegExp(`\\b(${TRIP_TRIGGER_TERMS_EN.join('|')})\\b`, 'i');
const TRIP_TRIGGER_PATTERN_EXTRA = new RegExp(`\\b(${TRIP_TRIGGER_TERMS_EXTRA.join('|')})\\b`, 'i');

function shouldForceTripFromTranscript(cleaned: string): boolean {
  const lower = String(cleaned || '').toLowerCase();
  return (
    TRIP_TRIGGER_PATTERN_FR.test(cleaned) ||
    TRIP_TRIGGER_PATTERN_EN.test(lower) ||
    TRIP_TRIGGER_PATTERN_EXTRA.test(lower)
  );
}

function buildCompressedGeminiPrompt(transcript: string, seedLine: string): string {
  const safe = transcript.length > 12_000 ? transcript.slice(0, 12_000) : transcript;
  const lang2 = 'auto';
  const seed = seedLine;
  const loc = `DETECTED LANGUAGE DISCIPLINE (ABSOLUTE):
- Identify the language (EN, FR, ES, IT, etc.).
- Output strings ONLY in that language.
- CRITICAL: ZERO TRANSLATION. Do not translate the user's wording. Preserve the user's wording as much as possible.
- You may fix obvious typos and expand obvious abbreviations, but ONLY in the same detected language.
- The DISPLAY TITLE CONTRACT applies UNIVERSALLY to all languages.`;
  const catContract = `CATEGORY CONTRACT (ABSOLUTE):
- CATEGORY_CODE MUST be exactly one of these uppercase codes:
  HOME, WORK, PERSO, HEALTH, FINANCE, TRAVEL, SOCIAL, SHOP, LEARN, OTHER
- Use these codes ONLY. Never translate them. Never invent new categories.
- If unsure, use PERSO.`;
  const titleContract = `DISPLAY TITLE CONTRACT (ABSOLUTE):
- CONTENT must be a pure action title (the essence of the user's intent).
- STEP 1: Strip ALL time markers from CONTENT (e.g. "tomorrow", "tonight", "9h30", "at 7pm", "monday", "ce soir", "demain", "stasera", "mañana"). Time information must go ONLY into DUE_DATE.
- STEP 2: MANDATORY TRIM of trailing prepositions. Delete any "at", "on", "for", "to", "à", "le", "el", "per", "en" left at the end of the title.
- STEP 3: Fix common typos/abbreviations in the target language when obvious (e.g. "mdcin"->"Médecin", "rdv"->"RDV", "piza"->"Pizza", "pades"->"Padres").
- CONTENT must start with an uppercase letter.
- ZERO REDUNDANCY: keep the specific action even if the category is obvious (do not over-simplify).`;
  const tripContract = `TRIP CONTRACT (ABSOLUTE):
- Any mention of movement or going somewhere MUST be classified as TRIP.
- Trigger dictionary: ${[...TRIP_TRIGGER_TERMS_EN, ...TRIP_TRIGGER_TERMS_FR, ...TRIP_TRIGGER_TERMS_EXTRA].join(', ')}.
- TRIP implies logisticsPotential=true (do not mention the boolean, just pick TRIP).`;
  const now = new Date();
  const tz =
    (() => {
      try {
        const o = Intl.DateTimeFormat().resolvedOptions();
        return typeof o.timeZone === 'string' && o.timeZone.trim() ? o.timeZone.trim() : 'local';
      } catch {
        return 'local';
      }
    })();
  const fullDateString = now.toISOString();
  const isoWeekday = ((now.getDay() + 6) % 7) + 1;
  const weekdayEn =
    (() => {
      try {
        return new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now);
      } catch {
        return 'Monday';
      }
    })();
  const dueTimeHm =
    (() => {
      try {
        return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
      } catch {
        return '00:00';
      }
    })();
  const anchorRule = `UNIVERSAL TEMPORAL ANCHOR (STRICT):
- Today is: ${weekdayEn}, ${fullDateString} (Local Time: ${tz})
- Current Human Time: ${weekdayEn} at ${dueTimeHm}
- RULE: If user mentions "${weekdayEn}" (today) without "next", set DUE_DATE to TODAY (J+0).`;
  return `${anchorRule}
lang=${lang2}
${loc}
${catContract}
${titleContract}
${tripContract}
Current Reference Time: [ISO: ${fullDateString} (${tz})]
Local heuristic (refine or override if wrong):
${seed}

Dictation:
"""${safe.replace(/"/g, '\\"')}"""

Reply ONLY with Bullet-Pipe lines starting with ">".
No JSON. No markdown. No explanations.

Output format (one line per intent):
> TYPE | CONTENT | CATEGORY_CODE | DUE_DATE

Constraints:
- TYPE: TRIP or TASK (prefer TRIP when movement/location is mentioned)
- CONTENT: keep the user's content in lang (do not translate); must follow DISPLAY TITLE CONTRACT above
- CATEGORY_CODE: one of the 10 codes above (uppercase)
- DUE_DATE: "YYYY-MM-DD HH:mm" or null

Examples:
> TRIP | <CONTENT> | TRAVEL | null`;
}

/**
 * **Path A** — inférence locale **synchrone** (aucun appel réseau).
 *
 * Enchaîne : nettoyage texte → classification grossière par regex (LIST, ANNIVERSARY, HABIT, RECURRING_TASK, TASK, NOTE)
 * → tag catégorie → titre ({@link generateSmartTitle} ou `titleHint`) → données par défaut + **chrono-node** pour
 * extraire date/heure quand pertinent → cas spéciaux LIST (split items), ANNIVERSARY (nom), NOTE (mémo).
 *
 * Utilisé dans Talk juste avant l’ouverture de la modale ; Path B ({@link refineOneTapWithGeminiCompressed}) reprend ce
 * résultat sans le jeter.
 *
 * @param transcript — Texte brut de dictée (sera nettoyé).
 * @param options.uiLocale — Locale pour titre et hints.
 * @param options.titleHint — Titre imposé (ex. verrouillé ou smart title déjà calculé par l’écran).
 */
export function inferOneTapSkeletonFromTranscript(
  transcript: string,
  options: { uiLocale: string; titleHint?: string },
): OneTapUniversalResult {
  const cleaned = cleanTranscriptText(transcript);
  const lower = cleaned.toLowerCase();
  let predictedType: OneTapPredictedType = 'NOTE';

  if (/\b(courses|liste de|liste d'|acheter|ingrédients|ingredients|valise|packing|matériel pour|caddie)\b/i.test(cleaned)) {
    predictedType = 'LIST';
  } else if (/\b(anniversaire|fête de|fete de|né le|nee le)\b/i.test(cleaned) || /\b(mamie|papy|grand-mère|grand-père)\b/i.test(lower)) {
    predictedType = 'ANNIVERSARY';
  } else if (
    /\b(chaque jour|tous les jours|chaque matin|tous les matins|habitude|routine|quotidien)\b/i.test(cleaned) &&
    !/\b(demain|après-demain|à \d{1,2}(?:[:h]\d{2}|h\b))\b/i.test(cleaned)
  ) {
    predictedType = 'HABIT';
  } else if (/\b(chaque semaine|tous les lundis|toutes les semaines|récurrent|recurrent)\b/i.test(cleaned)) {
    predictedType = 'RECURRING_TASK';
  } else if (
    /\b(rappel|demain|après-demain|ce soir|dans \d+\s*minutes?|à \d{1,2}(?:[:h]\d{2}|h\b)|rendez-vous|rdv)\b/i.test(cleaned) ||
    /\b(tâche|task)\b/i.test(lower)
  ) {
    predictedType = 'TASK';
  }

  let categoryTag: OneTapCategoryCode = 'PERSO';
  if (/\b(dentiste|docteur|médecin|medecin|kine|kiné|hôpital|hopital|sport|gym)\b/i.test(cleaned)) categoryTag = 'HEALTH';
  else if (/\b(facture|banque|budget|impôt|impot|paiement|payer)\b/i.test(cleaned)) categoryTag = 'FINANCE';
  else if (/\b(travail|bureau|réunion|reunion|client|linkedin|projet|pro)\b/i.test(lower)) categoryTag = 'WORK';
  else if (/\b(maison|home|famille|bricolage)\b/i.test(lower)) categoryTag = 'HOME';
  else if (predictedType === 'LIST') categoryTag = 'SHOP';

  const title =
    (options.titleHint || generateSmartTitle(cleaned, options.uiLocale) || cleaned).trim().slice(0, 200) || 'Note';

  let base = defaultOneTapDataForType(predictedType);
  const ref = new Date();
  const chronoResults =
    (() => {
      const loc = String(options.uiLocale || 'fr').toLowerCase();
      const lang2 = loc.slice(0, 2);
      const chronoInput =
        lang2 === 'fr'
          ? cleaned
              .replace(/\b(\d{1,2})\s*h\s*(\d{2})\b/gi, '$1:$2')
              .replace(/\b(\d{1,2})\s*h\b/gi, '$1:00')
          : cleaned;
      const mod = (
        lang2 === 'fr'
          ? chrono.fr
          : lang2 === 'en'
            ? chrono.en
            : lang2 === 'de'
              ? chrono.de
              : lang2 === 'it'
                ? chrono.it
                : lang2 === 'es'
                  ? chrono.es
                  : lang2 === 'ja'
                    ? chrono.ja
                    : lang2 === 'zh'
                      ? chrono.zh
                      : lang2 === 'nl'
                        ? chrono.nl
                        : lang2 === 'sv'
                          ? chrono.sv
                          : null
      ) as unknown as { parse?: (t: string, r?: Date, o?: Record<string, unknown>) => unknown[] } | null;
      if (mod?.parse) {
        return mod.parse(chronoInput, ref, { forwardDate: true }) as unknown[];
      }
      return chrono.parse(chronoInput, ref, { forwardDate: true }) as unknown[];
    })() as unknown as chrono.ParsedResult[];
  if (chronoResults.length > 0 && (predictedType === 'TASK' || predictedType === 'NOTE' || predictedType === 'HABIT')) {
    const start = chronoResults[0].start?.date();
    if (start && !Number.isNaN(start.getTime())) {
      const y = start.getFullYear();
      const m = String(start.getMonth() + 1).padStart(2, '0');
      const day = String(start.getDate()).padStart(2, '0');
      const ymd = `${y}-${m}-${day}`;
      const hh = String(start.getHours()).padStart(2, '0');
      const mm = String(start.getMinutes()).padStart(2, '0');
      const hm = `${hh}:${mm}`;
      if (predictedType === 'TASK') {
        base = { ...base, dueDateYmd: ymd, dueTimeHm: hm, notes: cleaned.slice(0, 2000) };
      } else if (predictedType === 'NOTE') {
        base = { ...base, dueDateYmd: ymd, dueTimeHm: hm };
      } else if (predictedType === 'HABIT') {
        base = { ...base, preferredTimeHm: hm, cadenceDescription: base.cadenceDescription || 'Quotidien' };
      }
    }
  }

  if (predictedType === 'LIST') {
    const items = cleaned
      .split(/[,;]|(?:\bpuis\b)|(?:\bet\b)/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length < 80)
      .slice(0, 24);
    if (items.length >= 1) {
      base = buildListDataFromWireItems(items, title) as Record<string, unknown>;
    }
  }

  if (predictedType === 'ANNIVERSARY') {
    const mPerson = cleaned.match(/(?:anniversaire|fête)\s+(?:de\s+)?(.+?)(?:\.|,|$)/i);
    const person = mPerson?.[1]?.trim().slice(0, 120) || title;
    base = { ...base, personName: person, monthDay: typeof base.monthDay === 'string' ? base.monthDay : '' };
  }

  if (predictedType === 'NOTE') {
    base = { ...base, memo: cleaned.slice(0, 4000) };
  }

  const travelHint = shouldForceTripFromTranscript(cleaned);

  if (travelHint) {
    predictedType = 'TRIP';
    categoryTag = 'TRAVEL';
    const nextBase = defaultOneTapDataForType('TRIP');
    base = { ...nextBase, ...base, logisticsPotential: true };
  }

  return {
    predictedType,
    categoryTag: normalizeOneTapCategoryCode(categoryTag),
    title,
    data: normalizeUniversalTemporalInData(base),
  };
}

export type OneTapRefineOptions = {
  uiLocale: string;
  lang?: string;
  /** Si défini, appelé à chaque chunk utile (streaming). */
  onPartial?: (draft: OneTapUniversalResult) => void;
  /** false = un seul aller-retour HTTP (ex. machine à intentions). */
  useStream?: boolean;
  /**
   * Repères `performance.now()` (Talk) pour le log terminal `[OneTapPerf] 🏁 END_TO_END_CHAIN`.
   * `t0` = fin capture, `t1` = entrée lot async (après squelette local).
   */
  chainPerf?: { t0: number; t1: number };
};

/**
 * **Path B** — affinage **Gemini** sur la base du squelette Path A.
 *
 * 1. Construit `seed` + prompt via {@link buildCompressedGeminiPrompt}.
 * 2. Appelle {@link geminiStreamOneTapCompressedLine} ou {@link geminiGenerateOneTapCompressedLine} selon `useStream`.
 * 3. À chaque chunk (stream) ou à la fin (non-stream), parse la ligne avec {@link parsePartialWireLine} /
 *    {@link parseOneTapWireLine} et fusionne avec {@link mergeWireIntoOneTapSkeleton} ; `onPartial` permet de mettre à
 *    jour la modale en temps réel.
 * 4. Si le brut ressemble à du JSON, tente {@link parseOneTapUniversalJson} en secours (certains modèles renvoient un
 *    objet au lieu de la ligne filaire).
 * 5. Garantit un titre non vide (repli sur `skeleton.title`).
 *
 * Le **choix de modèle** et le **self-healing** 404/listModels sont gérés dans {@link geminiSemanticLab}, pas ici.
 *
 * @param transcript — Même dictée que pour Path A (cohérence du prompt).
 * @param skeleton — Sortie de {@link inferOneTapSkeletonFromTranscript} (ancrage fort pour le modèle).
 * @param options.useStream — `true` par défaut : une requête streaming ; `false` pour un seul aller-retour HTTP.
 * @param options.onPartial — Reçoit un brouillon fusionné à chaque parse partiel utile (streaming).
 */
export async function refineOneTapWithGeminiCompressed(
  transcript: string,
  skeleton: OneTapUniversalResult,
  options: OneTapRefineOptions,
): Promise<{ parsed: OneTapUniversalResult; rawModelText: string; httpMeta: GeminiHttpSettledMeta }> {
  if (getDebugUserTierOverrideCached() === 'force_free') {
    console.log('[OneTap] Mode FREE actif : Limitation simulée');
  }
  if (VERBOSE_DEBUG) console.log(`[OneTap] 🎤 TRANSCRIPTION: ${JSON.stringify(transcript)}`);

  const seed = wireLineFromSkeleton(skeleton);
  const prompt = buildCompressedGeminiPrompt(transcript, seed);
  const useStream = options.useStream !== false;
  const pathBGeminiStart = perfNowMs();
  const lang2 = baseLangFromBcp47(detectLangForOneTapPrompt(transcript, ''));
  if (VERBOSE_DEBUG) {
    console.log('[GeminiDebug] 🛡️ PROMPT_PARAMS:', { lang2, transcriptHead: transcript.slice(0, 20) });
    console.log('[GeminiDebug] 📝 FULL_PROMPT_SENT:', prompt);
  }

  const pathBLog: GeminiPathBLogAnchor = {
    pathACategoryTag: skeleton.categoryTag,
    pathAPredictedType: skeleton.predictedType,
    pathAData: { ...skeleton.data },
  };

  let lastEmittedCount = 0;
  let lastPartialSig = '';
  const applyBuffer = (buf: string) => {
    const parsedIntents = parseBulletPipeIntentsFromBuffer(buf, useStream);
    const extractedIntents = parsedIntents.length ? parsedIntents : parseJsonIntentsFromBuffer(buf, useStream);
    if (!extractedIntents.length) return;
    const intents = annotateIncompletes(extractedIntents, transcript, skeleton);
    const sig = intents
      .map((it) => {
        const t = String(it.type ?? '').toUpperCase();
        const title = String(
          (it as Record<string, unknown>).title ??
            (it as Record<string, unknown>).content ??
            (it as Record<string, unknown>).destination ??
            '',
        );
        const itemsLen = Array.isArray((it as Record<string, unknown>).items)
          ? ((it as Record<string, unknown>).items as unknown[]).length
          : 0;
        return `${t}:${title.trim()}:${itemsLen}:${it.incomplete === true ? 1 : 0}`;
      })
      .join('|');

    if (intents.length > lastEmittedCount) {
      for (let i = lastEmittedCount; i < intents.length; i++) {
        const merged = mergeIntentArrayIntoOneTapSkeleton(skeleton, intents.slice(0, i + 1));
        options.onPartial?.(merged);
      }
      lastEmittedCount = intents.length;
      lastPartialSig = sig;
      return;
    }

    if (sig !== lastPartialSig) {
      lastPartialSig = sig;
      const merged = mergeIntentArrayIntoOneTapSkeleton(skeleton, intents);
      options.onPartial?.(merged);
    }
  };

  let rawModelText: string;
  let httpMeta: GeminiHttpSettledMeta | undefined;
  const netStart = perfNowMs();
  if (useStream) {
    const r = await geminiStreamOneTapCompressedLine(prompt, (acc) => applyBuffer(acc), pathBLog);
    rawModelText = r.raw;
    httpMeta = r.httpMeta;
  } else {
    const r = await geminiGenerateOneTapCompressedLine(prompt, pathBLog);
    rawModelText = r.raw;
    httpMeta = r.httpMeta;
    applyBuffer(rawModelText);
  }
  const netEnd = perfNowMs();

  const parseStart = perfNowMs();
  let parsed = skeleton;
  const bp = parseBulletPipeIntentsFromBuffer(rawModelText, false);
  const extractedFinal = bp.length ? bp : parseJsonIntentsFromBuffer(rawModelText, false);
  if (extractedFinal.length) {
    parsed = mergeIntentArrayIntoOneTapSkeleton(parsed, annotateIncompletes(extractedFinal, transcript, skeleton));
  } else {
    if (rawModelText.includes('"intents"')) {
      const forced = parseJsonIntentsFromBuffer(rawModelText, false);
      if (forced.length) {
        parsed = mergeIntentArrayIntoOneTapSkeleton(parsed, annotateIncompletes(forced, transcript, skeleton));
      } else if (VERBOSE_DEBUG) {
        console.log('[GeminiDebug] ⚠️ INVALID_BULLET_PIPE_OUTPUT:', rawModelText.slice(0, 600));
      }
    } else if (VERBOSE_DEBUG) {
      console.log('[GeminiDebug] ⚠️ INVALID_BULLET_PIPE_OUTPUT:', rawModelText.slice(0, 600));
    }
  }
  if (!parsed.title.trim()) {
    parsed = { ...parsed, title: skeleton.title };
  }
  const parseEnd = perfNowMs();
  console.log('[GeminiPerf] ⏱️ TIMING:', {
    network_ms: Math.round(netEnd - netStart),
    parsing_ms: Math.round(parseEnd - parseStart),
  });

  const skLabel = `${String(skeleton.data.destination_name ?? '').trim()}|${String(skeleton.data.location_address ?? '').trim()}`;
  const pdDest = typeof parsed.data.destination_name === 'string' ? parsed.data.destination_name.trim() : '';
  const pdLoc = typeof parsed.data.location_address === 'string' ? parsed.data.location_address.trim() : '';
  const pdLabel = `${pdDest}|${pdLoc}`;
  if (pdLabel !== '|' && pdLabel !== skLabel) {
    logOneTapLogisticsRecognized(pdDest || pdLoc, 'IA');
  }

  const pathBGeminiEnd = perfNowMs();
  const geminiRefineMs = Math.round(pathBGeminiEnd - pathBGeminiStart);
  const metaModelId = getActiveGeminiModelId();
  const metaForLog: GeminiHttpSettledMeta =
    httpMeta ?? {
      modelId: metaModelId,
      latencyMs: geminiRefineMs,
      tokensPrompt: null,
      tokensCompletion: null,
      tokensTotal: null,
      estimatedCostUsd: 0,
      fallbackUsed: false,
      operation: useStream ? 'oneTap.wire.stream' : 'oneTap.wire.nonstream',
      versionLabel: /-latest$/i.test(metaModelId) ? 'v1beta' : 'v1',
    };
  const safeTitle = (parsed.title || skeleton.title).trim().slice(0, 200) || skeleton.title;
  const baseData =
    parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data) ? (parsed.data as Record<string, unknown>) : {};
  const syncedTemporalData = syncYmdHmFromDueDateTime(baseData);
  const parsedWithPerfMeta: OneTapUniversalResult = {
    ...parsed,
    title: safeTitle,
    data: {
      ...(syncedTemporalData ?? {}),
      ai_model_used: metaForLog.modelId,
      ai_latency_ms: metaForLog.latencyMs,
      tokens_prompt: metaForLog.tokensPrompt,
      tokens_completion: metaForLog.tokensCompletion,
      tokens_total: metaForLog.tokensTotal,
      ai_cost_usd: metaForLog.estimatedCostUsd,
      debug_tokens: metaForLog.tokensTotal,
      debug_latency_ms: metaForLog.latencyMs,
    },
  };
  logGeminiApiPathBResolvedSuccess(metaForLog, {
    categoryTag: parsedWithPerfMeta.categoryTag,
    data: parsedWithPerfMeta.data,
  });

  const cp = options.chainPerf;
  if (cp) {
    const t0ToT1 = Math.round(cp.t1 - cp.t0);
    const totalFromT0 = Math.round(pathBGeminiEnd - cp.t0);
    console.log(
      `[OneTapPerf] 🏁 END_TO_END_CHAIN${OT_LOG}T0 (End Capture) -> T1 (Local Skeleton): ${t0ToT1}ms${OT_LOG}T1 -> T3 (Gemini Refinement): ${geminiRefineMs}ms${OT_LOG}TOTAL_LATENCY: ${totalFromT0}ms${OT_LOG}RESULT_CAT: ${parsed.categoryTag}`,
    );
  }

  return { parsed: parsedWithPerfMeta, rawModelText, httpMeta: metaForLog };
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
  const rawData =
    obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data) ? (obj.data as Record<string, unknown>) : {};
  const defaults = defaultOneTapDataForType(predictedType as OneTapPredictedType);
  const data = normalizeUniversalTemporalInData({ ...defaults, ...rawData });
  return {
    predictedType: predictedType as OneTapPredictedType,
    categoryTag,
    title,
    data,
  };
}

/**
 * Enchaînement **A + B non-streaming** : même pipeline que Talk (squelette local puis refine), pour les écrans qui
 * n’ont pas besoin de streaming (ex. flux sans modale progressive).
 *
 * Journalise `[OneTapPerf] prompt.metrics` avec taille du prompt, durée Gemini et parse (approximatif).
 *
 * @param transcript — Texte final de la dictée.
 * @param options.uiLocale — Locale pour le prompt Path B.
 * @returns Résultat parsé, brut modèle (debug), et timings internes pour analyse.
 */
export async function geminiOneTapUniversalFromTranscript(
  transcript: string,
  options: { uiLocale: string },
): Promise<{
  parsed: OneTapUniversalResult;
  rawModelText: string;
  timings: { promptChars: number; geminiStartMs: number; geminiEndMs: number; parseEndMs: number };
}> {
  logOneTapCaptureCycleStartBanner();
  const skeleton = inferOneTapSkeletonFromTranscript(transcript, { uiLocale: options.uiLocale });
  const clean = transcript.trim();
  const lower = clean.toLowerCase();
  const lacksStructuredSignals =
    !/\b(\d{4}-\d{2}-\d{2}|demain|après-demain|rendez-vous|rdv|à \d{1,2}[:h]\d{2}|chez|au |à la|a la|dentiste|tennis|pêche|peche)\b/i.test(
      clean,
    ) &&
    !/\b(destination|adresse|lieu|where|location)\b/i.test(lower);
  const hasIntentKeyword = /\b(acheter|aller|faire|rdv|rendez-vous|planifier|prévoir|appeler|envoyer|payer|réserver|book|todo|task)\b/i.test(
    clean,
  );
  const isLongMemoLikely =
    clean.length >= 260 && skeleton.predictedType === 'NOTE' && lacksStructuredSignals && !hasIntentKeyword;
  if (isLongMemoLikely) {
    const parsed = {
      ...skeleton,
      data: normalizeUniversalTemporalInData({
        ...skeleton.data,
        is_long_memo: true,
      }),
    };
    return {
      parsed,
      rawModelText: '',
      timings: { promptChars: 0, geminiStartMs: 0, geminiEndMs: 0, parseEndMs: 0 },
    };
  }
  const geminiStartMs = perfNowMs();
  const { parsed, rawModelText } = await refineOneTapWithGeminiCompressed(transcript, skeleton, {
    uiLocale: options.uiLocale,
    useStream: false,
  });
  const geminiEndMs = perfNowMs();
  const parseEndMs = perfNowMs();
  const promptLen = buildCompressedGeminiPrompt(transcript, wireLineFromSkeleton(skeleton)).length;
  console.log(
    `[OneTapPerf] prompt.metrics${OT_LOG}promptChars: ${promptLen}${OT_LOG}geminiMs: ${Math.round(geminiEndMs - geminiStartMs)}${OT_LOG}parseMs: ${Math.round(parseEndMs - geminiEndMs)}`,
  );
  return { parsed, rawModelText, timings: { promptChars: promptLen, geminiStartMs, geminiEndMs, parseEndMs } };
}

/**
 * Données minimales par type lorsque l’utilisateur change le type dans l’UI.
 *
 * @param type — Type sélectionné.
 * @returns Objet **data** par défaut (non null).
 */
export function defaultOneTapDataForType(type: OneTapPredictedType): Record<string, unknown> {
  const u = universalTemporalDefaults();
  switch (type) {
    case 'TASK':
      return {
        ...u,
        dueDateYmd: null,
        dueTimeHm: null,
        reminderMinutesBefore: null,
        notes: '',
        logisticsPotential: false,
        destination_name: '',
        remind_to_leave: false,
        location_address: '',
      };
    case 'RECURRING_TASK':
      return {
        ...u,
        cadenceDescription: '',
        nextDueYmd: null,
        anchorNotes: '',
        logisticsPotential: false,
        destination_name: '',
        remind_to_leave: false,
        location_address: '',
      };
    case 'HABIT':
      return {
        ...u,
        cadenceDescription: '',
        preferredTimeHm: null,
        notes: '',
        logisticsPotential: false,
        destination_name: '',
        remind_to_leave: false,
        location_address: '',
      };
    case 'TRIP':
      return {
        ...u,
        logisticsPotential: true,
        destination_name: '',
        remind_to_leave: false,
        location_address: '',
        arrivalDue: null,
        transportMode: 'auto',
      };
    case 'LIST':
      return {
        ...u,
        list: {
          title: '',
          baseCount: 1,
          unitLabel: 'personne',
          categories: [
            { name: '—', items: [{ name: '—', baseQuantity: 1, unit: 'piece', scalable: true }] },
          ],
        },
      };
    case 'ANNIVERSARY':
      return { ...u, personName: '', monthDay: '', reminderDaysBefore: 7 };
    case 'NOTE':
    default:
      return { ...u, memo: '' };
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
  const tail = universalTailFromPrev(prevData);
  if (nextType === 'LIST') {
    const list = prevData.list && typeof prevData.list === 'object' ? (prevData.list as Record<string, unknown>) : null;
    if (list && Array.isArray(list.categories)) {
      return { list, ...tail };
    }
    const b = base.list as Record<string, unknown>;
    return { list: { ...b, title: title || String(b.title || '') }, ...tail };
  }
  if (nextType === 'TASK') {
    return {
      ...base,
      dueDateYmd: typeof prevData.dueDateYmd === 'string' ? prevData.dueDateYmd : prevData.nextDueYmd ?? null,
      notes: String(prevData.notes || prevData.memo || prevData.anchorNotes || ''),
      ...tail,
    };
  }
  if (nextType === 'TRIP') {
    return {
      ...base,
      logisticsPotential: true,
      destination_name: String(prevData.destination_name ?? prevData.location_address ?? '').trim(),
      location_address: String(prevData.location_address ?? '').trim(),
      remind_to_leave: Boolean(prevData.remind_to_leave),
      ...tail,
    };
  }
  if (nextType === 'NOTE') {
    return { memo: String(prevData.memo || prevData.notes || ''), ...tail };
  }
  return { ...base, ...prevData, ...tail };
}
