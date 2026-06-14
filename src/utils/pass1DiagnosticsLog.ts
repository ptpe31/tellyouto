/**
 * Diagnostics Pass 1 — détection d'anomalies (PROJECT vs multi-extraction) et logs corrélés.
 * @module pass1DiagnosticsLog
 */
import { logCaptureFlow } from './captureFlowLog';

const ADMIN_EMAIL_RE =
  /\b(mail|e-mail|email|courriel|retour de mail|confirmer|autorisation|droit à l'image|droit a l'image|merci de|par retour|nous confirmer)\b/i;
const APPOINTMENT_RE =
  /\b(rendez-vous|rdv|devant|à\s+\d{1,2}h|a\s+\d{1,2}h|\d{1,2}h\d{2}|spectacle|représentation|representation|échauffement|echauffement)\b/i;

export type Pass1IntentSummaryItem = {
  type: string;
  label: string;
  sourceHint?: string;
  due?: string;
  arrivalDue?: string;
};

export type Pass1TranscriptSignals = {
  adminEmailLikely: boolean;
  appointmentLikely: boolean;
  longText: boolean;
  transcriptLen: number;
};

export type Pass1Diagnostics = {
  intentCount: number;
  types: string[];
  typeCounts: Record<string, number>;
  items: Pass1IntentSummaryItem[];
  signals: Pass1TranscriptSignals;
  anomalies: string[];
  parseDrops?: number;
  rawIntentsCount?: number;
};

export type Pass1ParseDrop = {
  reason: string;
  rawType?: string;
};

function intentRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function intentLabel(r: Record<string, unknown>): string {
  const type = String(r.type ?? '')
    .trim()
    .toUpperCase();
  if (type === 'TRIP') {
    return String(r.content ?? r.title ?? r.destination ?? '')
      .trim()
      .slice(0, 80);
  }
  return String(r.content ?? r.title ?? r.destination ?? '')
    .trim()
    .slice(0, 80);
}

export function detectPass1TranscriptSignals(transcript: string): Pass1TranscriptSignals {
  const text = String(transcript ?? '');
  return {
    adminEmailLikely: ADMIN_EMAIL_RE.test(text),
    appointmentLikely: APPOINTMENT_RE.test(text),
    longText: text.trim().length >= 180,
    transcriptLen: text.trim().length,
  };
}

export function summarizePass1Intents(intents: unknown[]): {
  items: Pass1IntentSummaryItem[];
  types: string[];
  typeCounts: Record<string, number>;
} {
  const items: Pass1IntentSummaryItem[] = [];
  const typeCounts: Record<string, number> = {};

  for (const raw of intents) {
    const r = intentRecord(raw);
    if (!r) continue;
    const type = String(r.type ?? '')
      .trim()
      .toUpperCase();
    if (!type) continue;
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
    items.push({
      type,
      label: intentLabel(r),
      ...(typeof r.source_hint === 'string' && r.source_hint.trim()
        ? { sourceHint: r.source_hint.trim().slice(0, 48) }
        : {}),
      ...(typeof r.due === 'string' && r.due.trim() ? { due: r.due.trim() } : {}),
      ...(typeof r.arrivalDue === 'string' && r.arrivalDue.trim()
        ? { arrivalDue: r.arrivalDue.trim() }
        : {}),
    });
  }

  return { items, types: items.map((it) => it.type), typeCounts };
}

