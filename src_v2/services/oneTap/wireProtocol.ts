import type { OneTapPredictedType, OneTapUniversalResult } from '../../types/oneTap';

export type OneTapWireJson = {
  p?: OneTapPredictedType;
  k?: string;
  c?: string;
  t?: string;
  lang?: string;
  hasLogistics?: boolean;
  destination?: string | null;
  isLocationIncomplete?: boolean;
  logistics?: {
    hasLogistics: boolean;
    destination: string | null;
    isLocationIncomplete: boolean;
  };
  e?: number;
  isRecurring?: boolean;
  recurrenceRaw?: string;
  daysOffset?: number;
  minutesOffset?: number;
  anchor?: 'NOW' | 'START_OF_DAY';
  dueDate?: string;
  timeSpec?: {
    type: 'FIXED' | 'RELATIVE' | 'VAGUE' | 'NONE';
    rawDay: string | null;
    rawTime: string | null;
    value?: string | number | null;
  };
  d?: string;
  h?: string;
  n?: string;
  v?: string;
  l?: string[];
  smartScaling?: {
    pivotValue: number;
    unitLabel: string;
    items: { t: string; qty: number; isScalable: boolean }[];
  };
  a?: string;
  g?: string;
  m?: string;
};

function clampText(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length <= max ? t : t.slice(0, max);
}

export function seedWireFromSkeleton(s: OneTapUniversalResult): OneTapWireJson {
  const out: OneTapWireJson = {
    p: s.predictedType,
    k: clampText(s.categoryTag, 40),
    c: clampText(s.categoryTag, 40),
    t: clampText(s.title, 120),
  };
  const d = s.data;
  if (typeof d.elasticityFactor === 'number' && Number.isFinite(d.elasticityFactor)) out.e = d.elasticityFactor;
  if (typeof d.dueAtIso === 'string' && d.dueAtIso.trim()) out.dueDate = d.dueAtIso.trim();
  if (d.dueDateYmd) out.d = d.dueDateYmd;
  if (d.dueTimeHm) out.h = d.dueTimeHm;
  if (d.preferredTimeHm) out.h = d.preferredTimeHm;
  if (d.notes) out.n = clampText(d.notes, 600);
  if (d.destinationName) out.v = clampText(d.destinationName, 120);
  if (d.listItems && d.listItems.length > 0) out.l = d.listItems.slice(0, 40).map((x) => clampText(x, 60));
  if (d.personName) out.a = clampText(d.personName, 120);
  if (d.monthDay) out.g = clampText(d.monthDay, 10);
  if (d.memo) out.m = clampText(d.memo, 800);
  return out;
}

export function parseWireJson(raw: string): OneTapWireJson | null {
  const t = String(raw || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const s0 = (fence?.[1]?.trim() || t).trim();
  const start = s0.indexOf('{');
  const end = s0.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const s = s0.slice(start, end + 1).trim();
  try {
    const obj = JSON.parse(s) as unknown;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    return obj as OneTapWireJson;
  } catch {
    return null;
  }
}
