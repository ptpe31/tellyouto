import type { Firestore } from 'firebase-admin/firestore';

const STALE_MS = 24 * 60 * 60 * 1000;
const BATCH_MAX = 400;

/**
 * Supprime les documents de transit restés sur le Cloud (app fermée, deleteDoc raté, etc.).
 * — `rail_inbox` : messages non ingérés depuis > 24h (`created_at`).
 * — `intentions` : copies temporaires de sync dont `transit_expires_at` est dépassé.
 */
export async function purgeStaleTransitDocuments(
  firestore: Firestore,
): Promise<{
  railInboxDeleted: number;
  intentionsDeleted: number;
  processedRailDeleted: number;
  processedIntentionsDeleted: number;
}> {
  const inboxCutoff = Date.now() - STALE_MS;
  const railInboxDeleted = await deleteWhereFieldLessThan(
    firestore,
    'rail_inbox',
    'created_at',
    inboxCutoff,
  );
  const now = Date.now();
  const intentionsDeleted = await deleteWhereFieldLessThan(
    firestore,
    'intentions',
    'transit_expires_at',
    now,
  );
  const processedRailDeleted = await deleteWhereProcessedTrue(
    firestore,
    'rail_inbox',
  );
  const processedIntentionsDeleted = await deleteWhereProcessedTrue(
    firestore,
    'intentions',
  );

  return {
    railInboxDeleted,
    intentionsDeleted,
    processedRailDeleted,
    processedIntentionsDeleted,
  };
}

/** Repli planifié : documents encore présents après marquage `processed` (échec delete client). */
async function deleteWhereProcessedTrue(
  firestore: Firestore,
  collectionId: string,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < 50; i++) {
    const snap = await firestore
      .collectionGroup(collectionId)
      .where('processed', '==', true)
      .limit(BATCH_MAX)
      .get();
    if (snap.empty) break;
    const batch = firestore.batch();
    for (const d of snap.docs) {
      batch.delete(d.ref);
    }
    await batch.commit();
    total += snap.size;
    if (snap.size < BATCH_MAX) break;
  }
  return total;
}

async function deleteWhereFieldLessThan(
  firestore: Firestore,
  collectionId: string,
  field: string,
  thresholdMs: number,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < 50; i++) {
    const snap = await firestore
      .collectionGroup(collectionId)
      .where(field, '<', thresholdMs)
      .limit(BATCH_MAX)
      .get();
    if (snap.empty) break;
    const batch = firestore.batch();
    for (const d of snap.docs) {
      batch.delete(d.ref);
    }
    await batch.commit();
    total += snap.size;
    if (snap.size < BATCH_MAX) break;
  }
  return total;
}
