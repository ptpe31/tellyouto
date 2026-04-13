const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type VoiceIntentKind = 'habit' | 'task' | 'project';

export type StructuredVoiceIntent = {
  kind: VoiceIntentKind;
  title: string;
  /** Fragment temporel détecté dans la phrase, ou chaîne vide. */
  timeMarker: string;
};

function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function escapeForRegexLiteral(fragment: string): string {
  return fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Prétraitement local (sans cloud) : type + titre nettoyé + marqueur temporel détecté.
 * Heuristiques FR/EN pour démonstration et flux offline-first.
 */
export function reformulateStructuredIntent(transcript: string): StructuredVoiceIntent {
  const raw = transcript.trim();
  if (!raw) {
    return { kind: 'task', title: '', timeMarker: '' };
  }

  const patterns: RegExp[] = [
    /\b(?:après-?\s*demain|après demain|the\s+day\s+after\s+tomorrow)\b/giu,
    /\b(?:demain|tomorrow)\b/giu,
    /\b(?:ce\s+matin|this\s+morning|ce\s+soir|tonight|this\s+evening)\b/giu,
    /\b(?:tous\s+les|every)\s+(lundis?|mardis?|mercredis?|jeudis?|vendredis?|samedis?|dimanches?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/giu,
    /\b(?:à|a|at)\s*\d{1,2}\s*h(?:\s*\d{2})?\b/giu,
    /\b\d{1,2}\s*h(?:\s*\d{2})?\b/giu,
    /\b(?:à|at)\s*\d{1,2}:\d{2}\b/giu,
    /\b\d{1,2}:\d{2}\b/giu,
  ];

  let timeMarker = '';
  for (const re of patterns) {
    const m = raw.match(re);
    if (m?.[0]) {
      timeMarker = normalizeSpaces(m[0]);
      break;
    }
  }

  let title = raw;
  if (timeMarker) {
    title = normalizeSpaces(
      title.replace(new RegExp(escapeForRegexLiteral(timeMarker), 'giu'), ''),
    );
  }

  const lower = raw.toLowerCase();
  let kind: VoiceIntentKind = 'task';
  if (/\b(chaque|tous\s+les|every|matin|soir|morning|evening)\b/i.test(lower)) {
    kind = 'habit';
  } else if (/\b(organiser|préparer|preparer|dossier|project)\b/i.test(lower)) {
    kind = 'project';
  }

  if (!title) {
    title = raw;
  }

  return { kind, title, timeMarker };
}

/**
 * Étape cloud simulée : graphe sémantique (tags, polarité) avant persistance locale.
 */
export async function finalizeIntentWithCloudSemanticGraph(payload: {
  kind: VoiceIntentKind;
  title: string;
  timeMarker: string;
  rawTranscript: string;
}): Promise<{
  semantic_tags: string[];
  sentiment_score: number | null;
  semantic_cluster_id: string | null;
}> {
  const approxDurationMs = Math.round(
    Math.min(120_000, 600 + payload.rawTranscript.length * 38 + payload.title.length * 10),
  );
  console.log(
    `[CloudSemanticGraph] finalize kind=${payload.kind} approxDurationMs=${approxDurationMs}`,
  );
  await delay(450);
  return {
    semantic_tags: [`kind:${payload.kind}`, 'voice-capture'],
    sentiment_score: 0.12,
    semantic_cluster_id: null,
  };
}
