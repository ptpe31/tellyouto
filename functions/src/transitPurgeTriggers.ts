import * as logger from 'firebase-functions/logger';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import type { Change } from 'firebase-functions/v2/firestore';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

/**
 * Si l’app marque un document de transit comme `processed` mais que deleteDoc échoue,
 * on supprime côté serveur (sécurité + rétention Trankil).
 */
async function deleteIfProcessed(
  change: Change<QueryDocumentSnapshot> | undefined,
): Promise<void> {
  if (!change?.after.exists) return;
  const data = change.after.data();
  if (data?.processed !== true) return;
  try {
    await change.after.ref.delete();
  } catch (e) {
    logger.warn('transitPurgeTriggers: delete failed', e);
  }
}

export const onRailInboxMarkedProcessed = onDocumentUpdated(
  'devices/{deviceId}/rail_inbox/{docId}',
  async (event) => {
    await deleteIfProcessed(event.data);
  },
);

export const onDeviceIntentionTransitProcessed = onDocumentUpdated(
  'devices/{deviceId}/intentions/{docId}',
  async (event) => {
    await deleteIfProcessed(event.data);
  },
);
