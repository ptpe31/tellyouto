import type { OneTapUniversalResult } from '../oneTapUniversalCapture';
import type { IntentionDraft } from './IntentionStateMachine';

function safeTimeString(value: unknown, fallback: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return s || fallback;
}

function hasStructuredSignals(parsed: OneTapUniversalResult): boolean {
  const data = parsed.data ?? {};
  const dueLike = [
    data.dueDateTime,
    data.dueDateYmd,
    data.nextDueYmd,
    data.arrivalTime,
    data.date,
    data.monthDay,
  ].some((v) => typeof v === 'string' && v.trim().length > 0);
  const placeLike = [data.location_address, data.destination_name, data.destination, data.personName].some(
    (v) => typeof v === 'string' && v.trim().length > 0,
  );
  return dueLike || placeLike;
}

function shouldTreatAsLongAudioMemo(parsed: OneTapUniversalResult, transcript: string): boolean {
  const data = parsed.data ?? {};
  const aiFlag = data.is_long_memo === true || String(data.is_long_memo ?? '').toLowerCase() === 'true';
  if (aiFlag) return true;
  if (hasStructuredSignals(parsed)) return false;
  if (parsed.predictedType === 'NOTE') return true;
  return transcript.trim().length >= 160;
}

export function buildIntentionDraftsFromGemini(
  parsed: OneTapUniversalResult,
  transcript: string,
): IntentionDraft[] {
  const drafts: IntentionDraft[] = [];
  const lower = transcript.toLowerCase();

  const longAudioMemo = shouldTreatAsLongAudioMemo(parsed, transcript);

  if (longAudioMemo) {
    const title = parsed.title.trim() || transcript.trim().slice(0, 80) || 'Mémo audio';
    drafts.push({
      kind: 'NOTE',
      title,
      content: transcript.trim() || title,
      isAudioMemo: true,
      rawTranscript: transcript.trim() || undefined,
    });
  } else if (parsed.predictedType === 'HABIT' || parsed.predictedType === 'RECURRING_TASK') {
    drafts.push({
      kind: 'HABIT',
      title: parsed.title,
      time: safeTimeString(parsed.data.time, '08:00'),
      frequency: lower.includes('semaine') || lower.includes('hebdo') ? 'weekly' : 'daily',
    });
  } else if (parsed.predictedType === 'TASK') {
    drafts.push({
      kind: 'TASK',
      title: parsed.title,
      time: safeTimeString(parsed.data.dueDateTime, ''),
      notes: transcript.trim(),
    });
  } else if (parsed.predictedType === 'ANNIVERSARY') {
    const personName = String(parsed.data.personName ?? parsed.title).trim();
    const age = Number(parsed.data.age);
    drafts.push({
      kind: 'BIRTHDAY',
      personName: personName || 'Anniversaire',
      age: Number.isFinite(age) ? Math.max(0, Math.floor(age)) : null,
      date: safeTimeString(parsed.data.date, new Date().toISOString()),
      specialTasks: [],
    });
  } else if (parsed.predictedType === 'NOTE') {
    drafts.push({ kind: 'NOTE', content: transcript.trim() || parsed.title, title: parsed.title.trim() || undefined });
  } else {
    drafts.push({ kind: 'NOTE', content: transcript.trim() || parsed.title, title: parsed.title.trim() || undefined });
  }

  if (!longAudioMemo && /\b(minuteur|timer|dans \d+\s*(min|minute|second|sec))\b/i.test(lower)) {
    drafts.push({
      kind: 'TIMER',
      label: parsed.title || 'Timer',
      durationSec: /\b(\d+)\s*(min|minute)s?\b/i.test(lower)
        ? Number(lower.match(/\b(\d+)\s*(min|minute)s?\b/i)?.[1] ?? 5) * 60
        : Number(lower.match(/\b(\d+)\s*(sec|second)e?s?\b/i)?.[1] ?? 60),
    });
  }

  if (!longAudioMemo && /\b(trajet|aller|route|départ|arriver)\b/i.test(lower)) {
    drafts.push({
      kind: 'TRIP',
      destination: parsed.title || 'Destination',
      arrivalTime: safeTimeString(parsed.data.dueDateTime, new Date(Date.now() + 3600_000).toISOString()),
      safetyBuffer: 300,
      elasticJumpEnabled: true,
    });
  }

  return drafts;
}
