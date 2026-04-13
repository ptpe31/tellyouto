import * as FileSystem from 'expo-file-system';

/**
 * Placeholder local transcription pipeline.
 * Simule un traitement IA local pour valider le flux audio.
 */
export async function transcribeAudio(uri: string): Promise<string> {
  try {
    const fileInfo = await FileSystem.getInfoAsync(uri);
    const sizeBytes = fileInfo.exists && 'size' in fileInfo ? fileInfo.size ?? 0 : 0;
    console.log(`[TranscriptionService] audio source uri=${uri} size=${sizeBytes}B`);
  } catch (error) {
    console.log(`[TranscriptionService] failed to inspect audio file uri=${uri}`, error);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return 'Transcription en cours...';
}
