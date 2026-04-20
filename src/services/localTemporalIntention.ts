import type { TrankilV2IntentionInsert } from '../api/trankilV2Db';
import { insertTrankilV2Intention } from '../api/trankilV2Db';
import { computeDueDateForHorizon, computeTimeHorizonFromDueDate } from './TimeSorter';

export type LocalTemporalType = 'TASK' | 'HABIT' | 'NOTE';

type CreateLocalTemporalIntentionParams = {
  id: string;
  title: string;
  rawTranscript: string;
  localType: LocalTemporalType;
  dueDateYmd: string | null;
  suggestedTags?: string[];
  source: string;
  timeMarker?: string;
  isLocalProcessed?: number;
  complexityLevel?: number;
  metadataExtra?: Record<string, unknown>;
};

export function mapHorizonToCategoryId(
  horizon: ReturnType<typeof computeTimeHorizonFromDueDate>,
): string {
  if (horizon === 'TODAY') return 'aujourdhui';
  if (horizon === 'TOMORROW') return 'demain';
  if (horizon === 'WEEK') return 'cette_semaine';
  return 'sans_pression';
}

/**
 * Construit la ligne SQLite **sans** insertion (flux one-tap optimiste : pré-save puis UPDATE).
 */
export function buildLocalTemporalIntentionInsertRow(
  params: CreateLocalTemporalIntentionParams & { is_pending_ai?: number; created_at?: number },
): { row: TrankilV2IntentionInsert; categoryId: string; dueDateYmd: string | null } {
  let dueDateYmd = params.dueDateYmd;
  const floatingCategory = 'sans_pression';
  const suggested = (params.suggestedTags ?? []).map((tag) => String(tag || '').trim()).filter(Boolean);
  const fallbackCategory = suggested[0]?.toLowerCase() || floatingCategory;
  const categoryId =
    params.localType === 'HABIT'
      ? 'regulier'
      : dueDateYmd
        ? mapHorizonToCategoryId(computeTimeHorizonFromDueDate(dueDateYmd))
        : fallbackCategory;
  if (!dueDateYmd && categoryId === 'demain') {
    dueDateYmd = computeDueDateForHorizon('TOMORROW');
  }
  const hasAlarm = Boolean(dueDateYmd);

  const row: TrankilV2IntentionInsert = {
    id: params.id,
    type: params.localType,
    title: params.title,
    due_date: dueDateYmd,
    content_raw: params.rawTranscript,
    metadata_json: JSON.stringify(
      {
        source: params.source,
        timeMarker: params.timeMarker ?? '',
        has_alarm: hasAlarm,
        due_date: dueDateYmd,
        ...(params.metadataExtra ?? {}),
      },
      null,
      2,
    ),
    suggested_tags: JSON.stringify(dueDateYmd && suggested.length ? suggested : [floatingCategory]),
    category_id: categoryId,
    parent_id: null,
    status: 'TODO',
    is_organized: 0,
    is_local_processed: params.isLocalProcessed ?? 1,
    complexity_level: params.complexityLevel ?? 1,
    created_at: params.created_at ?? Date.now(),
    is_pending_ai: params.is_pending_ai ?? 0,
  };

  return { row, categoryId, dueDateYmd };
}

export async function createLocalTemporalIntention(
  params: CreateLocalTemporalIntentionParams,
): Promise<{
  type: 'TASK' | 'HABIT' | 'NOTE';
  categoryId: string;
  dueDateYmd: string | null;
}> {
  const { row, categoryId, dueDateYmd } = buildLocalTemporalIntentionInsertRow(params);
  await insertTrankilV2Intention(row);

  return {
    type: params.localType,
    categoryId,
    dueDateYmd,
  };
}
