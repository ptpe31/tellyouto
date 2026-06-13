/**
 * Persistance des intentions issues du flux **one-tap** (JSON unifié déjà interprété).
 * Douane DB : mapping `OneTapUniversalResult` → `TrankilV2IntentionInsert`, Pass 2 LIST/PROJECT,
 * NOTE_FALLBACK — voir `PROJECT_STATUS.md` §2.4 / §3.3.
 *
 * @module oneTapPersist
 */

import type { TrankilV2IntentionInsert } from '../api/trankilV2Db';
import {
  consumeListFreeSuccessOnce,
  getListFreeQuotaSnapshot,
  insertTrankilV2Intention,
  patchMetadata,
  replaceTrankilV2IntentionOneTap,
} from '../api/trankilV2Db';
import type { CaptureStrategyDeps } from './captureStrategies/types';
import {
  buildListInventoryJsonStringFromDraftBlock,
  geminiJsonToStoredPayload,
  buildListMetadataPatch,
  parseGeminiListInventoryJson,
} from './listIntentionModel';
import { buildLocalTemporalIntentionInsertRow } from './localTemporalIntention';
import type { OneTapUniversalResult } from './oneTapUniversalCapture';
import { normalizeOneTapContextTag } from './oneTapUniversalCapture';
import { cancelOneTapUniversalReminders, scheduleOneTapUniversalReminders } from './oneTapUniversalReminders';
import { buildTravelMetadataFromOneTap } from '../../src_v2/services/travel/engine';
import { buildProjectMilestonesMetadataPatch, ensureProjectMilestoneUids } from './projectMilestonesModel';
import { NOTE_FALLBACK_LABEL } from './timelineIntentionVisibility';
import { coerceRecurrenceRule } from '../utils/habitRecurrenceRule';
import { parsePass1DueDateTime } from '../utils/pass1DueDateParse';
import { logCaptureFlow } from '../utils/captureFlowLog';
import {
  resolveDueConstraintFromCapture,
  shouldAutoPinOnCapturePersist,
} from '../features/livingHub/narrativePinRules';
import { formatYmdLocal } from './TimeSorter';


export type PersistOneTapSuccess =
  | {
      kind: 'persisted_temporal';
      intentionId: string;
      mirrorType: 'TASK' | 'HABIT';
      title: string;
      dueDateYmd: string | null;
      metadataJson?: string;
      recapIntroI18nKey: 'talkDebug.taskQuickRecapIntro' | 'talkDebug.habitQuickRecapIntro';
      consumedClassicFreeSlot: boolean;
    }
  | {
      kind: 'simple_note_or_audio';
      successFeedbackI18nKey: string;
      consumedClassicFreeSlot: boolean;
      intentionId?: string;
    }
  | {
      kind: 'list_inventory_persisted';
      intentionId: string;
      successFeedbackI18nKey: string;
      consumedListFreeSlot: boolean;
    }
  | {
      kind: 'project_persisted';
      intentionId: string;
      successFeedbackI18nKey: string;
      consumedClassicFreeSlot: boolean;
    };

export type PersistOneTapResult =
  | { ok: true; outcome: PersistOneTapSuccess }
  | { ok: false; error: unknown; code?: 'LIST_QUOTA' | 'LIST_SELECTION' };

export type PersistOneTapVentilatedResult =
  | { ok: true; outcomes: PersistOneTapSuccess[] }
  | { ok: false; error: unknown; code?: 'LIST_QUOTA' | 'LIST_SELECTION' };

export const DEBUG_MODE_DOUANE = true;

