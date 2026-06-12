import * as FileSystem from 'expo-file-system/legacy';

import { IS_LOCAL_MODE } from '../../config/appConfig';
import { syncVaultImageToCloudIfEnabled } from '../fileStorage';
import { geminiAnalyzeImageBase64 } from '../geminiSemanticLab';
import { newUuidV4 } from '../../utils/uuid';

export { syncVaultImageToCloudIfEnabled };

const SHARE_TEMP_DIR = `${FileSystem.documentDirectory ?? ''}share_intake/`;

export type SharedImageFile = {
  path: string;
  mimeType?: string;
  fileName?: string;
};

function inferImageExtension(sourceUri: string, fileName?: string): string {
  const fromName = String(fileName || '')
    .trim()
    .match(/\.(jpe?g|png|gif|webp|heic|heif)$/i)?.[0];
  if (fromName) return fromName.toLowerCase();
  const fromUri = String(sourceUri || '')
    .trim()
    .match(/\.(jpe?g|png|gif|webp|heic|heif)(?:\?|$)/i)?.[0];
  if (fromUri) return fromUri.toLowerCase();
  return '.jpg';
}

function inferMimeFromPath(localPath: string): string {
  const lower = localPath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.heif')) return 'image/heif';
  return 'image/jpeg';
}

export async function ensureShareTempDir(): Promise<string> {
  if (!FileSystem.documentDirectory) {
    throw new Error('LOCAL_STORAGE_UNAVAILABLE');
  }
  await FileSystem.makeDirectoryAsync(SHARE_TEMP_DIR, { intermediates: true });
  return SHARE_TEMP_DIR;
}

/** Copie l’image partagée dans `documentDirectory/share_intake/` (100 % local). */
export async function saveSharedImageToLocal(sourceUri: string, fileName?: string): Promise<string> {
  const source = String(sourceUri || '').trim();
  if (!source) throw new Error('SHARE_IMAGE_SOURCE_EMPTY');
  await ensureShareTempDir();
  const ext = inferImageExtension(source, fileName);
  const target = `${SHARE_TEMP_DIR}${Date.now()}_${newUuidV4().slice(0, 8)}${ext}`;
  await FileSystem.copyAsync({ from: source, to: target });
  return target;
}

export async function readLocalImageAsBase64(
  localPath: string,
): Promise<{ base64: string; mimeType: string }> {
  const base64 = await FileSystem.readAsStringAsync(localPath, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { base64, mimeType: inferMimeFromPath(localPath) };
}

/**
 * Stub réversible : en mode local, aucune synchro cloud.
 * Futur : Firebase Storage + métadonnées Firestore.
 */
export async function uploadToCloudIfEnabled(imagePath: string): Promise<string | null> {
  if (IS_LOCAL_MODE) {
    return null;
  }
  if (__DEV__) {
    console.log('[ShareService] uploadToCloudIfEnabled stub — image kept local:', imagePath);
  }
  return null;
}

/** Vision Gemini → transcript texte injectable dans le pipeline One-Tap. */
export async function extractTranscriptFromSharedImage(
  localPath: string,
  mimeType?: string,
): Promise<string> {
  const modeLabel = IS_LOCAL_MODE ? 'LOCAL' : 'PROXY';
  console.log(`[ShareService] Image reçue, envoi vers Gemini en mode ${modeLabel}`);
  const { base64, mimeType: inferred } = await readLocalImageAsBase64(localPath);
  const mime = String(mimeType || inferred || 'image/jpeg').trim() || 'image/jpeg';
  const transcript = await geminiAnalyzeImageBase64(base64, mime);
  return transcript.trim();
}
