/**
 * Placeholder local transcription pipeline.
 * Simule un traitement IA local pour valider le flux audio.
 */
export async function transcribeAudio(uri: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  console.log(`[TranscriptionService] audio source uri=${uri}`);
  return 'Transcription en cours...';
}
