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

function parseBulletPipeIntentsFromBuffer(buffer: string, partial: boolean): OneTapIntentJson[] {
  const s = String(buffer || '');
  const parts = s.split('\n');
  const lines = partial && !s.endsWith('\n') ? parts.slice(0, -1) : parts;
  const intents: OneTapIntentJson[] = [];
  let currentList: OneTapIntentJson | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('>')) continue;
    const isItem = line.startsWith('>>');
    const body = isItem ? line.slice(2).trim() : line.slice(1).trim();
    if (!body) continue;
    const segs = body
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean);
    if (segs.length < 2) continue;
    const type = segs[0].toUpperCase();
    const content = segs[1];
    if (!content) continue;

    if (isItem) {
      if (type !== 'ITEM') continue;
      if (!currentList || currentList.type !== 'LIST') {
        currentList = {
          type: 'LIST',
          title: 'Liste',
          baseCount: 1,
          unitLabel: 'personne',
          items: [],
        };
        intents.push(currentList);
      }
      const qtyRaw = segs.length >= 3 ? segs[2] : '';
      const unit = segs.length >= 4 ? segs[3] : 'piece';
      const scalableRaw = segs.length >= 5 ? segs[4] : 'true';
      const q = Number(String(qtyRaw).replace(',', '.'));
      const qty = Number.isFinite(q) && q > 0 ? q : 1;
      const sraw = String(scalableRaw).trim().toLowerCase();
      const scalable = !(sraw === 'false' || sraw === '0' || sraw === 'no' || sraw === 'non');
      const arr = Array.isArray(currentList.items) ? (currentList.items as ListItemDraft[]) : [];
      arr.push({
        name: content,
        qty,
        unit,
        scalable,
        includeInSave: true,
      });
      currentList.items = arr;
      continue;
    }

    currentList = null;

    if (type === 'TASK') {
      const due = segs.length >= 3 ? segs[2] : '';
      intents.push({ type: 'TASK', content, due });
      continue;
    }
    if (type === 'NOTE') {
      intents.push({ type: 'NOTE', content });
      continue;
    }
    if (type === 'HABIT') {
      const recurrence = segs.length >= 3 ? segs[2] : '';
      intents.push({ type: 'HABIT', content, recurrence });
      continue;
    }
    if (type === 'TRIP') {
      const due = segs.length >= 3 ? segs[2] : '';
      intents.push({ type: 'TRIP', destination: content, arrivalDue: due });
      continue;
    }
    if (type === 'LIST') {
      const baseCountRaw = segs.length >= 3 ? segs[2] : '1';
      const unitLabelRaw = segs.length >= 4 ? segs[3] : 'personne';
      const bc = parseInt(String(baseCountRaw).trim(), 10);
      const baseCount = Number.isFinite(bc) && bc > 0 ? bc : 1;
      const unitLabel = String(unitLabelRaw || 'personne').trim().slice(0, 40) || 'personne';
      currentList = { type: 'LIST', title: content, baseCount, unitLabel, items: [] };
      intents.push(currentList);
      continue;
    }
  }
  return intents;
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
  const nextTitle = (hasTrip ? tripTitle : title).trim().slice(0, 200) || skeleton.title;
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
  const categoryTag = (wire.K?.trim() || skeleton.categoryTag || 'Perso').slice(0, 80) || 'Perso';
  const title = (wire.T?.trim() || skeleton.title || 'Note').trim().slice(0, 200);
  const mergedBase = { ...(skeleton.data as Record<string, unknown>) };
  const wirePatch = patchDataFromWire(wire);
  const logisticsPatch = mergeLogisticsFromWire(wire, { ...mergedBase, ...wirePatch });
  const data = normalizeUniversalTemporalInData({ ...mergedBase, ...wirePatch, ...logisticsPatch });
  return { ...skeleton, categoryTag, title, data };
}

