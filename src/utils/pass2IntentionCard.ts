import type { TrankilV2TimelineItemRow } from '../api';
import { getTripMetaFromRoot, isPass2UnlockedMeta } from './tripTimelineCard';

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

/** Types éligibles au CTA Pass 2 : TRIP, LIST, PROJECT (aligné IntentionDetailSheet). */
export function resolvePass2FooterAction(row: TrankilV2TimelineItemRow): Pass2FooterAction {
  const type = String(row.type ?? '').trim().toUpperCase();
  const cat = String(row.category_id ?? '').trim().toUpperCase();
  if (type === 'HABIT') return null;

  const meta = safeParseJsonObject(row.metadata_json);
  const trip = getTripMetaFromRoot(meta);

  // TRIP capturé en one-tap : type TASK + bloc `metadata.trip` (cf. oneTapPersist).
  if (trip || type === 'TRIP' || cat === 'TRAVEL') return 'trip';
  if (type === 'LIST' || cat === 'SHOP') return 'list';
  if (type === 'PROJECT') return 'project';
  if (type === 'TASK') return null;
  return null;
}

export function showPass2CardCta(row: TrankilV2TimelineItemRow): boolean {
  if (!row?.id || row.id === 'peek_pending') return false;
  const meta = safeParseJsonObject(row.metadata_json);
  if (isPass2UnlockedMeta(meta)) return false;

  const type = String(row.type ?? '').trim().toUpperCase();
  const trip = getTripMetaFromRoot(meta);
  // Aligné `showPass2FooterCta` dans IntentionDetailSheet (isProject || isList || isTrip).
  if (type === 'PROJECT' || type === 'LIST' || Boolean(trip)) return true;
  return resolvePass2FooterAction(row) !== null;
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
