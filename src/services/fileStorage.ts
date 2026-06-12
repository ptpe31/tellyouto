import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { IS_LOCAL_MODE } from '../config/appConfig';

const VAULT_DIR_NAME = 'TalknDone-Vault';
const VAULT_DIR = `${FileSystem.documentDirectory ?? ''}${VAULT_DIR_NAME}/`;
const MAX_IMAGE_WIDTH_PX = 1200;
const JPEG_QUALITY = 0.7;

export function getVaultDirectory(): string {
  return VAULT_DIR;
}

export function buildVaultImagePath(intentionId: string): string {
  const id = String(intentionId || '').trim();
  if (!id) throw new Error('VAULT_INTENTION_ID_EMPTY');
  return `${VAULT_DIR}${id}.jpg`;
}

export async function ensureVaultDir(): Promise<string> {
  if (!FileSystem.documentDirectory) {
    throw new Error('LOCAL_STORAGE_UNAVAILABLE');
  }
  await FileSystem.makeDirectoryAsync(VAULT_DIR, { intermediates: true });
  return VAULT_DIR;
}

/**
 * Compresse (JPEG 70 %, max 1200 px de large) et enregistre dans le Vault local.
 * Nom immuable : `{intentionId}.jpg`.
 */
export async function saveAndCompressImage(uri: string, intentionId: string): Promise<string> {
  const source = String(uri || '').trim();
  if (!source) throw new Error('VAULT_IMAGE_SOURCE_EMPTY');
  await ensureVaultDir();
  const target = buildVaultImagePath(intentionId);

  const manipulated = await manipulateAsync(
    source,
    [{ resize: { width: MAX_IMAGE_WIDTH_PX } }],
    { compress: JPEG_QUALITY, format: SaveFormat.JPEG },
  );

  if (manipulated.uri === target) {
    return target;
  }

  const existing = await FileSystem.getInfoAsync(target);
  if (existing.exists) {
    await FileSystem.deleteAsync(target, { idempotent: true });
  }
  await FileSystem.copyAsync({ from: manipulated.uri, to: target });
  return target;
}

/** Retourne le chemin local si `{intentionId}.jpg` existe dans le Vault. */
export async function getImagePath(intentionId: string): Promise<string | null> {
  const id = String(intentionId || '').trim();
  if (!id || !FileSystem.documentDirectory) return null;
  const path = buildVaultImagePath(id);
  const info = await FileSystem.getInfoAsync(path);
  return info.exists ? path : null;
}

/** Supprime physiquement `{intentionId}.jpg` du Vault (idempotent). */
export async function deleteImage(intentionId: string): Promise<void> {
  const path = await getImagePath(intentionId);
  if (!path) return;
  await FileSystem.deleteAsync(path, { idempotent: true });
}

/**
 * Stub réversible : en mode local, aucune synchro cloud.
 * Futur : Firebase Storage (`gs://…/TalknDone-Vault/{intentionId}.jpg`).
 */
export async function syncVaultImageToCloudIfEnabled(intentionId: string): Promise<string | null> {
  if (IS_LOCAL_MODE) {
    return null;
  }
  const localPath = await getImagePath(intentionId);
  if (!localPath) return null;
  if (__DEV__) {
    console.log('[Vault] syncVaultImageToCloudIfEnabled stub — image kept local:', localPath);
  }
  return null;
}
