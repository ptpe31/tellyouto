import {
  getTrankilV2IntentionById,
  updateTrankilV2IntentionMetadataJson,
  updateTrankilV2IntentionPendingAiFlag,
} from '../api/trankilV2Db';

export function mergeIntentionMetadataJson(
  currentJson: string | undefined,
  fragment: Record<string, unknown>,
): string {
  let base: Record<string, unknown> = {};
  try {
    const p = JSON.parse(currentJson || '{}');
    if (p && typeof p === 'object' && !Array.isArray(p)) base = p as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return JSON.stringify({ ...base, ...fragment }, null, 2);
}

export function isLikelyTransientNetworkCaptureError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (!msg.trim()) return false;
  return (
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('internet') ||
    msg.includes('econn') ||
    msg.includes('socket') ||
    msg.includes('aborted') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504')
  );
}

/** Après échec IA : garde la note ; file d’attente si réseau, sinon étiquette échec. */
export async function applyOfflineFirstShellFailure(id: string, err: unknown): Promise<void> {
  const row = await getTrankilV2IntentionById(id);
  if (!row) return;
  const transient = isLikelyTransientNetworkCaptureError(err);
  const meta = mergeIntentionMetadataJson(row.metadata_json, transient
    ? {
        ai_transient_error: true,
        ai_processing_failed: false,
        ai_last_error_at: Date.now(),
      }
    : {
        ai_processing_failed: true,
        ai_transient_error: false,
      });
  await updateTrankilV2IntentionMetadataJson(id, meta);
  await updateTrankilV2IntentionPendingAiFlag(id, transient ? 1 : 0);
}
