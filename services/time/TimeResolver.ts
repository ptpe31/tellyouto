type TimeSpecType = 'FIXED' | 'RELATIVE' | 'VAGUE' | 'NONE';

export type TimeSpec = {
  type: TimeSpecType;
  rawDay: string | null;
  rawTime: string | null;
  value?: string | number | null;
};

type ResolveResult = {
  dueAtIso: string;
  dueDateYmd: string;
  dueTimeHm: string;
};

function toIsoNoMs(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function ymdFromUtc(d: Date): string {
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function hmFromUtc(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function norm(s: string): string {
  return stripAccents(String(s || '').trim().toLowerCase());
}

function parseClockTime(raw: string | null): { h: number; m: number } | null {
  if (!raw) return null;
  const t = norm(raw);
  if (t.includes('midi')) return { h: 12, m: 0 };
  if (t.includes('minuit')) return { h: 0, m: 0 };
  const m1 = t.match(/\b(\d{1,2})\s*(?:h|:)\s*(\d{2})\b/);
  if (m1) {
    const h = Number.parseInt(m1[1], 10);
    const m = Number.parseInt(m1[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return { h, m };
  }
  const m2 = t.match(/\b(\d{1,2})\s*h\b/);
  if (m2) {
    const h = Number.parseInt(m2[1], 10);
    if (h >= 0 && h <= 23) return { h, m: 0 };
  }
  const m3 = t.match(/\b(\d{1,2})\s*:\s*(\d{2})\b/);
  if (m3) {
    const h = Number.parseInt(m3[1], 10);
    const m = Number.parseInt(m3[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return { h, m };
  }
  return null;
}

function vagueTimeToClock(raw: string | null): { h: number; m: number } | null {
  if (!raw) return null;
  const t = norm(raw);
  if (t.includes('matin')) return { h: 8, m: 0 };
  if (t.includes('apres-midi') || t.includes('aprem') || t.includes('apres midi')) return { h: 15, m: 0 };
  if (t.includes('soir')) return { h: 19, m: 0 };
  if (t.includes('nuit')) return { h: 21, m: 0 };
  return parseClockTime(raw);
}

function parseDayOffset(rawDay: string | null, refNow: Date): { y: number; m: number; d: number } | null {
  if (!rawDay) return null;
  const t = norm(rawDay);
  if (t.includes("aujourd'hui") || t.includes('aujourdhui') || t.includes('today')) {
    return { y: refNow.getUTCFullYear(), m: refNow.getUTCMonth(), d: refNow.getUTCDate() };
  }
  if (t.includes('demain') || t.includes('tomorrow')) {
    const dt = new Date(Date.UTC(refNow.getUTCFullYear(), refNow.getUTCMonth(), refNow.getUTCDate() + 1, 0, 0, 0));
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
  }
  if (t.includes('apres-demain') || t.includes('apres demain')) {
    const dt = new Date(Date.UTC(refNow.getUTCFullYear(), refNow.getUTCMonth(), refNow.getUTCDate() + 2, 0, 0, 0));
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
  }

  const months: Record<string, number> = {
    janvier: 0,
    fevrier: 1,
    mars: 2,
    avril: 3,
    mai: 4,
    juin: 5,
    juillet: 6,
    aout: 7,
    septembre: 8,
    octobre: 9,
    novembre: 10,
    decembre: 11,
  };
  const md = t.match(/\b(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/);
  if (md) {
    const day = Number.parseInt(md[1], 10);
    const month = months[md[2]];
    if (day >= 1 && day <= 31) {
      let year = refNow.getUTCFullYear();
      const dt0 = new Date(Date.UTC(year, month, day, 0, 0, 0));
      const ref0 = new Date(Date.UTC(refNow.getUTCFullYear(), refNow.getUTCMonth(), refNow.getUTCDate(), 0, 0, 0));
      if (dt0.getTime() < ref0.getTime()) year += 1;
      return { y: year, m: month, d: day };
    }
  }

  const days: Array<{ key: string; idx: number }> = [
    { key: 'dimanche', idx: 0 },
    { key: 'sunday', idx: 0 },
    { key: 'lundi', idx: 1 },
    { key: 'monday', idx: 1 },
    { key: 'mardi', idx: 2 },
    { key: 'tuesday', idx: 2 },
    { key: 'mercredi', idx: 3 },
    { key: 'wednesday', idx: 3 },
    { key: 'jeudi', idx: 4 },
    { key: 'thursday', idx: 4 },
    { key: 'vendredi', idx: 5 },
    { key: 'friday', idx: 5 },
    { key: 'samedi', idx: 6 },
    { key: 'saturday', idx: 6 },
  ];
  const match = days.find((d) => t.includes(d.key));
  if (match) {
    const refDow = refNow.getUTCDay();
    let delta = (match.idx - refDow + 7) % 7;
    const wantsNext = t.includes('prochain') || t.includes('next');
    if (delta === 0 || wantsNext) delta = delta === 0 ? 7 : delta;
    const dt = new Date(Date.UTC(refNow.getUTCFullYear(), refNow.getUTCMonth(), refNow.getUTCDate() + delta, 0, 0, 0));
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
  }

  return null;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
}

function setUtcClock(d: Date, h: number, m: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, 0));
}

function minutesSinceStartOfDay(clock: { h: number; m: number }): number {
  return clock.h * 60 + clock.m;
}

export function resolveTimeSpec(timeSpec: TimeSpec, refNowIso: string): ResolveResult | null {
  const refNow = new Date(refNowIso);
  if (Number.isNaN(refNow.getTime())) return null;
  const type = timeSpec?.type ?? 'NONE';

  if (type === 'NONE') return null;

  if (type === 'RELATIVE') {
    const n = typeof timeSpec.value === 'number' ? timeSpec.value : Number.parseInt(String(timeSpec.value ?? ''), 10);
    if (!Number.isFinite(n)) return null;
    const dt = new Date(refNow.getTime() + Math.trunc(n) * 60 * 1000);
    const dueAtIso = toIsoNoMs(dt);
    return { dueAtIso, dueDateYmd: ymdFromUtc(dt), dueTimeHm: hmFromUtc(dt) };
  }

  const day = parseDayOffset(timeSpec.rawDay, refNow);
  const dayBase = day
    ? new Date(Date.UTC(day.y, day.m, day.d, 0, 0, 0))
    : new Date(Date.UTC(refNow.getUTCFullYear(), refNow.getUTCMonth(), refNow.getUTCDate(), 0, 0, 0));

  if (type === 'VAGUE') {
    const clock = vagueTimeToClock(timeSpec.rawTime);
    if (!clock) return null;
    let dt = setUtcClock(dayBase, clock.h, clock.m);
    if (dt.getTime() <= refNow.getTime() && !timeSpec.rawDay) {
      dt = new Date(dt.getTime() + 24 * 60 * 60 * 1000);
    }
    const dueAtIso = toIsoNoMs(dt);
    return { dueAtIso, dueDateYmd: ymdFromUtc(dt), dueTimeHm: hmFromUtc(dt) };
  }

  if (type === 'FIXED') {
    const clock = parseClockTime(timeSpec.rawTime) ?? vagueTimeToClock(timeSpec.rawTime) ?? { h: 9, m: 0 };
    let dt = setUtcClock(dayBase, clock.h, clock.m);
    if (!timeSpec.rawDay && dt.getTime() <= refNow.getTime()) {
      dt = new Date(dt.getTime() + 24 * 60 * 60 * 1000);
    }
    if (timeSpec.rawDay && !parseDayOffset(timeSpec.rawDay, refNow)) {
      const refDay = startOfUtcDay(refNow);
      dt = setUtcClock(refDay, clock.h, clock.m);
      if (dt.getTime() <= refNow.getTime()) dt = new Date(dt.getTime() + 24 * 60 * 60 * 1000);
    }
    const dueAtIso = toIsoNoMs(dt);
    return { dueAtIso, dueDateYmd: ymdFromUtc(dt), dueTimeHm: hmFromUtc(dt) };
  }

  return null;
}

