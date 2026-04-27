import { randomUUID } from 'expo-crypto';

import { getOrCreateViaUserId, withViaDb } from './db/Schema';
import type { OneTapUniversalResult } from './oneTapUniversalCapture';
import type { PersistOneTapSuccess } from './oneTapPersist';

function parseDueAtMs(draft: OneTapUniversalResult): number | null {
  const d = draft.data as Record<string, unknown>;
  const iso = typeof d.dueDateTime === 'string' ? d.dueDateTime.trim() : '';
  if (iso) {
    const dt = new Date(iso);
    const ms = dt.getTime();
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  const ymd = typeof d.dueDateYmd === 'string' ? d.dueDateYmd.trim() : '';
  const hm = typeof d.dueTimeHm === 'string' ? d.dueTimeHm.trim() : '';
  if (ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [y, m, day] = ymd.split('-').map((x) => parseInt(x, 10));
    let hh = 0;
    let mm = 0;
    if (hm && /^\d{1,2}:\d{2}$/.test(hm)) {
      hh = parseInt(hm.slice(0, hm.indexOf(':')), 10) || 0;
      mm = parseInt(hm.slice(hm.indexOf(':') + 1), 10) || 0;
    }
    const dt = new Date(y, m - 1, day, hh, mm, 0, 0);
    const ms = dt.getTime();
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return null;
}

function resolveCoreId(outcome: PersistOneTapSuccess): string {
  if (outcome.kind === 'persisted_temporal') return outcome.intentionId;
  if (outcome.kind === 'list_inventory_persisted') return outcome.intentionId;
  if (outcome.kind === 'simple_note_or_audio' && typeof outcome.intentionId === 'string' && outcome.intentionId.trim()) {
    return outcome.intentionId.trim();
  }
  return randomUUID();
}

export async function dualWriteViaCoreIntention(params: {
  draft: OneTapUniversalResult;
  transcript: string;
  outcome: PersistOneTapSuccess;
  entityLabel?: string;
}): Promise<void> {
  const { draft, transcript, outcome, entityLabel } = params;
  const id = resolveCoreId(outcome);
  const userId = await getOrCreateViaUserId();
  const now = Date.now();
  const title = draft.title.trim() || transcript.trim().slice(0, 200) || 'Intention';
  const dueAtMs = parseDueAtMs(draft);
  const type = String(draft.predictedType || 'NOTE');
  const metadata = {
    source: 'sas_modal_confirm',
    categoryTag: draft.categoryTag,
    predictedType: draft.predictedType,
    legacyOutcome: outcome.kind,
  };

  await withViaDb(async (db) => {
    await db.runAsync(
      `INSERT OR REPLACE INTO core_intentions (
        id, user_id, type, title, content_raw, due_at_ms, status, metadata_json, created_at_ms, updated_at_ms, is_synced
      ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, COALESCE((SELECT created_at_ms FROM core_intentions WHERE id = ?), ?), ?, 0)`,
      [id, userId, type, title, transcript.trim(), dueAtMs, JSON.stringify(metadata), id, now, now]
    );
  });

  const label = entityLabel ? ` | Entity: ${entityLabel}` : '';
  console.log(`[VIA-CORE-WRITE] 💾 Intention répliquée dans via_production.db${label} | ID: ${id}.`);
}
