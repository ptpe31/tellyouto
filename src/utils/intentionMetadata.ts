/** Champs optionnels persistés dans `metadata_json` (intentions Trankil-v2). */
export type TrankilIntentMetadata = {
  track_streak?: boolean;
  recurrence_rule?: unknown;
  cadenceDescription?: string;
  preferredTimeHm?: string;
  [key: string]: unknown;
};

export function parseIntentionMetadata(raw: string | null | undefined): TrankilIntentMetadata | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as TrankilIntentMetadata) : null;
  } catch {
    return null;
  }
}

export function isTrackStreakEnabled(meta: TrankilIntentMetadata | Record<string, unknown> | null | undefined): boolean {
  return meta?.track_streak === true;
}
