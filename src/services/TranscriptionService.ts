import * as FileSystem from 'expo-file-system';

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
    /\btous\s+les\s+(lundis?|mardis?|mercredis?|jeudis?|vendredis?|samedis?|dimanches?)\b/giu,
    /\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/giu,
    /\b(?:après-?\s*demain|après demain)\b/giu,
    /\b(?:the\s+)?day\s+after\s+tomorrow\b/giu,
    /\b(?:demain|tomorrow)\b/giu,
    /\bce\s+soir\b/giu,
    /\b(?:tonight|this\s+evening)\b/giu,
    /\bce\s+matin\b/giu,
    /\bthis\s+morning\b/giu,
    /\b(?:à|a)\s*\d{1,2}\s*h\s*\d{2}\b/giu,
    /\b\d{1,2}\s*h\s*\d{2}\b/giu,
    /\b(?:à|a)\s*\d{1,2}\s*h\b/giu,
    /\b\d{1,2}\s*h\b/giu,
    /\b(?:à|at)\s*\d{1,2}:\d{2}\b/giu,
    /\b\d{1,2}:\d{2}\b/giu,
    /\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/giu,
    /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/giu,
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
  if (
    /\b(habitude|routine|chaque\s+jour|tous\s+les\s+jours|quotidiennement|every\s+day|daily(\s+habit)?)\b/i.test(
      lower,
    )
  ) {
    kind = 'habit';
  } else if (
    /\b(projet|project|jalon|milestone|livrer|delivery|roadmap)\b/i.test(lower)
  ) {
    kind = 'project';
  }

  if (!title) {
    title = raw;
  }

  return { kind, title, timeMarker };
}

/**
 * Placeholder transcription : journalise la taille du fichier, puis retourne le texte simulé si fourni.
 */
export async function transcribeAudio(
  uri: string,
  opts?: { simulatedTranscript?: string },
): Promise<string> {
  try {
    const fileInfo = await FileSystem.getInfoAsync(uri);
    const sizeBytes = fileInfo.exists && 'size' in fileInfo ? fileInfo.size ?? 0 : 0;
    console.log(`[TranscriptionService] audio source uri=${uri} size=${sizeBytes}B`);
  } catch (error) {
    console.log(`[TranscriptionService] failed to inspect audio file uri=${uri}`, error);
  }
  await delay(1000);
  const fromOpts = opts?.simulatedTranscript?.trim();
  return fromOpts ?? '';
}

/**
 * Étape cloud simulée : graphe sémantique (tags, polarité) avant persistance locale.
 */
export async function finalizeIntentWithCloudSemanticGraph(
  payload: {
    kind: VoiceIntentKind;
    title: string;
    timeMarker: string;
    rawTranscript: string;
  },
  meta?: { audioUri?: string | null },
): Promise<{
  semantic_tags: string[];
  sentiment_score: number | null;
  semantic_cluster_id: string | null;
}> {
  let audioSizeB: number | null = null;
  const audioUri = meta?.audioUri?.trim();
  if (audioUri) {
    try {
      const fileInfo = await FileSystem.getInfoAsync(audioUri);
      if (fileInfo.exists && 'size' in fileInfo && typeof fileInfo.size === 'number') {
        audioSizeB = fileInfo.size;
      }
    } catch (error) {
      console.log('[CloudSemanticGraph] audio file stat failed', error);
    }
  }
  const approxDurationMs = Math.round(
    Math.min(120_000, 600 + payload.rawTranscript.length * 38 + payload.title.length * 10),
  );
  console.log(
    `[CloudSemanticGraph] finalize kind=${payload.kind} audioSize=${audioSizeB ?? 'n/a'}B approxDurationMs=${approxDurationMs}`,
  );
  await delay(450);
  return {
    semantic_tags: [`kind:${payload.kind}`, 'voice-capture'],
    sentiment_score: 0.12,
    semantic_cluster_id: null,
  };
}

export async function deleteAudioCacheFile(uri: string | null | undefined): Promise<void> {
  if (!uri?.trim()) return;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  } catch (e) {
    console.log('[TranscriptionService] deleteAudioCacheFile failed', e);
  }
}
