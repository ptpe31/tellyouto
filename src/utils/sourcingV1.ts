/**
 * Contrat `metadata_json.sourcing_v1` — ancrage source / batch / séries temporelles.
 * Zéro migration SQLite : blob JSON via {@link patchMetadata}.
 */
import { newUuidV4 } from './uuid';

export const SOURCING_V1_CHILD_POOL_SIZE = 12;

export type SourcingTitleMode = 'ACTION' | 'DESCRIPTIVE';

export type SourcingSourceKind = 'image' | 'audio' | 'text' | 'share';

export type SourcingEventSeriesSlot = {
  due: string;
  label?: string;
};

export type SourcingEventSeriesV1 = {
  slots: SourcingEventSeriesSlot[];
  timeline_index: 0;
};

export type SourcingV1 = {
  version: 1;
  capture_batch_id: string;
  vault_parent_id: string | null;
  auto_parent_id: string | null;
  source_hint: string | null;
  title_mode: SourcingTitleMode;
  source_kind: SourcingSourceKind;
  child_ids?: string[];
  event_series_v1?: SourcingEventSeriesV1;
};

/** Contexte immuable pré-alloué à T0 dans submitCapturePayload. */
export type CaptureBatchContext = {
  capture_batch_id: string;
  vault_parent_id: string | null;
  auto_parent_id: string;
  child_id_pool: string[];
  source_kind: SourcingSourceKind;
};

export function isSourcingTitleMode(raw: unknown): raw is SourcingTitleMode {
  return raw === 'ACTION' || raw === 'DESCRIPTIVE';
}

export function normalizeSourceHint(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  return s.slice(0, 48);
}

export function createCaptureBatchContext(params: {
  preassignedIntentionId?: string | null;
  source_kind: SourcingSourceKind;
}): CaptureBatchContext {
  const vaultParent = String(params.preassignedIntentionId ?? '').trim() || null;
  return {
    capture_batch_id: newUuidV4(),
    vault_parent_id: vaultParent,
    auto_parent_id: newUuidV4(),
    child_id_pool: Array.from({ length: SOURCING_V1_CHILD_POOL_SIZE }, () => newUuidV4()),
    source_kind: params.source_kind,
  };
}

export function captureBatchContextToSourcingStub(ctx: CaptureBatchContext): SourcingV1 {
  return {
    version: 1,
    capture_batch_id: ctx.capture_batch_id,
    vault_parent_id: ctx.vault_parent_id,
    auto_parent_id: ctx.auto_parent_id,
    source_hint: null,
    title_mode: 'ACTION',
    source_kind: ctx.source_kind,
    child_ids: [],
  };
}

export function parseSourcingV1(metadataJson: string | null | undefined): SourcingV1 | null {
  if (!metadataJson || !String(metadataJson).trim()) return null;
  try {
    const root = JSON.parse(metadataJson) as Record<string, unknown>;
    const raw = root.sourcing_v1;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    if (Number(o.version) !== 1) return null;
    const captureBatchId = String(o.capture_batch_id ?? '').trim();
    if (!captureBatchId) return null;
    const titleMode = isSourcingTitleMode(o.title_mode) ? o.title_mode : 'ACTION';
    const sourceKind = (['image', 'audio', 'text', 'share'] as const).includes(o.source_kind as SourcingSourceKind)
      ? (o.source_kind as SourcingSourceKind)
      : 'text';
    let eventSeries: SourcingEventSeriesV1 | undefined;
    const esRaw = o.event_series_v1;
    if (esRaw && typeof esRaw === 'object' && !Array.isArray(esRaw)) {
      const slotsRaw = (esRaw as Record<string, unknown>).slots;
      if (Array.isArray(slotsRaw) && slotsRaw.length > 0) {
        const slots: SourcingEventSeriesSlot[] = [];
        for (const slot of slotsRaw) {
          if (!slot || typeof slot !== 'object') continue;
          const due = String((slot as Record<string, unknown>).due ?? '').trim();
          if (!due) continue;
          const label = String((slot as Record<string, unknown>).label ?? '').trim();
          slots.push(label ? { due, label } : { due });
        }
        if (slots.length > 0) {
          eventSeries = { slots, timeline_index: 0 };
        }
      }
    }
    const childIds = Array.isArray(o.child_ids)
      ? o.child_ids.map((x) => String(x ?? '').trim()).filter(Boolean)
      : undefined;
    return {
      version: 1,
      capture_batch_id: captureBatchId,
      vault_parent_id: String(o.vault_parent_id ?? '').trim() || null,
      auto_parent_id: String(o.auto_parent_id ?? '').trim() || null,
      source_hint: normalizeSourceHint(o.source_hint),
      title_mode: titleMode,
      source_kind: sourceKind,
      ...(childIds?.length ? { child_ids: childIds } : {}),
      ...(eventSeries ? { event_series_v1: eventSeries } : {}),
    };
  } catch {
    return null;
  }
}

/** Rehydrate un batch offline depuis le stub `sourcing_v1` du NOTE shell. */
export function captureBatchContextFromSourcingStub(stub: SourcingV1): CaptureBatchContext | null {
  const captureBatchId = String(stub.capture_batch_id ?? '').trim();
  const autoParentId = String(stub.auto_parent_id ?? '').trim();
  if (!captureBatchId || !autoParentId) return null;
  const poolFromStub = Array.isArray(stub.child_ids) ? [...stub.child_ids] : [];
  while (poolFromStub.length < SOURCING_V1_CHILD_POOL_SIZE) {
    poolFromStub.push(newUuidV4());
  }
  return {
    capture_batch_id: captureBatchId,
    vault_parent_id: stub.vault_parent_id,
    auto_parent_id: autoParentId,
    child_id_pool: poolFromStub.slice(0, SOURCING_V1_CHILD_POOL_SIZE),
    source_kind: stub.source_kind,
  };
}

export function buildSourcingV1ForChild(params: {
  batch: CaptureBatchContext;
  sourceHint: string | null;
  titleMode: SourcingTitleMode;
  eventSeries?: SourcingEventSeriesV1;
  childIds?: string[];
  autoParentId?: string | null;
}): SourcingV1 {
  return {
    version: 1,
    capture_batch_id: params.batch.capture_batch_id,
    vault_parent_id: params.batch.vault_parent_id,
    auto_parent_id: params.autoParentId ?? params.batch.auto_parent_id,
    source_hint: params.sourceHint,
    title_mode: params.titleMode,
    source_kind: params.batch.source_kind,
    ...(params.childIds?.length ? { child_ids: params.childIds } : {}),
    ...(params.eventSeries ? { event_series_v1: params.eventSeries } : {}),
  };
}

export function coerceEventSeriesFromIntent(raw: unknown): SourcingEventSeriesV1 | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const slots: SourcingEventSeriesSlot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const due = String((item as Record<string, unknown>).due ?? '').trim();
    if (!due) continue;
    const label = String((item as Record<string, unknown>).label ?? '').trim();
    slots.push(label ? { due, label } : { due });
  }
  if (slots.length < 2) return undefined;
  return { slots, timeline_index: 0 };
}
