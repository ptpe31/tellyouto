import type { TrankilV2TimelineItemRow } from '../../api';
import { generateSmartTitle } from '../../services/smartTitle';
import { isHubTripRow } from './hubCategoryRegistry';

function hasTemporalResidue(raw: string): boolean {
  const s = String(raw || '').toLowerCase();
  if (!s.trim()) return false;
  if (/\b(\d{1,2}[:h]\d{0,2}|am|pm)\b/.test(s)) return true;
  if (/\b(today|tomorrow|tonight|yesterday)\b/.test(s)) return true;
  if (/\b(aujourd'hui|demain|ce soir|hier|après-demain)\b/.test(s)) return true;
  if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(s)) return true;
  if (/\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/.test(s)) return true;
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(s)) return true;
  return false;
}

/**
 * Titre narratif : pour les TRIP, le titre SQLite est souvent la destination —
 * on préfère le libellé « clean » issu du transcript (`content_raw`).
 */
export function resolveNarrativeTitle(row: TrankilV2TimelineItemRow, locale?: string): string {
  const loc = locale || Intl.DateTimeFormat().resolvedOptions().locale;

  if (isHubTripRow(row)) {
    const smart = generateSmartTitle(row.content_raw || '', loc);
    if (smart) return smart.slice(0, 120);
    const direct = String(row.display_title ?? '').trim();
    if (direct) return direct.slice(0, 120);
  } else {
    const direct = String(row.display_title ?? '').trim();
    if (direct && !hasTemporalResidue(direct)) return direct.slice(0, 120);
    const smart = generateSmartTitle(row.content_raw || '', loc);
    if (smart) return smart.slice(0, 120);
    if (direct) return direct.slice(0, 120);
  }

  const raw = String(row.content_raw ?? '').trim();
  if (raw) return raw.slice(0, 120);
  return row.id;
}
