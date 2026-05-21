/**
 * DEPRECATED — effets post-capture « classiques » (calendrier / alarme Pro). Voir `nettoyage-code-mort.md` §10.
 */
import type {
  PostCaptureEffectsConfig,
  PostCaptureEffectsResult,
  PostCaptureMirrorType,
  TemporalRecapIntroKey,
} from './types';

export async function applyPostCaptureEffects(
  _intentionId: string,
  _type: PostCaptureMirrorType,
  _params: { title: string; dueDateYmd: string | null; metadataJson?: string },
  _config: PostCaptureEffectsConfig,
): Promise<PostCaptureEffectsResult> {
  void _intentionId;
  void _type;
  void _params;
  void _config;
  return { syncedCalendar: false, archived: false, alarmOk: false };
}

export function buildTemporalCaptureRecap(
  introKey: TemporalRecapIntroKey,
  _result: PostCaptureEffectsResult,
  translate: (key: string) => string,
): string {
  return translate(introKey);
}

/* Original : calendar mirror, archive, scheduleTrankilV2IntentionAlarmById — voir git */