export function detectPass1Anomalies(params: {
  transcript: string;
  intents: unknown[];
  parseDrops?: number;
  rawIntentsCount?: number;
}): string[] {
  const signals = detectPass1TranscriptSignals(params.transcript);
  const { types, typeCounts } = summarizePass1Intents(params.intents);
  const intentCount = types.length;
  const anomalies: string[] = [];

  if (intentCount === 0) anomalies.push('no_intents');

  const rawCount = params.rawIntentsCount ?? intentCount;
  const drops = params.parseDrops ?? Math.max(0, rawCount - intentCount);
  if (drops > 0) anomalies.push('parse_partial_loss');

  const singleProject =
    intentCount === 1 && types[0] === 'PROJECT' && (typeCounts.PROJECT ?? 0) === 1;

  if (singleProject && signals.adminEmailLikely && signals.appointmentLikely) {
    anomalies.push('single_project_on_admin_and_appointment');
  } else if (singleProject && (signals.adminEmailLikely || signals.appointmentLikely)) {
    anomalies.push('single_project_on_rich_text');
  }

  if (signals.adminEmailLikely && signals.appointmentLikely && intentCount <= 1) {
    anomalies.push('missing_multi_extraction');
  }

  if (signals.adminEmailLikely && (typeCounts.TASK ?? 0) >= 3) {
    anomalies.push('over_split_admin_tasks');
  }

  if (intentCount >= 2 && (typeCounts.PROJECT ?? 0) >= 1 && !types.every((t) => t === 'PROJECT')) {
    anomalies.push('mixed_project_with_actionable');
  }

  for (const raw of params.intents) {
    const r = intentRecord(raw);
    if (!r) continue;
    if (String(r.type ?? '').trim().toUpperCase() !== 'TRIP') continue;
    const dest = String(r.destination ?? '').trim();
    const content = String(r.content ?? '').trim();
    if (dest && (!content || content.toLowerCase() === dest.toLowerCase())) {
      anomalies.push('trip_title_is_destination');
      break;
    }
  }

  return anomalies;
}

export function buildPass1Diagnostics(params: {
  transcript: string;
  intents: unknown[];
  parseDrops?: number;
  rawIntentsCount?: number;
}): Pass1Diagnostics {
  const signals = detectPass1TranscriptSignals(params.transcript);
  const summary = summarizePass1Intents(params.intents);
  const anomalies = detectPass1Anomalies(params);
  return {
    intentCount: summary.types.length,
    types: summary.types,
    typeCounts: summary.typeCounts,
    items: summary.items,
    signals,
    anomalies,
    ...(params.parseDrops != null ? { parseDrops: params.parseDrops } : {}),
    ...(params.rawIntentsCount != null ? { rawIntentsCount: params.rawIntentsCount } : {}),
  };
}

export function logPass1Diagnostics(
  trace: string | undefined,
  phase: string,
  diagnostics: Pass1Diagnostics,
  extra?: Record<string, unknown>,
): void {
  logCaptureFlow(trace, phase, {
    intentCount: diagnostics.intentCount,
    types: diagnostics.types,
    typeCounts: diagnostics.typeCounts,
    items: diagnostics.items,
    signals: diagnostics.signals,
    anomalies: diagnostics.anomalies,
    ...(diagnostics.parseDrops != null ? { parseDrops: diagnostics.parseDrops } : {}),
    ...(diagnostics.rawIntentsCount != null ? { rawIntentsCount: diagnostics.rawIntentsCount } : {}),
    ...extra,
  });

  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  const prefix = diagnostics.anomalies.length ? '[PASS1_DIAG] ⚠️' : '[PASS1_DIAG]';
  const anomalyPart = diagnostics.anomalies.length ? ` anomalies=${diagnostics.anomalies.join('|')}` : '';
  console.log(
    `${prefix} phase=${phase}${anomalyPart} types=${diagnostics.types.join(',') || '—'} count=${diagnostics.intentCount}`,
    { items: diagnostics.items, signals: diagnostics.signals, ...extra },
  );
}

export function logPass1ParseDrops(
  trace: string | undefined,
  detail: { rawCount: number; parsedCount: number; drops: Pass1ParseDrop[] },
): void {
  if (detail.drops.length === 0 && detail.rawCount === detail.parsedCount) return;
  logCaptureFlow(trace, 'pass1_parse_drops', {
    rawCount: detail.rawCount,
    parsedCount: detail.parsedCount,
    dropCount: detail.drops.length,
    drops: detail.drops.slice(0, 12),
  });
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn('[PASS1_DIAG] parse_drops', detail);
  }
}
