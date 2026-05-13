import { Dimensions } from 'react-native';

import type { TrankilV2TimelineItemRow } from '../api';

/** Ratio hauteur viewport Path A (peek immédiat, post-snapshot). Provisoire ~30 % pour lisibilité UX. */
export const CAPTURE_PEEK_PATH_A_RATIO = 0.3;

/** Ratio hauteur viewport Path B (vue validation, post–Pass 1). */
export const CAPTURE_PEEK_PATH_B_RATIO = 0.25;

/** Ratio hauteur sheet en mode « full » pendant le flux capture (SPEC / UX). */
export const CAPTURE_SHEET_FULL_MAX_RATIO = 0.95;

export function capturePeekWindowHeight(): number {
  return Math.max(1, Dimensions.get('window').height);
}

/** Path A : ratio `CAPTURE_PEEK_PATH_A_RATIO` × hauteur fenêtre (pas de plancher px). */
export function capturePeekPathAHeightPx(): number {
  const h = capturePeekWindowHeight();
  return Math.round(h * CAPTURE_PEEK_PATH_A_RATIO);
}

/** Path B : ratio `CAPTURE_PEEK_PATH_B_RATIO` × hauteur fenêtre (pas de plancher px). */
export function capturePeekPathBHeightPx(): number {
  const h = capturePeekWindowHeight();
  return Math.round(h * CAPTURE_PEEK_PATH_B_RATIO);
}

export type PeekSnapshotPayload = {
  categoryTag?: unknown;
  predictedType?: unknown;
  title?: unknown;
};

/**
 * Row placeholder `peek_pending` pour la sheet (Path A) à partir du snapshot `submitCapturePayload`.
 */
export function buildPeekPendingRowFromSnapshot(
  payload: PeekSnapshotPayload,
  normalizeCategoryId: (raw: unknown) => string,
): TrankilV2TimelineItemRow {
  const categoryId = normalizeCategoryId(payload.categoryTag);
  const rawType = String(payload.predictedType ?? 'NOTE').trim().toUpperCase();
  const allowed = new Set(['TASK', 'NOTE', 'HABIT', 'LIST', 'TRIP', 'PROJECT', 'AUDIO']);
  const type = allowed.has(rawType) ? rawType : 'NOTE';
  const title = String(payload.title ?? '').trim();
  return {
    id: 'peek_pending',
    type: type as TrankilV2TimelineItemRow['type'],
    category_id: categoryId,
    display_title: title,
    content_raw: '',
    due_date: null,
    metadata_json: '{}',
    status: 'TODO',
    created_at: Date.now(),
    updated_at: Date.now(),
    is_archived: 0,
    is_dirty: 0,
  } as unknown as TrankilV2TimelineItemRow;
}
