import { doc, setDoc } from 'firebase/firestore';

import { getFirestoreDb } from './firebase';
import { getOrCreateDeviceId } from './syncService';

/**
 * Indique côté Firestore si l’utilisateur est en session Focus (évite les rappels proactifs).
 */
export async function setRemoteFocusSessionActive(
  active: boolean,
  intentionId?: string,
): Promise<void> {
  const db = getFirestoreDb();
  if (!db) return;
  const deviceId = await getOrCreateDeviceId();
  await setDoc(
    doc(db, 'devices', deviceId),
    {
      focus_session_active: active,
      focus_session_intention_id:
        active && intentionId ? intentionId : null,
      focus_session_updated_at: Date.now(),
    },
    { merge: true },
  );
}
