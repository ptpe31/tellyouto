import { insertTrankilV2Intention } from '../../api/trankilV2Db';
import type { CaptureChooseActionResult, CaptureStrategyDeps } from './types';

async function insertQuickNote(params: {
  id: string;
  title: string;
  transcript: string;
}): Promise<void> {
  await insertTrankilV2Intention({
    id: params.id,
    type: 'NOTE',
    title: params.title.trim() || 'Note',
    due_date: null,
    content_raw: params.transcript,
    metadata_json: JSON.stringify(
      {
        source: 'talk_debug_quick_note',
        local_stt_transcript: params.transcript,
      },
      null,
      2,
    ),
    suggested_tags: JSON.stringify(['sans_pression']),
    category_id: 'sans_pression',
    parent_id: null,
    status: 'TODO',
    is_organized: 0,
    is_local_processed: 1,
    complexity_level: 0,
    created_at: Date.now(),
  });
}

export async function executeQuickNoteCapture(params: {
  deps: CaptureStrategyDeps;
  title: string;
  finalTranscript: string;
  fallbackNoteTitle: string;
}): Promise<CaptureChooseActionResult> {
  const { deps, title, finalTranscript, fallbackNoteTitle } = params;
  try {
    const id = deps.newId();
    await insertQuickNote({
      id,
      title: title || fallbackNoteTitle,
      transcript: finalTranscript,
    });
    return {
      ok: true,
      outcome: {
        kind: 'simple_note_or_audio' as const,
        successFeedbackI18nKey: 'talkDebug.noteSaved',
        intentionId: id,
      },
    };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function executeAudioMemoCapture(params: {
  deps: CaptureStrategyDeps;
  title: string;
  finalTranscript: string;
  fallbackAudioTitle: string;
  audioUri: string | null;
}): Promise<CaptureChooseActionResult> {
  const { deps, title, finalTranscript, fallbackAudioTitle, audioUri } = params;
  if (!audioUri) {
    return {
      ok: false,
      error: new Error('AUDIO_MISSING'),
      code: 'AUDIO_MISSING',
    };
  }
  try {
    const storedUri = await deps.persistAudioMemoFile(audioUri);
    const id = deps.newId();
    await insertTrankilV2Intention({
      id,
      type: 'AUDIO',
      title: title || fallbackAudioTitle,
      due_date: null,
      content_raw: finalTranscript,
      metadata_json: JSON.stringify(
        {
          source: 'talk_debug_audio_memo',
          local_stt_transcript: finalTranscript,
          audio_uri: storedUri,
        },
        null,
        2,
      ),
      suggested_tags: JSON.stringify(['sans_pression']),
      category_id: 'sans_pression',
      parent_id: null,
      status: 'TODO',
      is_organized: 0,
      is_local_processed: 1,
      complexity_level: 0,
      created_at: Date.now(),
    });
    return {
      ok: true,
      outcome: {
        kind: 'simple_note_or_audio' as const,
        successFeedbackI18nKey: 'talkDebug.audioSaved',
        intentionId: id,
      },
    };
  } catch (error) {
    return { ok: false, error };
  }
}
