/**
 * Local transcription adapter for whisper.rn.
 * Keeps runtime resilient when native module is unavailable.
 */
export async function transcribeWithWhisperLocal(audioPath: string): Promise<string | null> {
  try {
    const mod: any = await import('whisper.rn/index');
    const fn =
      mod?.transcribe ??
      mod?.default?.transcribe ??
      mod?.Whisper?.transcribe;
    if (typeof fn !== 'function') return null;
    const result = await fn({
      filePath: audioPath,
      model: 'tiny',
      autoDetectLanguage: true,
    });
    const text = (result?.text ?? result?.result ?? '').toString().trim();
    return text || null;
  } catch {
    return null;
  }
}
