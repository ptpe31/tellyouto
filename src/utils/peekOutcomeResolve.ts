/**
 * Résolution de l'intention à ouvrir en peek après ventilation multi-bloc.
 * @module peekOutcomeResolve
 */
import { PROJECT_MULTI_DOMAIN_ENABLED } from '../config/projectMultiDomain';
import type { PersistOneTapSuccess } from '../services/oneTapPersist';

function outcomeIntentionId(o: PersistOneTapSuccess): string {
  if ('intentionId' in o && typeof o.intentionId === 'string') {
    return o.intentionId.trim();
  }
  return '';
}

export type PeekPrimaryOutcome = {
  intentionId: string;
  title: string;
  predictedType: string;
};

function isPeekableProject(o: PersistOneTapSuccess): boolean {
  if (o.kind !== 'project_persisted') return false;
  if (PROJECT_MULTI_DOMAIN_ENABLED) {
    return Boolean(
      o.projectEnriched ||
        o.travelProjectEnriched ||
        o.isEnrichedProject ||
        o.isTravelProject,
    );
  }
  return Boolean(o.isTravelProject || o.travelProjectEnriched);
}

/**
 * Premier enfant actionable — ignore la coquille sourcing (`autoParentId`).
 * Les PROJECT enrichis (brief / auto Pass 2) sont peekables.
 */
export function resolvePeekPrimaryOutcome(
  outcomes: PersistOneTapSuccess[],
  autoParentId?: string | null,
): PeekPrimaryOutcome | null {
  const shellId = String(autoParentId ?? '').trim();

  for (const o of outcomes) {
    const id = outcomeIntentionId(o);
    if (!id) continue;
    if (shellId && id === shellId) continue;
    if (o.kind === 'simple_note_or_audio') continue;

    if (o.kind === 'project_persisted') {
      if (isPeekableProject(o)) {
        return {
          intentionId: id,
          title: String(o.title ?? '').trim() || 'Projet',
          predictedType: 'PROJECT',
        };
      }
      continue;
    }

    if (o.kind === 'persisted_temporal') {
      return {
        intentionId: id,
        title: o.title,
        predictedType: o.mirrorType === 'HABIT' ? 'HABIT' : 'TASK',
      };
    }
    if (o.kind === 'list_inventory_persisted') {
      return { intentionId: id, title: 'Liste', predictedType: 'LIST' };
    }
  }

  return null;
}
