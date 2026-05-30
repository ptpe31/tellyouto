import type { TrankilV2TimelineItemRow } from '../api';
import { isTripAllDay } from './tripElasticDisplay';
import { isTripReadyForIdeaBankSurveillance } from './tripItineraryDisplay';
import { getTripMetaFromRoot, isPass2UnlockedMeta } from './tripTimelineCard';
import type { TripSurveillanceUiState } from './tripSurveillanceButton';

export type Pass2FooterAction = 'trip' | 'list' | 'project' | null;

function safeParseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Éligibilité CTA enrichissement : LIST, PROJECT, ou trajet structuré (aligné IntentionDetailSheet). */
function isPass2EligibleRow(row: TrankilV2TimelineItemRow, meta: Record<string, unknown> | null): boolean {
  const type = String(row.type ?? '').trim().toUpperCase();
  if (type === 'HABIT') return false;
  if (type === 'LIST' || type === 'PROJECT') return true;
  if (type === 'TRIP') return true;
  return Boolean(getTripMetaFromRoot(meta));
}

/** Types éligibles au CTA Pass 2 : TRIP, LIST, PROJECT (aligné IntentionDetailSheet). */
export function resolvePass2FooterAction(row: TrankilV2TimelineItemRow): Pass2FooterAction {
  const type = String(row.type ?? '').trim().toUpperCase();
  if (type === 'HABIT') return null;

  const meta = safeParseJsonObject(row.metadata_json);
  const trip = getTripMetaFromRoot(meta);

  // TRIP capturé en one-tap : type TASK + bloc `metadata.trip` (cf. oneTapPersist).
  if (trip || type === 'TRIP') return 'trip';
  if (type === 'LIST') return 'list';
  if (type === 'PROJECT') return 'project';
  return null;
}

export function showPass2CardCta(row: TrankilV2TimelineItemRow): boolean {
  if (!row?.id || row.id === 'peek_pending') return false;
  const meta = safeParseJsonObject(row.metadata_json);
  if (isPass2UnlockedMeta(meta)) return false;
  return isPass2EligibleRow(row, meta);
}

export function formatPass2PillLabel(
  action: Pass2FooterAction,
  t: (key: string) => string,
  isProUser: boolean,
): string {
  if (!action) return '';
  const key =
    action === 'trip'
      ? 'intentionDetail.actionSetupAlert'
      : action === 'list'
        ? 'pass2.generateList'
        : 'pass2.generateSteps';
  const label = t(key);
  return isProUser ? label : `${label} ${t('intentionDetail.pass2LockedSuffix')}`.trim();
}

/** Pilule TRIP enrichie dans la Tirelire (cycle armement / désarmement). */
export function showIdeaBankTripPill(
  row: TrankilV2TimelineItemRow,
  meta: Record<string, unknown> | null,
): boolean {
  if (!row?.id || row.id === 'peek_pending') return false;
  const trip = getTripMetaFromRoot(meta);
  if (!trip) return false;
  return !isTripAllDay(meta, trip, row.due_date ?? null);
}

export function resolveIdeaBankTripPillLabel(input: {
  uiState: TripSurveillanceUiState;
  isProUser: boolean;
  isReady: boolean;
  t: (key: string) => string;
}): string {
  const { uiState, isProUser, isReady, t } = input;
  if (uiState === 'pro_active') {
    return t('intentionDetail.tripSurveillanceActive');
  }
  const base = t('intentionDetail.actionSetupAlert');
  if (!isProUser) {
    return `${base} ${t('intentionDetail.pass2LockedSuffix')}`.trim();
  }
  if (isReady && uiState === 'pro_inactive') {
    return base;
  }
  return base;
}

export function isIdeaBankTripPillReady(input: {
  row: TrankilV2TimelineItemRow;
  meta: Record<string, unknown> | null;
  trip: Record<string, unknown> | null;
  isProUser: boolean;
  uiState: TripSurveillanceUiState;
}): boolean {
  return (
    input.uiState === 'pro_inactive' &&
    isTripReadyForIdeaBankSurveillance({
      row: input.row,
      meta: input.meta,
      trip: input.trip,
      isProUser: input.isProUser,
    })
  );
}