function buildCompressedGeminiPrompt(transcript: string, seedLine: string, uiLocale: string): string {
  const safe = transcript.length > 12_000 ? transcript.slice(0, 12_000) : transcript;
  const lang = String(uiLocale || 'fr').trim() || 'fr';
  const loc = lang.toLowerCase().startsWith('en')
    ? 'Prefer English for K, T, N, C, R text when natural.'
    : 'Préfère le français pour K, T, N, C, R quand c’est naturel.';
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
  const fullDateString =
    (() => {
      try {
        return now.toLocaleString(lang, { dateStyle: 'full', timeStyle: 'long' });
      } catch {
        return now.toString();
      }
    })();
  return `${loc}
Current Reference Time: [Locale: ${lang}, Date: ${fullDateString} (${tz})]
Local heuristic (refine or override if wrong):
${seedLine}

Dictation:
"""${safe.replace(/"/g, '\\"')}"""

Reply ONLY with lines starting with ">" and pipe-separated segments. No markdown, no explanations.
For LIST use multi-line format:
> LIST | Title | baseCount | unitLabel
>> ITEM | Name | quantity | unit | scalable`;
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

  let categoryTag = 'Perso';
  if (/\b(travail|bureau|réunion|client|linkedin|pro)\b/i.test(lower)) categoryTag = 'Travail';
  else if (/\b(famille|mamie|papa|maman|enfants|couple)\b/i.test(lower)) categoryTag = 'Famille';

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

  const travelHint =
    /\b(aller|rendez-vous|rdv|chez|déplacement|déplacer|à la|a la|au |à l'|a l'|en train|avion|gare|aéroport|hôpital|hopital|dentiste|kiné|kine|piscine|tennis|foot|gym|salle de sport|séance|salle)\b/i.test(
      cleaned,
    ) ||
    /\b(pêche|peche|étang|cabane)\b/i.test(lower);

  if (travelHint) {
    predictedType = 'TRIP';
    const nextBase = defaultOneTapDataForType('TRIP');
    base = { ...nextBase, ...base, logisticsPotential: true };
  }

  return {
    predictedType,
    categoryTag,
    title,
    data: normalizeUniversalTemporalInData(base),
  };
}

export type OneTapRefineOptions = {
  uiLocale: string;
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
): Promise<{ parsed: OneTapUniversalResult; rawModelText: string }> {
  if (getDebugUserTierOverrideCached() === 'force_free') {
    console.log('[OneTap] Mode FREE actif : Limitation simulée');
  }
  console.log(`[OneTap] 🎤 TRANSCRIPTION: ${JSON.stringify(transcript)}`);

  const seed = wireLineFromSkeleton(skeleton);
  const prompt = buildCompressedGeminiPrompt(transcript, seed, options.uiLocale);
  const useStream = options.useStream !== false;
  const pathBGeminiStart = perfNowMs();

  const pathBLog: GeminiPathBLogAnchor = {
    pathACategoryTag: skeleton.categoryTag,
    pathAPredictedType: skeleton.predictedType,
    pathAData: { ...skeleton.data },
  };

  const applyBuffer = (buf: string) => {
    const intents = parseBulletPipeIntentsFromBuffer(buf, useStream);
    if (!intents.length) return;
    const merged = mergeIntentArrayIntoOneTapSkeleton(skeleton, intents);
    options.onPartial?.(merged);
  };

  let rawModelText: string;
  let httpMeta: GeminiHttpSettledMeta | undefined;
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

  let parsed = skeleton;
  const bp = parseBulletPipeIntentsFromBuffer(rawModelText, false);
  if (bp.length) {
    parsed = mergeIntentArrayIntoOneTapSkeleton(parsed, bp);
  } else {
    for (const w of parseOneTapWireLineBlocks(rawModelText)) {
      parsed = mergeWireIntoOneTapSkeleton(parsed, w);
    }
    const jsonObj = tryParseJsonObjectBestEffort(rawModelText);
    if (jsonObj) {
      try {
        parsed = parseOneTapUniversalJson(JSON.stringify(jsonObj));
      } catch {
        /* keep wire merge */
      }
    }
  }
  if (!parsed.title.trim()) {
    parsed = { ...parsed, title: skeleton.title };
  }

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
      fallbackUsed: false,
      operation: useStream ? 'oneTap.wire.stream' : 'oneTap.wire.nonstream',
      versionLabel: /-latest$/i.test(metaModelId) ? 'v1beta' : 'v1',
    };
  logGeminiApiPathBResolvedSuccess(metaForLog, {
    categoryTag: parsed.categoryTag,
    data: parsed.data,
  });

  const cp = options.chainPerf;
  if (cp) {
    const t0ToT1 = Math.round(cp.t1 - cp.t0);
    const totalFromT0 = Math.round(pathBGeminiEnd - cp.t0);
    console.log(
      `[OneTapPerf] 🏁 END_TO_END_CHAIN${OT_LOG}T0 (End Capture) -> T1 (Local Skeleton): ${t0ToT1}ms${OT_LOG}T1 -> T3 (Gemini Refinement): ${geminiRefineMs}ms${OT_LOG}TOTAL_LATENCY: ${totalFromT0}ms${OT_LOG}RESULT_CAT: ${parsed.categoryTag}`,
    );
  }

  return { parsed, rawModelText };
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
  const promptLen = buildCompressedGeminiPrompt(transcript, wireLineFromSkeleton(skeleton), options.uiLocale).length;
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