function str(d: Record<string, unknown>, key: string): string | null {
  const v = d[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function buildHabitMetadataFields(data: Record<string, unknown>, categoryTag: string) {
  const rule =
    (data.recurrence_rule && typeof data.recurrence_rule === 'object'
      ? data.recurrence_rule
      : coerceRecurrenceRule({
          recurrence_rule: data.recurrence_rule,
          recurrence: str(data, 'cadenceDescription') ?? undefined,
          preferredTime: str(data, 'preferredTimeHm') ?? undefined,
          skeletonCadence: str(data, 'cadenceDescription') ?? undefined,
        })) ?? undefined;
  return {
    source: 'one_tap_universal',
    categoryTag,
    cadenceDescription: str(data, 'cadenceDescription'),
    preferredTimeHm: str(data, 'preferredTimeHm'),
    ...(rule ? { recurrence_rule: rule } : {}),
    notes: str(data, 'notes'),
    destination_name: str(data, 'destination_name') ?? undefined,
    location_address: str(data, 'location_address') ?? undefined,
    remind_to_leave: Boolean(data.remind_to_leave) ? true : undefined,
  };
}

function resolveOneTapTemporalFields(data: Record<string, unknown>): {
  dueDateYmd: string | null;
  dueTimeHm: string | null;
  timeMarker: 'ALL_DAY' | 'EXACT_TIME';
  dueDateTime: string | null;
  isAllDay: number;
} {
  let dueDateYmd = str(data, 'dueDateYmd') ?? str(data, 'nextDueYmd');
  let dueTimeHm = str(data, 'dueTimeHm');
  let timeMarkerRaw = str(data, 'timeMarker');
  const arrivalDueRaw = str(data, 'arrivalDue');
  const preferArrivalDue =
    Boolean(data.logisticsPotential) || Boolean(arrivalDueRaw && /[ T]\d{1,2}:\d{2}/.test(arrivalDueRaw));
  let dueDateTime = preferArrivalDue && arrivalDueRaw ? arrivalDueRaw : str(data, 'dueDateTime') ?? arrivalDueRaw;

  if ((!dueDateYmd || !dueTimeHm) && dueDateTime) {
    const parsed = parsePass1DueDateTime(dueDateTime);
    dueDateYmd = dueDateYmd ?? parsed.dueDateYmd;
    dueTimeHm = dueTimeHm ?? parsed.dueTimeHm;
    timeMarkerRaw = timeMarkerRaw ?? parsed.timeMarker;
    dueDateTime = parsed.dueDateTime ?? dueDateTime;
  }

  if (dueDateYmd && !/^\d{4}-\d{2}-\d{2}$/.test(dueDateYmd)) {
    dueDateYmd = null;
  }

  const timeMarker: 'ALL_DAY' | 'EXACT_TIME' =
    timeMarkerRaw === 'EXACT_TIME' || timeMarkerRaw === 'ALL_DAY'
      ? timeMarkerRaw
      : dueTimeHm && dueTimeHm !== '00:00'
        ? 'EXACT_TIME'
        : 'ALL_DAY';

  return {
    dueDateYmd,
    dueTimeHm,
    timeMarker,
    dueDateTime,
    isAllDay: timeMarker === 'ALL_DAY' ? 1 : 0,
  };
}

function applyAutoPinFromCapture(
  row: TrankilV2IntentionInsert,
  data: Record<string, unknown>,
  transcript: string,
  temporal: ReturnType<typeof resolveOneTapTemporalFields>,
): TrankilV2IntentionInsert {
  const todayYmd = formatYmdLocal(new Date());
  const constraint = resolveDueConstraintFromCapture(data, transcript);
  const pin = shouldAutoPinOnCapturePersist({
    data,
    transcript,
    dueDateYmd: temporal.dueDateYmd ?? (row.due_date?.trim() || null),
    timeMarker: temporal.timeMarker,
    dueTimeHm: temporal.dueTimeHm,
    todayYmd,
  });
  if (!pin && constraint !== 'BEFORE') return row;
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(row.metadata_json || '{}') as Record<string, unknown>;
  } catch {
    meta = {};
  }
  if (constraint === 'BEFORE') meta.due_constraint = 'BEFORE';
  if (pin) meta.is_pinned = 1;
  return {
    ...row,
    is_pinned: pin ? 1 : row.is_pinned,
    metadata_json: JSON.stringify(meta, null, 2),
  };
}

function normalizeDomainCategoryId(raw: string | null | undefined): string {
  const up = String(raw || '').trim().toUpperCase();
  if (!up) return 'PERSO';
  if (up === 'FAMILLE') return 'HOME';
  if (up === 'PRO') return 'WORK';
  if (['HOME', 'WORK', 'PERSO', 'HEALTH', 'FINANCE', 'TRAVEL', 'SOCIAL', 'SHOP', 'LEARN', 'OTHER'].includes(up)) return up;
  return 'PERSO';
}

function contextTagForInsert(draft: OneTapUniversalResult): string | null {
  const normalized = normalizeOneTapContextTag(draft.contextTag);
  return normalized || null;
}

function resolveVentilatedIntentTags(
  r: Record<string, unknown>,
  draft: OneTapUniversalResult,
): { categoryTag: string; contextTag: string } {
  const categoryRaw =
    (typeof r.category === 'string' ? r.category.trim() : '') ||
    String(draft.categoryTag ?? '').trim() ||
    'PERSO';
  const contextRaw =
    (typeof r.context === 'string' ? r.context.trim() : '') ||
    (typeof r.contextTag === 'string' ? String(r.contextTag).trim() : '') ||
    String(draft.contextTag ?? '').trim();
  return {
    categoryTag: normalizeDomainCategoryId(categoryRaw),
    contextTag: normalizeOneTapContextTag(contextRaw),
  };
}

function logisticsFieldsFromDraft(
  data: Record<string, unknown>,
): Pick<TrankilV2IntentionInsert, 'remind_to_leave' | 'location_address'> {
  const remind = Boolean(data.remind_to_leave) ? 1 : 0;
  const loc = str(data, 'location_address');
  return { remind_to_leave: remind, location_address: loc };
}

function nextAnniversaryDueYmd(monthDay: string | null): string | null {
  if (!monthDay) return null;
  const s = monthDay.trim();
  let month = 0;
  let day = 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    month = Number(s.slice(5, 7));
    day = Number(s.slice(8, 10));
  } else if (/^\d{2}-\d{2}$/.test(s)) {
    month = Number(s.slice(0, 2));
    day = Number(s.slice(3, 5));
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const now = new Date();
  const y0 = now.getFullYear();
  const build = (y: number): Date | null => {
    const d = new Date(y, month - 1, day);
    if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d;
  };
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (let y = y0; y <= y0 + 2; y += 1) {
    const d = build(y);
    if (!d) continue;
    if (d.getTime() >= startToday) {
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const d1 = build(y0 + 1);
  if (!d1) return null;
  return `${d1.getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function mergeIntentionMetadataJson(
  currentJson: string | undefined,
  fragment: Record<string, unknown>,
): string {
  let base: Record<string, unknown> = {};
  try {
    const p = JSON.parse(currentJson || '{}');
    if (p && typeof p === 'object' && !Array.isArray(p)) base = p as Record<string, unknown>;
  } catch {}
  return JSON.stringify({ ...base, ...fragment }, null, 2);
}

function buildMetadataJsonForInsert(baseJson: string | null | undefined, draft: OneTapUniversalResult): string {
  const base = typeof baseJson === 'string' && baseJson.trim().length ? baseJson : '{}';
  return mergeIntentionMetadataJson(base, {
    ...buildTravelMetadataFromOneTap(draft),
    gemini_universal_draft: draft,
  });
}

/**
 * Mappe un brouillon OneTap vers une ligne `intentions` Trankil-v2 : type, métadonnées,
 * coût/tokens IA (`cost`, `tokens_*`), `category_id` normalisé (`normalizeDomainCategoryId`).
 */
async function materializeOneTapIntentionRow(params: {
  deps: CaptureStrategyDeps;
  draft: OneTapUniversalResult;
  transcript: string;
  intentionId: string;
  habitsDefaultTitle: string;
  birthdayLabel: string;
  isPendingAi: number;
  parentId?: string | null;
  parentJalonUid?: string | null;
}): Promise<TrankilV2IntentionInsert> {
  const { draft, transcript, intentionId, habitsDefaultTitle, birthdayLabel, isPendingAi, deps } = params;
  const title = draft.title.trim() || transcript.trim().slice(0, 200);
  const raw = transcript.trim();
  const created_at = Date.now();
  const domainCategoryId = normalizeDomainCategoryId(draft.categoryTag);
  const contextTagDb = contextTagForInsert(draft);
  const ai_model_used = typeof draft.data.ai_model_used === 'string' ? draft.data.ai_model_used.trim() : null;
  const ai_latency_ms = Number.isFinite(draft.data.ai_latency_ms as number) ? Number(draft.data.ai_latency_ms) : null;
  const tokens_prompt = Number.isFinite(draft.data.tokens_prompt as number) ? Number(draft.data.tokens_prompt) : null;
  const tokens_completion = Number.isFinite(draft.data.tokens_completion as number) ? Number(draft.data.tokens_completion) : null;
  const tokens_total = Number.isFinite(draft.data.tokens_total as number) ? Number(draft.data.tokens_total) : null;
  const cost = Number.isFinite(draft.data.ai_cost_usd as number) ? Number(draft.data.ai_cost_usd) : null;
  const debug_tokens = Number.isFinite(draft.data.debug_tokens as number) ? Number(draft.data.debug_tokens) : tokens_total;
  const debug_latency_ms =
    Number.isFinite(draft.data.debug_latency_ms as number) ? Number(draft.data.debug_latency_ms) : ai_latency_ms;
  const aiMeta: Pick<
    TrankilV2IntentionInsert,
    'ai_model_used' | 'ai_latency_ms' | 'tokens_prompt' | 'tokens_completion' | 'tokens_total' | 'cost' | 'debug_tokens' | 'debug_latency_ms'
  > = { ai_model_used, ai_latency_ms, tokens_prompt, tokens_completion, tokens_total, cost, debug_tokens, debug_latency_ms };

  switch (draft.predictedType) {
    case 'NOTE':
      return {
        id: intentionId,
        type: 'NOTE',
        title: title || deps.translate('timeline.note'),
        due_date: null,
        content_raw: raw,
        metadata_json: JSON.stringify(
          {
            source: 'one_tap_universal',
            categoryTag: draft.categoryTag,
            local_stt_transcript: raw,
            memo: str(draft.data, 'memo'),
          },
          null,
          2,
        ),
        suggested_tags: JSON.stringify(['sans_pression']),
        category_id: domainCategoryId,
        context_tag: contextTagDb,
        parent_id: params.parentId ?? null,
        status: 'TODO',
        is_organized: 0,
        is_local_processed: 1,
        complexity_level: 0,
        created_at,
        is_pending_ai: isPendingAi,
        ...aiMeta,
      };
    case 'TASK':
    case 'RECURRING_TASK': {
      const temporal = resolveOneTapTemporalFields(draft.data as Record<string, unknown>);
      const metaExtra: Record<string, unknown> = {
        source: 'one_tap_universal',
        categoryTag: draft.categoryTag,
        ...(temporal.dueTimeHm ? { dueTimeHm: temporal.dueTimeHm } : {}),
        ...(temporal.dueDateTime ? { dueDateTime: temporal.dueDateTime } : {}),
        timeMarker: temporal.timeMarker,
        is_all_day: temporal.isAllDay,
      };
      if (params.parentJalonUid) {
        metaExtra.zoom_parent_jalon_uid = params.parentJalonUid;
      }
      if (draft.predictedType === 'RECURRING_TASK') {
        metaExtra.recurring_task = draft.data;
      }
      const { row } = buildLocalTemporalIntentionInsertRow({
        id: intentionId,
        title,
        rawTranscript: raw,
        localType: 'TASK',
        dueDateYmd: temporal.dueDateYmd,
        categoryIdOverride: domainCategoryId,
        suggestedTags: [draft.categoryTag.toLowerCase().replace(/\s+/g, '_')],
        source: 'one_tap_task',
        timeMarker: temporal.timeMarker,
        metadataExtra: metaExtra,
        is_pending_ai: isPendingAi,
        created_at,
      });
      return applyAutoPinFromCapture(
        { ...row, parent_id: params.parentId ?? null, context_tag: contextTagDb, ...aiMeta },
        draft.data as Record<string, unknown>,
        raw,
        temporal,
      );
    }
    case 'TRIP': {
      const temporal = resolveOneTapTemporalFields(draft.data as Record<string, unknown>);
      const arrivalDueRaw = str(draft.data, 'arrivalDue');
      const dest = str(draft.data, 'destination_name') || title;
      const { row } = buildLocalTemporalIntentionInsertRow({
        id: intentionId,
        title: dest.slice(0, 200),
        rawTranscript: raw,
        localType: 'TASK',
        dueDateYmd: temporal.dueDateYmd,
        categoryIdOverride: domainCategoryId,
        suggestedTags: [draft.categoryTag.toLowerCase().replace(/\s+/g, '_')],
        source: 'one_tap_trip',
        timeMarker: temporal.timeMarker,
        metadataExtra: {
          source: 'one_tap_universal',
          categoryTag: draft.categoryTag,
          trip: draft.data,
          ...(temporal.dueTimeHm ? { dueTimeHm: temporal.dueTimeHm } : {}),
          ...(temporal.dueDateTime ? { dueDateTime: temporal.dueDateTime } : {}),
          ...(arrivalDueRaw ? { arrivalDue: arrivalDueRaw } : {}),
          timeMarker: temporal.timeMarker,
          is_all_day: temporal.isAllDay,
        },
        is_pending_ai: isPendingAi,
        created_at,
      });
      const tripArrivalDue =
        arrivalDueRaw ??
        (temporal.dueDateYmd && temporal.dueTimeHm
          ? `${temporal.dueDateYmd} ${temporal.dueTimeHm}`
          : temporal.dueDateTime);
      return applyAutoPinFromCapture(
        {
          ...row,
          due_date: tripArrivalDue ?? row.due_date ?? null,
          parent_id: params.parentId ?? null,
          context_tag: contextTagDb,
          ...logisticsFieldsFromDraft(draft.data as Record<string, unknown>),
          ...aiMeta,
        },
        draft.data as Record<string, unknown>,
        raw,
        temporal,
      );
    }
    case 'HABIT': {
      const habitTitle = (title || habitsDefaultTitle).slice(0, 200);
      return {
        id: intentionId,
        type: 'HABIT',
        title: habitTitle,
        due_date: null,
        content_raw: raw,
        metadata_json: JSON.stringify(
          buildHabitMetadataFields(draft.data as Record<string, unknown>, draft.categoryTag),
          null,
          2,
        ),
        suggested_tags: JSON.stringify(['sans_pression']),
        category_id: domainCategoryId,
        context_tag: contextTagDb,
        parent_id: params.parentId ?? null,
        status: 'TODO',
        is_organized: 0,
        is_local_processed: 1,
        complexity_level: 1,
        created_at,
        is_pending_ai: isPendingAi,
        ...logisticsFieldsFromDraft(draft.data as Record<string, unknown>),
        ...aiMeta,
      };
    }
    case 'ANNIVERSARY': {
      const personName = str(draft.data, 'personName') || title;
      const habitTitle = `🎂 ${birthdayLabel} ${personName}`.trim().slice(0, 200);
      const md = str(draft.data, 'monthDay');
      const dueDateYmd = nextAnniversaryDueYmd(md);
      const metadataForSync = JSON.stringify(
        {
          source: 'talk_debug_habit_local',
          type: 'ANNIVERSARY',
          recurrence: 'yearly',
          person_name: personName,
          month_day: md,
          categoryTag: draft.categoryTag,
        },
        null,
        2,
      );
      return {
        id: intentionId,
        type: 'HABIT',
        title: habitTitle,
        due_date: dueDateYmd,
        content_raw: raw,
        metadata_json: metadataForSync,
        suggested_tags: JSON.stringify(dueDateYmd ? ['regulier'] : ['sans_pression']),
        category_id: domainCategoryId,
        context_tag: contextTagDb,
        parent_id: params.parentId ?? null,
        status: 'TODO',
        is_organized: 0,
        is_local_processed: 1,
        complexity_level: 1,
        created_at,
        is_pending_ai: isPendingAi,
        ...aiMeta,
      };
    }
    case 'LIST': {
      const listBlock = draft.data.list;
      if (!listBlock || typeof listBlock !== 'object') {
        throw new Error('LIST_DATA_MISSING');
      }
      const jsonStr = buildListInventoryJsonStringFromDraftBlock(listBlock as Record<string, unknown>, title);
      const parsedList = parseGeminiListInventoryJson(jsonStr);
      const payload = geminiJsonToStoredPayload(parsedList);
      const mergedTitle = title || payload.title;
      const meta = JSON.stringify(buildListMetadataPatch({ ...payload, title: mergedTitle }));
      return {
        id: intentionId,
        type: 'LIST',
        title: mergedTitle,
        due_date: null,
        content_raw: raw,
        metadata_json: meta,
        suggested_tags: JSON.stringify(['sans_pression']),
        category_id: domainCategoryId,
        context_tag: contextTagDb,
        parent_id: params.parentId ?? null,
        status: 'TODO',
        is_organized: 0,
        is_local_processed: 1,
        complexity_level: 0,
        created_at,
        is_pending_ai: isPendingAi,
        ...aiMeta,
      };
    }
    case 'PROJECT': {
      const listBlock = draft.data.list && typeof draft.data.list === 'object' ? (draft.data.list as Record<string, unknown>) : null;
      const rawCats = listBlock && Array.isArray(listBlock.categories) ? (listBlock.categories as unknown[]) : [];
      const milestones = rawCats
        .flatMap((c) => {
          if (!c || typeof c !== 'object' || Array.isArray(c)) return [];
          const items = (c as Record<string, unknown>).items;
          if (!Array.isArray(items)) return [];
          return items
            .filter((it) => (it as Record<string, unknown>).includeInSave !== false)
            .map((it) => String((it as Record<string, unknown>).name ?? '').trim())
            .filter(Boolean);
        })
        .slice(0, 12)
        .map((m) => ({ uid: '', title: m.slice(0, 200), estimated_duration: 1, unit: 'days' as const, checked: false, pivot_date: null, note: null }));
      const mergedTitle = title.trim() || 'Projet';
      const payload = ensureProjectMilestoneUids({
        title: mergedTitle,
        milestones: milestones.length
          ? milestones
          : [{ uid: '', title: mergedTitle, estimated_duration: 1, unit: 'days' as const, checked: false, pivot_date: null, note: null }],
      });
      const meta = JSON.stringify({ ...buildProjectMilestonesMetadataPatch(payload), project: { start_date: null } });
      return {
        id: intentionId,
        type: 'PROJECT',
        title: mergedTitle,
        due_date: null,
        content_raw: raw,
        metadata_json: meta,
        suggested_tags: JSON.stringify(['sans_pression']),
        category_id: domainCategoryId,
        context_tag: contextTagDb,
        parent_id: params.parentId ?? null,
        status: 'TODO',
        is_organized: 0,
        is_local_processed: 1,
        complexity_level: 0,
        created_at,
        is_pending_ai: isPendingAi,
        ...aiMeta,
      };
    }
    default:
      throw new Error('unsupported_type');
  }
}

/**
 * Pré-enregistrement SQLite dès la réponse Gemini (brouillon `is_pending_ai = 1`).
 */
export async function preSaveOneTapOptimisticDraft(params: {
  deps: CaptureStrategyDeps;
  draft: OneTapUniversalResult;
  transcript: string;
  habitsDefaultTitle: string;
  birthdayLabel: string;
}): Promise<{ ok: true; intentionId: string } | { ok: false; error: unknown }> {
  const intentionId = params.deps.newId();
  try {
    const row = await materializeOneTapIntentionRow({
      ...params,
      intentionId,
      isPendingAi: 1,
    });
    await insertTrankilV2Intention(row);
    console.log(`[SQLite] Optimistic Save Success - ID: ${intentionId}`);
    return { ok: true, intentionId };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Met à jour une intention one-tap déjà insérée (même id) après affinage IA — garde `is_pending_ai = 1`.
 */
export async function replacePendingOneTapDraft(params: {
  deps: CaptureStrategyDeps;
  intentionId: string;
  draft: OneTapUniversalResult;
  transcript: string;
  habitsDefaultTitle: string;
  birthdayLabel: string;
}): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    const row = await materializeOneTapIntentionRow({
      deps: params.deps,
      draft: params.draft,
      transcript: params.transcript,
      intentionId: params.intentionId,
      habitsDefaultTitle: params.habitsDefaultTitle,
      birthdayLabel: params.birthdayLabel,
      isPendingAi: 1,
    });
    const { id: _id, created_at: _ct, ...patch } = row;
    await replaceTrankilV2IntentionOneTap(params.intentionId, patch);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Met à jour l’intention pré-enregistrée après validation modale (Option B).
 */
export async function finalizeOneTapOptimisticDraft(params: {
  deps: CaptureStrategyDeps;
  intentionId: string;
  draft: OneTapUniversalResult;
  transcript: string;
  habitsDefaultTitle: string;
  birthdayLabel: string;
}): Promise<PersistOneTapResult> {
  const { intentionId, deps, draft, transcript, habitsDefaultTitle, birthdayLabel } = params;
  const consumedClassic = !deps.spectrum.isProUser;
  const title = draft.title.trim() || transcript.trim().slice(0, 200);

  try {
    if (draft.predictedType === 'LIST') {
      if (!deps.spectrum.isProUser) {
        const gate = await getListFreeQuotaSnapshot();
        if (gate.remaining <= 0) {
          return { ok: false, error: new Error('list_quota_exhausted'), code: 'LIST_QUOTA' };
        }
      }
    }

    let row: TrankilV2IntentionInsert;
    try {
      row = await materializeOneTapIntentionRow({
        deps,
        draft,
        transcript,
        intentionId,
        habitsDefaultTitle,
        birthdayLabel,
        isPendingAi: 0,
      });
    } catch (e) {
      if (e instanceof Error && e.message === 'LIST_NO_ITEMS_SELECTED') {
        return { ok: false, error: e, code: 'LIST_SELECTION' };
      }
      return { ok: false, error: e };
    }

    const { id: _id, created_at: _ct, ...replacePatch } = row;
    await cancelOneTapUniversalReminders(intentionId);
    await replaceTrankilV2IntentionOneTap(intentionId, replacePatch);

    if (draft.predictedType === 'LIST' && !deps.spectrum.isProUser) {
      await consumeListFreeSuccessOnce();
    }

    void scheduleOneTapUniversalReminders({
      intentionId,
      title: row.title,
      data: draft.data,
      translate: deps.translate,
    });

    switch (draft.predictedType) {
      case 'NOTE':
        return {
          ok: true,
          outcome: {
            kind: 'simple_note_or_audio',
            successFeedbackI18nKey: 'talkDebug.noteSaved',
            consumedClassicFreeSlot: consumedClassic,
            intentionId,
          },
        };
      case 'TRIP': {
        const dueDateYmd = row.due_date ?? null;
        return {
          ok: true,
          outcome: {
            kind: 'persisted_temporal',
            intentionId,
            mirrorType: 'TASK',
            title: row.title,
            dueDateYmd,
            recapIntroI18nKey: 'talkDebug.taskQuickRecapIntro',
            consumedClassicFreeSlot: consumedClassic,
          },
        };
      }
      case 'TASK':
      case 'RECURRING_TASK': {
        let dueDateYmd = str(draft.data, 'dueDateYmd') ?? str(draft.data, 'nextDueYmd');
        if (dueDateYmd && !/^\d{4}-\d{2}-\d{2}$/.test(dueDateYmd)) {
          dueDateYmd = null;
        }
        return {
          ok: true,
          outcome: {
            kind: 'persisted_temporal',
            intentionId,
            mirrorType: 'TASK',
            title: row.title,
            dueDateYmd,
            recapIntroI18nKey: 'talkDebug.taskQuickRecapIntro',
            consumedClassicFreeSlot: consumedClassic,
          },
        };
      }
      case 'HABIT':
      case 'ANNIVERSARY':
        return {
          ok: true,
          outcome: {
            kind: 'persisted_temporal',
            intentionId,
            mirrorType: 'HABIT',
            title: row.title,
            dueDateYmd: row.due_date ?? null,
            metadataJson: row.metadata_json,
            recapIntroI18nKey: 'talkDebug.habitQuickRecapIntro',
            consumedClassicFreeSlot: consumedClassic,
          },
        };
      case 'LIST':
        return {
          ok: true,
          outcome: {
            kind: 'list_inventory_persisted',
            intentionId,
            successFeedbackI18nKey: 'talkDebug.listSavedToast',
            consumedListFreeSlot: !deps.spectrum.isProUser,
          },
        };
      case 'PROJECT':
        return {
          ok: true,
          outcome: {
            kind: 'project_persisted',
            intentionId,
            successFeedbackI18nKey: 'talkDebug.projectSavedToast',
            consumedClassicFreeSlot: consumedClassic,
          },
        };
      default:
        return { ok: false, error: new Error('unsupported_type') };
    }
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Enregistre en SQLite (et consomme les quotas Free pertinents) une intention validée dans la modale one-tap.
 *
 * @param params.deps — Dépendances capture (ids, timeouts, traductions).
 * @param params.draft — Résultat Gemini + éventuelles éditions utilisateur.
 * @param params.transcript — Texte brut conservé comme `content_raw`.
 * @param params.habitsDefaultTitle — Libellé par défaut des habitudes (i18n).
 * @param params.birthdayLabel — Libellé anniversaire (i18n).
 * @returns Succès discriminant ou erreur quota liste.
 */
export async function persistOneTapDraft(params: {
  deps: CaptureStrategyDeps;
  draft: OneTapUniversalResult;
  transcript: string;
  habitsDefaultTitle: string;
  birthdayLabel: string;
  parentId?: string | null;
  parentJalonUid?: string | null;
  persistenceLabel?: string;
}): Promise<PersistOneTapResult> {
  const { deps, draft, transcript, habitsDefaultTitle, birthdayLabel } = params;
  const title = draft.title.trim() || transcript.trim().slice(0, 200);
  const raw = transcript.trim();
  const consumedClassic = !deps.spectrum.isProUser;

  try {
    switch (draft.predictedType) {
      case 'NOTE': {
        const noteIntentionId = deps.newId();
        const row = await materializeOneTapIntentionRow({
          deps,
          draft,
          transcript: raw,
          intentionId: noteIntentionId,
          habitsDefaultTitle,
          birthdayLabel,
          isPendingAi: 0,
          parentId: params.parentId,
          parentJalonUid: params.parentJalonUid,
        });
        let metadataJson = buildMetadataJsonForInsert(row.metadata_json, draft);
        let suggestedTags = row.suggested_tags;
        if (params.persistenceLabel === NOTE_FALLBACK_LABEL) {
          metadataJson = mergeIntentionMetadataJson(metadataJson, {
            persistence_label: NOTE_FALLBACK_LABEL,
            hidden_from_timeline: true,
          });
          suggestedTags = JSON.stringify([NOTE_FALLBACK_LABEL]);
        }
        await insertTrankilV2Intention({ ...row, metadata_json: metadataJson, suggested_tags: suggestedTags });
        void scheduleOneTapUniversalReminders({
          intentionId: noteIntentionId,
          title,
          data: draft.data,
          translate: deps.translate,
        });
        return {
          ok: true,
          outcome: {
            kind: 'simple_note_or_audio',
            successFeedbackI18nKey: 'talkDebug.noteSaved',
            consumedClassicFreeSlot: consumedClassic,
            intentionId: noteIntentionId,
          },
        };
      }
      case 'TASK':
      case 'RECURRING_TASK': {
        const intentionId = deps.newId();
        const row = await materializeOneTapIntentionRow({
          deps,
          draft,
          transcript: raw,
          intentionId,
          habitsDefaultTitle,
          birthdayLabel,
          isPendingAi: 0,
          parentId: params.parentId,
          parentJalonUid: params.parentJalonUid,
        });
        await insertTrankilV2Intention({ ...row, metadata_json: buildMetadataJsonForInsert(row.metadata_json, draft) });
        void scheduleOneTapUniversalReminders({
          intentionId,
          title,
          data: draft.data,
          translate: deps.translate,
        });
        const dueDateYmd = row.due_date ?? null;
        return {
          ok: true,
          outcome: {
            kind: 'persisted_temporal',
            intentionId,
            mirrorType: 'TASK',
            title,
            dueDateYmd,
            recapIntroI18nKey: 'talkDebug.taskQuickRecapIntro',
            consumedClassicFreeSlot: consumedClassic,
          },
        };
      }
      case 'TRIP': {
        const intentionId = deps.newId();
        const row = await materializeOneTapIntentionRow({
          deps,
          draft,
          transcript: raw,
          intentionId,
          habitsDefaultTitle,
          birthdayLabel,
          isPendingAi: 0,
          parentId: params.parentId,
          parentJalonUid: params.parentJalonUid,
        });
        await insertTrankilV2Intention({ ...row, metadata_json: buildMetadataJsonForInsert(row.metadata_json, draft) });
        void scheduleOneTapUniversalReminders({
          intentionId,
          title,
          data: draft.data,
          translate: deps.translate,
        });
        const dueDateYmd = row.due_date ?? null;
        return {
          ok: true,
          outcome: {
            kind: 'persisted_temporal',
            intentionId,
            mirrorType: 'TASK',
            title: row.title,
            dueDateYmd,
            recapIntroI18nKey: 'talkDebug.taskQuickRecapIntro',
            consumedClassicFreeSlot: consumedClassic,
          },
        };
      }
      case 'HABIT':
      case 'ANNIVERSARY': {
        const intentionId = deps.newId();
        const row = await materializeOneTapIntentionRow({
          deps,
          draft,
          transcript: raw,
          intentionId,
          habitsDefaultTitle,
          birthdayLabel,
          isPendingAi: 0,
          parentId: params.parentId,
          parentJalonUid: params.parentJalonUid,
        });
        await insertTrankilV2Intention({ ...row, metadata_json: buildMetadataJsonForInsert(row.metadata_json, draft) });
        void scheduleOneTapUniversalReminders({
          intentionId,
          title,
          data: draft.data,
          translate: deps.translate,
        });
        return {
          ok: true,
          outcome: {
            kind: 'persisted_temporal',
            intentionId,
            mirrorType: 'HABIT',
            title: row.title,
            dueDateYmd: row.due_date ?? null,
            metadataJson: row.metadata_json,
            recapIntroI18nKey: 'talkDebug.habitQuickRecapIntro',
            consumedClassicFreeSlot: consumedClassic,
          },
        };
      }
      case 'LIST': {
        if (!deps.spectrum.isProUser) {
          const gate = await getListFreeQuotaSnapshot();
          if (gate.remaining <= 0) {
            return { ok: false, error: new Error('list_quota_exhausted'), code: 'LIST_QUOTA' };
          }
        }
        const mergedTitle = title || draft.title.trim() || raw.slice(0, 120);
        const placeholderPayload = {
          title: mergedTitle,
          baseCount: 1,
          unitLabel: 'personne',
          multiplier: 1,
          categories: [
            {
              name: '—',
              items: [{ uid: '', name: '—', qty: 1, unit: 'piece', scalable: false, checked: false }],
            },
          ],
        };
        const id = deps.newId();
        const metaBase = JSON.stringify(buildListMetadataPatch(placeholderPayload));
        const meta = mergeIntentionMetadataJson(buildMetadataJsonForInsert(metaBase, draft), {
          is_generating: false,
          list_enrich_status: 'idle',
          list_enrich_error: null,
          ...(params.parentJalonUid ? { zoom_parent_jalon_uid: params.parentJalonUid } : {}),
        });
        const categoryId = normalizeDomainCategoryId(draft.categoryTag);
        await insertTrankilV2Intention({
          id,
          type: 'LIST',
          title: mergedTitle,
          content_raw: raw,
          metadata_json: meta,
          suggested_tags: JSON.stringify(['sans_pression']),
          category_id: categoryId,
          parent_id: params.parentId ?? null,
          status: 'TODO',
          is_organized: 0,
          is_local_processed: 1,
          complexity_level: 0,
          created_at: Date.now(),
        });
        if (!deps.spectrum.isProUser) {
          await consumeListFreeSuccessOnce();
        }
        void scheduleOneTapUniversalReminders({
          intentionId: id,
          title: mergedTitle,
          data: draft.data,
          translate: deps.translate,
        });
        return {
          ok: true,
          outcome: {
            kind: 'list_inventory_persisted',
            intentionId: id,
            successFeedbackI18nKey: 'talkDebug.listSavedToast',
            consumedListFreeSlot: !deps.spectrum.isProUser,
          },
        };
      }
      case 'PROJECT': {
        const mergedTitle = title;
        const placeholderPayload = ensureProjectMilestoneUids({
          title: mergedTitle,
          milestones: [{ uid: '', title: '—', estimated_duration: 1, unit: 'days' as const, checked: false, pivot_date: null, note: null }],
        });
        const id = deps.newId();
        const metaBase = JSON.stringify(buildProjectMilestonesMetadataPatch(placeholderPayload));
        const meta = mergeIntentionMetadataJson(buildMetadataJsonForInsert(metaBase, draft), {
          is_generating: false,
          list_enrich_status: 'idle',
          list_enrich_error: null,
          project: { start_date: null },
          ...(params.parentJalonUid ? { zoom_parent_jalon_uid: params.parentJalonUid } : {}),
        });
        const categoryId = normalizeDomainCategoryId(draft.categoryTag);
        await insertTrankilV2Intention({
          id,
          type: 'PROJECT',
          title: mergedTitle,
          content_raw: raw,
          metadata_json: meta,
          suggested_tags: JSON.stringify(['sans_pression']),
          category_id: categoryId,
          parent_id: params.parentId ?? null,
          status: 'TODO',
          is_organized: 0,
          is_local_processed: 1,
          complexity_level: 0,
          created_at: Date.now(),
        });
        void scheduleOneTapUniversalReminders({
          intentionId: id,
          title: mergedTitle,
          data: draft.data,
          translate: deps.translate,
        });
        return {
          ok: true,
          outcome: {
            kind: 'project_persisted',
            intentionId: id,
            successFeedbackI18nKey: 'talkDebug.projectSavedToast',
            consumedClassicFreeSlot: consumedClassic,
          },
        };
      }
      default:
        return { ok: false, error: new Error('unsupported_type') };
    }
  } catch (error) {
    return { ok: false, error };
  }
}

function hasAnyListItems(listBlock: unknown): boolean {
  if (!listBlock || typeof listBlock !== 'object') return false;
  const list = listBlock as Record<string, unknown>;
  const catsRaw = list.categories;
  if (!Array.isArray(catsRaw)) return false;
  for (const c of catsRaw) {
    if (!c || typeof c !== 'object') continue;
    const itemsRaw = (c as Record<string, unknown>).items;
    if (!Array.isArray(itemsRaw)) continue;
    for (const it of itemsRaw) {
      if (!it || typeof it !== 'object') continue;
      const rec = it as Record<string, unknown>;
      if (rec.includeInSave === false) continue;
      const name = String(rec.name ?? '').trim();
      if (name) return true;
    }
  }
  return false;
}

function hasTemporalSignals(data: Record<string, unknown>): boolean {
  const dueIso = typeof data.dueDateTime === 'string' ? data.dueDateTime.trim() : '';
  const dueYmd = typeof data.dueDateYmd === 'string' ? data.dueDateYmd.trim() : '';
  const dueHm = typeof data.dueTimeHm === 'string' ? data.dueTimeHm.trim() : '';
  const rec = data.recurrence;
  const cadence = typeof data.cadenceDescription === 'string' ? data.cadenceDescription.trim() : '';
  const pref = typeof data.preferredTimeHm === 'string' ? data.preferredTimeHm.trim() : '';
  const nextYmd = typeof data.nextDueYmd === 'string' ? data.nextDueYmd.trim() : '';
  return Boolean(dueIso || dueYmd || dueHm || cadence || pref || nextYmd || (rec && typeof rec === 'object'));
}

function inferTemporalType(data: Record<string, unknown>): 'TASK' | 'HABIT' {
  const cadence = typeof data.cadenceDescription === 'string' ? data.cadenceDescription.trim() : '';
  const pref = typeof data.preferredTimeHm === 'string' ? data.preferredTimeHm.trim() : '';
  const rec = data.recurrence;
  if (cadence || pref || (rec && typeof rec === 'object')) return 'HABIT';
  return 'TASK';
}

function parseIsoToYmdHm(iso: string): { ymd: string; hm: string; timeMarker: 'ALL_DAY' | 'EXACT_TIME' } | null {
  const parsed = parsePass1DueDateTime(iso);
  if (!parsed.dueDateYmd) return null;
  return {
    ymd: parsed.dueDateYmd,
    hm: parsed.dueTimeHm ?? '00:00',
    timeMarker: parsed.timeMarker,
  };
}

function buildListDraftBlock(params: {
  title: string;
  items: { name: string; baseQuantity?: number; unit?: string; scalable?: boolean }[] | string[];
  baseCount?: number;
  unitLabel?: string;
}): Record<string, unknown> {
  const title = params.title.trim().slice(0, 120) || 'Liste';
  const baseCount = Math.max(1, Math.round(Number(params.baseCount ?? 1)));
  const unitLabel = String(params.unitLabel ?? 'personne').trim() || 'personne';
  const rawItems = Array.isArray(params.items) ? params.items : [];
  const items =
    rawItems.length > 0 && typeof rawItems[0] === 'object'
      ? (rawItems as { name: string; baseQuantity?: number; unit?: string; scalable?: boolean }[])
          .map((x) => ({
            name: String(x?.name ?? '').trim(),
            baseQuantity: Number(x?.baseQuantity ?? 1),
            unit: String(x?.unit ?? 'piece').trim() || 'piece',
            scalable: x?.scalable !== undefined ? Boolean(x.scalable) : true,
          }))
          .filter((x) => Boolean(x.name))
          .slice(0, 48)
      : (rawItems as string[])
          .map((x) => String(x ?? '').trim())
          .filter(Boolean)
          .slice(0, 48)
          .map((name) => ({ name, baseQuantity: 1, unit: 'piece', scalable: true }));
  return {
    title,
    baseCount,
    unitLabel,
    categories: [
      {
        name: '—',
        items: items.map((name) => ({
          name: name.name.slice(0, 120),
          baseQuantity: Number.isFinite(name.baseQuantity) && name.baseQuantity > 0 ? name.baseQuantity : 1,
          unit: name.unit,
          scalable: name.scalable,
        })),
      },
    ],
  };
}

async function persistAndDualWrite(params: {
  deps: CaptureStrategyDeps;
  draft: OneTapUniversalResult;
  transcript: string;
  habitsDefaultTitle: string;
  birthdayLabel: string;
  entityLabel: string;
  parentId?: string | null;
  parentJalonUid?: string | null;
}): Promise<PersistOneTapResult> {
  const { entityLabel, ...persistParams } = params;
  const persistStart = Date.now();
  const res = await persistOneTapDraft({
    ...persistParams,
    persistenceLabel: entityLabel === NOTE_FALLBACK_LABEL ? NOTE_FALLBACK_LABEL : undefined,
  });
  if (res.ok) {
    const id = 'intentionId' in res.outcome ? String((res.outcome as { intentionId?: unknown }).intentionId ?? '') : '';
    const cat = normalizeDomainCategoryId(params.draft.categoryTag);
    const ctx = normalizeOneTapContextTag(params.draft.contextTag) || '—';
    if (id) {
      console.log(`[DATABASE] ✅ Persistance confirmée pour ${id}`);
      console.log(`[DATABASE] ✅ Intention sauvée avec succès | Category: ${cat} | Context: ${ctx}`);
    }
    console.log(`[DATABASE] ⏱️ Persistance ${entityLabel} en ${Date.now() - persistStart}ms`);
    console.log(`[VENTILATION-WRITE] ✅ ${entityLabel} | ID: ${id}`.trim());
  }
  return res;
}

/**
 * Persistance **multi-intentions** : ventile `draft.data.intents[]` en plusieurs écritures,
 * option NOTE_FALLBACK si rien n’a été persisté et `allowNoteFallback` est vrai.
 */
export async function persistOneTapDraftVentilated(params: {
  deps: CaptureStrategyDeps;
  draft: OneTapUniversalResult;
  transcript: string;
  habitsDefaultTitle: string;
  birthdayLabel: string;
  allowNoteFallback?: boolean;
  parentId?: string | null;
  parentJalonUid?: string | null;
}): Promise<PersistOneTapVentilatedResult> {
  const { deps, draft, transcript, habitsDefaultTitle, birthdayLabel } = params;
  const allowNoteFallback = params.allowNoteFallback !== false;
  const data = (draft.data ?? {}) as Record<string, unknown>;
  const outcomes: PersistOneTapSuccess[] = [];
  let firstError: unknown = null;
  let firstCode: 'LIST_QUOTA' | 'LIST_SELECTION' | undefined;

  const intentsRaw = (data as { intents?: unknown }).intents;
  const intentsLen = Array.isArray(intentsRaw) ? intentsRaw.length : 0;
  logCaptureFlow(undefined, 'ventilated_enter', {
    predictedType: draft.predictedType,
    categoryTag: draft.categoryTag,
    contextTag: draft.contextTag,
    allowNoteFallback,
    transcriptLen: transcript.length,
    intentsLen,
  });
  if (Array.isArray(intentsRaw) && intentsRaw.length > 0) {
    const total = intentsRaw.length;
    for (let i = 0; i < total; i++) {
      const raw = intentsRaw[i];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const r = raw as Record<string, unknown>;
      const previewType = String(r.type ?? '').trim().toUpperCase();
      const previewTitle = String(r.title ?? r.content ?? r.destination ?? '').trim();
      const previewContext =
        typeof r.context === 'string'
          ? r.context.trim()
          : typeof (r as { contextTag?: unknown }).contextTag === 'string'
            ? String((r as { contextTag: string }).contextTag).trim()
            : '';
      if (DEBUG_MODE_DOUANE) {
        console.log(`[DOUANE] 📦 JSON_BRUT_AVANT_TRAITEMENT: ${JSON.stringify(r)}`);
        console.log(
          `[DOUANE] 🛂 Intention ${i + 1}/${total} détectée : [${previewType || '?'}] ${previewTitle} | category=${String(r.category ?? draft.categoryTag)} context=${previewContext || draft.contextTag || '—'}`.trim(),
        );
      }
      try {
        const type = String(r.type ?? '').trim().toUpperCase();
        const { categoryTag, contextTag } = resolveVentilatedIntentTags(r, draft);
        if (type === 'LIST') {
          const title = String(r.title ?? '').trim() || draft.title;
          const items =
            Array.isArray(r.items) && r.items.length > 0 && typeof r.items[0] === 'object'
              ? (r.items as { name: string; baseQuantity?: number; unit?: string; scalable?: boolean }[])
              : Array.isArray(r.items)
                ? r.items.map((x) => String(x ?? '').trim()).filter(Boolean)
                : [];
          const listBlock = buildListDraftBlock({
            title,
            items,
            baseCount: Number(r.baseCount ?? 1),
            unitLabel: typeof r.unitLabel === 'string' ? r.unitLabel : undefined,
          });
          const listDraft: OneTapUniversalResult = {
            ...draft,
            categoryTag,
            contextTag,
            title: title.trim().slice(0, 200) || draft.title,
            predictedType: 'LIST',
            data: { list: listBlock },
          };
          const pr = await persistAndDualWrite({
            deps,
            draft: listDraft,
            transcript,
            habitsDefaultTitle,
            birthdayLabel,
            entityLabel: 'LIST',
            parentId: params.parentId,
            parentJalonUid: params.parentJalonUid,
          });
          if (DEBUG_MODE_DOUANE) console.log(pr.ok ? '[DOUANE] ✅ Passage accordé' : '[DOUANE] ❌ Refoulé');
          if (DEBUG_MODE_DOUANE && !pr.ok) console.log(`[DOUANE] ❌ ERROR: ${pr.error instanceof Error ? pr.error.message : String(pr.error)}`);
          if (pr.ok) outcomes.push(pr.outcome);
          else {
            firstError = firstError ?? pr.error;
            firstCode = firstCode ?? pr.code;
          }
          continue;
        }
        if (type === 'PROJECT') {
          const title = String(r.title ?? r.content ?? '').trim() || draft.title;
          const items =
            Array.isArray(r.items) && r.items.length > 0 && typeof r.items[0] === 'object'
              ? (r.items as { name: string; baseQuantity?: number; unit?: string; scalable?: boolean }[])
              : Array.isArray(r.items)
                ? r.items.map((x) => String(x ?? '').trim()).filter(Boolean)
                : [];
          const listBlock = buildListDraftBlock({
            title,
            items,
            baseCount: Number(r.baseCount ?? 1),
            unitLabel: typeof r.unitLabel === 'string' ? r.unitLabel : undefined,
          });
          const projectDraft: OneTapUniversalResult = {
            ...draft,
            categoryTag,
            contextTag,
            title: title.trim().slice(0, 200) || draft.title,
            predictedType: 'PROJECT',
            data: { list: listBlock, project_mode: true },
          };
          const pr = await persistAndDualWrite({
            deps,
            draft: projectDraft,
            transcript,
            habitsDefaultTitle,
            birthdayLabel,
            entityLabel: 'PROJECT',
            parentId: params.parentId,
            parentJalonUid: params.parentJalonUid,
          });
          if (DEBUG_MODE_DOUANE) console.log(pr.ok ? '[DOUANE] ✅ Passage accordé' : '[DOUANE] ❌ Refoulé');
          if (DEBUG_MODE_DOUANE && !pr.ok) console.log(`[DOUANE] ❌ ERROR: ${pr.error instanceof Error ? pr.error.message : String(pr.error)}`);
          if (pr.ok) outcomes.push(pr.outcome);
          else {
            firstError = firstError ?? pr.error;
            firstCode = firstCode ?? pr.code;
          }
          continue;
        }
        if (type === 'TASK') {
          const content = String(r.content ?? '').trim() || draft.title;
          const notes = typeof r.notes === 'string' ? r.notes.trim() : '';
          const dueIso = typeof r.due === 'string' ? r.due.trim() : '';
          const parsedDue = dueIso ? parsePass1DueDateTime(dueIso) : null;
          const taskDraft: OneTapUniversalResult = {
            ...draft,
            categoryTag,
            contextTag,
            title: content.slice(0, 200) || draft.title,
            predictedType: 'TASK',
            data: {
              ...(parsedDue?.dueDateTime ? { dueDateTime: parsedDue.dueDateTime } : dueIso ? { dueDateTime: dueIso } : {}),
              ...(parsedDue?.dueDateYmd ? { dueDateYmd: parsedDue.dueDateYmd } : {}),
              ...(parsedDue?.dueTimeHm ? { dueTimeHm: parsedDue.dueTimeHm } : {}),
              ...(parsedDue
                ? { timeMarker: parsedDue.timeMarker, is_all_day: parsedDue.timeMarker === 'ALL_DAY' ? 1 : 0 }
                : {}),
              ...(notes ? { notes: notes.slice(0, 2000) } : {}),
            },
          };
          const pr = await persistAndDualWrite({
            deps,
            draft: taskDraft,
            transcript,
            habitsDefaultTitle,
            birthdayLabel,
            entityLabel: 'TASK',
            parentId: params.parentId,
            parentJalonUid: params.parentJalonUid,
          });
          if (DEBUG_MODE_DOUANE) console.log(pr.ok ? '[DOUANE] ✅ Passage accordé' : '[DOUANE] ❌ Refoulé');
          if (DEBUG_MODE_DOUANE && !pr.ok) console.log(`[DOUANE] ❌ ERROR: ${pr.error instanceof Error ? pr.error.message : String(pr.error)}`);
          if (pr.ok) outcomes.push(pr.outcome);
          else {
            firstError = firstError ?? pr.error;
            firstCode = firstCode ?? pr.code;
          }
          continue;
        }
        if (type === 'TRIP') {
          const destination =
            String(r.destination ?? r.content ?? r.title ?? '').trim() || str(draft.data, 'destination_name') || draft.title;
          const dueIso = typeof r.arrivalDue === 'string' ? r.arrivalDue.trim() : typeof r.due === 'string' ? r.due.trim() : '';
          const parsedDue = dueIso ? parsePass1DueDateTime(dueIso) : null;
          const tripDraft: OneTapUniversalResult = {
            ...draft,
            categoryTag,
            contextTag,
            title: destination.slice(0, 200) || draft.title,
            predictedType: 'TRIP',
            data: {
              logisticsPotential: true,
              destination_name: destination.slice(0, 400),
              ...(parsedDue?.dueDateTime ? { dueDateTime: parsedDue.dueDateTime } : dueIso ? { dueDateTime: dueIso } : {}),
              ...(parsedDue?.dueDateYmd ? { dueDateYmd: parsedDue.dueDateYmd } : {}),
              ...(parsedDue?.dueTimeHm ? { dueTimeHm: parsedDue.dueTimeHm } : {}),
              ...(dueIso ? { arrivalDue: dueIso } : {}),
              ...(parsedDue
                ? { timeMarker: parsedDue.timeMarker, is_all_day: parsedDue.timeMarker === 'ALL_DAY' ? 1 : 0 }
                : {}),
              location_address: str(draft.data, 'location_address') ?? '',
              location_place_id: (draft.data as Record<string, unknown>).location_place_id ?? null,
              location_lat: (draft.data as Record<string, unknown>).location_lat ?? null,
              location_lng: (draft.data as Record<string, unknown>).location_lng ?? null,
              remind_to_leave: Boolean((draft.data as Record<string, unknown>).remind_to_leave),
            },
          };
          const pr = await persistAndDualWrite({
            deps,
            draft: tripDraft,
            transcript,
            habitsDefaultTitle,
            birthdayLabel,
            entityLabel: 'TRIP',
            parentId: params.parentId,
            parentJalonUid: params.parentJalonUid,
          });
          if (DEBUG_MODE_DOUANE) console.log(pr.ok ? '[DOUANE] ✅ Passage accordé' : '[DOUANE] ❌ Refoulé');
          if (DEBUG_MODE_DOUANE && !pr.ok) console.log(`[DOUANE] ❌ ERROR: ${pr.error instanceof Error ? pr.error.message : String(pr.error)}`);
          if (pr.ok) outcomes.push(pr.outcome);
          else {
            firstError = firstError ?? pr.error;
            firstCode = firstCode ?? pr.code;
          }
          continue;
        }
        if (type === 'HABIT') {
          const content = String(r.content ?? '').trim() || draft.title;
          const rec = typeof r.recurrence === 'string' ? r.recurrence.trim() : '';
          const pref = typeof r.preferredTime === 'string' ? r.preferredTime.trim() : '';
          const due = typeof r.due === 'string' ? r.due.trim() : '';
          const rule = coerceRecurrenceRule({
            recurrence_rule: r.recurrence_rule,
            recurrence: rec,
            preferredTime: pref,
            due,
            skeletonPreferredTimeHm: str(draft.data as Record<string, unknown>, 'preferredTimeHm') ?? undefined,
            skeletonCadence: str(draft.data as Record<string, unknown>, 'cadenceDescription') ?? undefined,
            transcript,
          });
          const habitData: Record<string, unknown> = {
            ...(rec && !rule ? { cadenceDescription: rec.slice(0, 500), recurrence: { summary: rec.slice(0, 500) } } : {}),
            ...(pref && !rule?.time_target ? { preferredTimeHm: pref } : {}),
            ...(rule
              ? {
                  recurrence_rule: rule,
                  cadenceDescription: rule.raw_phrase ?? rec,
                  preferredTimeHm: rule.time_target ?? pref,
                  recurrence: {
                    summary: rule.raw_phrase ?? rec,
                    frequency: rule.frequency.toLowerCase(),
                    ...(rule.byWeekday != null ? { byWeekday: rule.byWeekday } : {}),
                  },
                }
              : {}),
          };
          const habitDraft: OneTapUniversalResult = {
            ...draft,
            categoryTag,
            contextTag,
            title: content.slice(0, 200) || draft.title,
            predictedType: 'HABIT',
            data: habitData,
          };
          const pr = await persistAndDualWrite({
            deps,
            draft: habitDraft,
            transcript,
            habitsDefaultTitle,
            birthdayLabel,
            entityLabel: 'HABIT',
            parentId: params.parentId,
            parentJalonUid: params.parentJalonUid,
          });
          if (DEBUG_MODE_DOUANE) console.log(pr.ok ? '[DOUANE] ✅ Passage accordé' : '[DOUANE] ❌ Refoulé');
          if (DEBUG_MODE_DOUANE && !pr.ok) console.log(`[DOUANE] ❌ ERROR: ${pr.error instanceof Error ? pr.error.message : String(pr.error)}`);
          if (pr.ok) outcomes.push(pr.outcome);
          else {
            firstError = firstError ?? pr.error;
            firstCode = firstCode ?? pr.code;
          }
          continue;
        }
        if (type === 'NOTE') {
          const content = String(r.content ?? '').trim() || transcript.trim();
          const noteDraft: OneTapUniversalResult = {
            ...draft,
            categoryTag,
            contextTag,
            title: draft.title,
            predictedType: 'NOTE',
            data: { memo: content.slice(0, 4000) },
          };
          const pr = await persistAndDualWrite({
            deps,
            draft: noteDraft,
            transcript,
            habitsDefaultTitle,
            birthdayLabel,
            entityLabel: 'NOTE',
            parentId: params.parentId,
            parentJalonUid: params.parentJalonUid,
          });
          if (DEBUG_MODE_DOUANE) console.log(pr.ok ? '[DOUANE] ✅ Passage accordé' : '[DOUANE] ❌ Refoulé');
          if (DEBUG_MODE_DOUANE && !pr.ok) console.log(`[DOUANE] ❌ ERROR: ${pr.error instanceof Error ? pr.error.message : String(pr.error)}`);
          if (pr.ok) outcomes.push(pr.outcome);
          else {
            firstError = firstError ?? pr.error;
            firstCode = firstCode ?? pr.code;
          }
          continue;
        }
        if (type === 'TRIP') {
          const destination = String(r.destination ?? '').trim();
          if (!destination) continue;
          const addr = typeof r.address === 'string' ? r.address.trim() : '';
          const placeId = typeof r.placeId === 'string' ? r.placeId.trim() : '';
          const lat = Number(r.lat);
          const lng = Number(r.lng);
          const arrivalIso = typeof r.arrivalDue === 'string' ? r.arrivalDue.trim() : '';
          const patch = arrivalIso ? parseIsoToYmdHm(arrivalIso) : null;
          const taskDraft: OneTapUniversalResult = {
            ...draft,
            categoryTag,
            contextTag,
            title: destination.slice(0, 200) || draft.title,
            predictedType: 'TASK',
            data: {
              logisticsPotential: true,
              destination_name: destination.slice(0, 400),
              ...(addr ? { location_address: addr.slice(0, 500) } : {}),
              ...(placeId ? { location_place_id: placeId.slice(0, 200) } : {}),
              ...(Number.isFinite(lat) ? { location_lat: lat } : {}),
              ...(Number.isFinite(lng) ? { location_lng: lng } : {}),
              ...(arrivalIso ? { dueDateTime: arrivalIso } : {}),
              ...(patch ? { dueDateYmd: patch.ymd, dueTimeHm: patch.hm } : {}),
            },
          };
          const pr = await persistAndDualWrite({
            deps,
            draft: taskDraft,
            transcript,
            habitsDefaultTitle,
            birthdayLabel,
            entityLabel: 'TRIP_TASK',
            parentId: params.parentId,
            parentJalonUid: params.parentJalonUid,
          });
          if (DEBUG_MODE_DOUANE) console.log(pr.ok ? '[DOUANE] ✅ Passage accordé' : '[DOUANE] ❌ Refoulé');
          if (DEBUG_MODE_DOUANE && !pr.ok) console.log(`[DOUANE] ❌ ERROR: ${pr.error instanceof Error ? pr.error.message : String(pr.error)}`);
          if (pr.ok) {
            outcomes.push(pr.outcome);
          } else {
            firstError = firstError ?? pr.error;
            firstCode = firstCode ?? pr.code;
          }
          continue;
        }
      } catch (e) {
        firstError = firstError ?? e;
        if (DEBUG_MODE_DOUANE) console.log('[DOUANE] ❌ Refoulé');
      }
    }

    if (outcomes.length > 0) return { ok: true, outcomes };
    if (!allowNoteFallback) {
      return { ok: false, error: firstError ?? new Error('VENTILATION_EMPTY'), code: firstCode };
    }
    const noteDraft: OneTapUniversalResult = {
      ...draft,
      predictedType: 'NOTE',
      data: { memo: transcript.trim().slice(0, 4000) },
    };
    const r = await persistAndDualWrite({
      deps,
      draft: noteDraft,
      transcript,
      habitsDefaultTitle,
      birthdayLabel,
      entityLabel: 'NOTE_FALLBACK',
      parentId: params.parentId,
      parentJalonUid: params.parentJalonUid,
    });
    if (r.ok) return { ok: true, outcomes: [r.outcome] };
    return { ok: false, error: r.error, code: r.code };
  }

  const listBlock = data.list;
  const shouldWriteList =
    draft.predictedType === 'LIST' || draft.predictedType === 'PROJECT'
      ? Boolean(listBlock && typeof listBlock === 'object')
      : hasAnyListItems(listBlock);
  if (shouldWriteList) {
    const nextType = draft.predictedType === 'PROJECT' ? 'PROJECT' : 'LIST';
    const listDraft: OneTapUniversalResult = {
      ...draft,
      predictedType: nextType,
      data: { ...data, list: listBlock, ...(nextType === 'PROJECT' ? { project_mode: true } : null) },
    };
    const r = await persistAndDualWrite({
      deps,
      draft: listDraft,
      transcript,
      habitsDefaultTitle,
      birthdayLabel,
      entityLabel: nextType,
      parentId: params.parentId,
      parentJalonUid: params.parentJalonUid,
    });
    if (r.ok) outcomes.push(r.outcome);
    else {
      firstError = firstError ?? r.error;
      firstCode = firstCode ?? r.code;
    }
  }

  const shouldWriteTemporal = hasTemporalSignals(data);
  const logisticsPotential = Boolean(data.logisticsPotential);
  const shouldWriteTrip = logisticsPotential;

  if (shouldWriteTemporal || shouldWriteTrip) {
    const temporalType = shouldWriteTrip ? 'TASK' : inferTemporalType(data);
    const temporalDraft: OneTapUniversalResult = { ...draft, predictedType: temporalType, data: { ...data } };
    const r = await persistAndDualWrite({
      deps,
      draft: temporalDraft,
      transcript,
      habitsDefaultTitle,
      birthdayLabel,
      entityLabel: temporalType,
      parentId: params.parentId,
      parentJalonUid: params.parentJalonUid,
    });
    if (r.ok) {
      outcomes.push(r.outcome);
    } else {
      firstError = firstError ?? r.error;
      firstCode = firstCode ?? r.code;
    }
  }

  if (outcomes.length === 0) {
    logCaptureFlow(undefined, 'ventilated_note_fallback_attempt', { allowNoteFallback });
    const noteDraft: OneTapUniversalResult = {
      ...draft,
      predictedType: 'NOTE',
      data: { ...data, memo: typeof data.memo === 'string' && data.memo.trim() ? data.memo : transcript.trim().slice(0, 4000) },
    };
    const r = await persistAndDualWrite({
      deps,
      draft: noteDraft,
      transcript,
      habitsDefaultTitle,
      birthdayLabel,
      entityLabel: 'NOTE_FALLBACK',
      parentId: params.parentId,
      parentJalonUid: params.parentJalonUid,
    });
    if (r.ok) {
      logCaptureFlow(undefined, 'ventilated_exit', { ok: true, path: 'note_fallback', outcomes: 1 });
      return { ok: true, outcomes: [r.outcome] };
    }
    logCaptureFlow(undefined, 'ventilated_exit', { ok: false, path: 'note_fallback' });
    return { ok: false, error: r.error, code: r.code };
  }

  if (outcomes.length > 0) {
    logCaptureFlow(undefined, 'ventilated_exit', { ok: true, path: 'intents', outcomes: outcomes.length });
    return { ok: true, outcomes };
  }
  logCaptureFlow(undefined, 'ventilated_exit', { ok: false, path: 'empty', hasFirstError: Boolean(firstError) });
  return { ok: false, error: firstError ?? new Error('persist_failed'), code: firstCode };
}
