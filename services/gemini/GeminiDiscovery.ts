import AsyncStorage from '@react-native-async-storage/async-storage';

type ApiVersion = 'v1' | 'v1beta';

type ListedModel = {
  name: string;
  supportedGenerationMethods?: string[];
  version?: string;
};

type Leader = {
  modelId: string;
  apiVersion: ApiVersion;
  chosenAtMs: number;
};

const STORAGE_KEY = 'tellyouto_gemini_discovery_v1';
const TTL_MS = 24 * 60 * 60 * 1000;

let leader: Leader | null = null;
let initPromise: Promise<void> | null = null;
let ban = new Set<string>();
let mode: 'normal' | 'bulk' = 'normal';

export function setGeminiDiscoveryMode(next: 'normal' | 'bulk'): void {
  mode = next;
}

export function getGeminiDiscoveryMode(): 'normal' | 'bulk' {
  return mode;
}

function shortId(name: string): string {
  return String(name || '').trim().replace(/^models\//, '');
}

function parseApiVersionRank(version: string | undefined): number {
  if (!version) return 0;
  const t = version.trim();
  if (!t) return 0;
  const n = Number.parseFloat(t.replace(/[^\d.+-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseSemverFromGeminiId(id: string): [number, number] | null {
  const m = id.match(/gemini-(\d+)\.(\d+)/i);
  if (!m) return null;
  const major = Number.parseInt(m[1], 10);
  const minor = Number.parseInt(m[2], 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
  return [major, minor];
}

function parseTrailingNumericSuffix(id: string): number {
  const m = id.match(/-(\d{3})(?:\b|[-_]|$)/);
  if (!m) return 0;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 0;
}

function comparePreferredFlashLite(a: ListedModel, b: ListedModel): number {
  const aId = shortId(a.name);
  const bId = shortId(b.name);
  const aLite = /lite/i.test(aId) ? 1 : 0;
  const bLite = /lite/i.test(bId) ? 1 : 0;
  if (aLite !== bLite) return bLite - aLite;
  const aFlash = /flash/i.test(aId) ? 1 : 0;
  const bFlash = /flash/i.test(bId) ? 1 : 0;
  if (aFlash !== bFlash) return bFlash - aFlash;
  const vRank = parseApiVersionRank(b.version) - parseApiVersionRank(a.version);
  if (vRank !== 0) return vRank;
  const sa = parseSemverFromGeminiId(aId);
  const sb = parseSemverFromGeminiId(bId);
  if (sa && sb) {
    if (sa[0] !== sb[0]) return sb[0] - sa[0];
    if (sa[1] !== sb[1]) return sb[1] - sa[1];
  } else if (sa && !sb) return -1;
  else if (!sa && sb) return 1;
  const ta = parseTrailingNumericSuffix(aId);
  const tb = parseTrailingNumericSuffix(bId);
  if (ta !== tb) return tb - ta;
  return bId.localeCompare(aId);
}

async function listModels(apiKey: string): Promise<ListedModel[]> {
  const key = apiKey.trim();
  if (!key) return [];
  const out: ListedModel[] = [];
  let pageToken: string | undefined;
  do {
    const u = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    u.searchParams.set('key', key);
    u.searchParams.set('pageSize', '100');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const res = await fetch(u.toString());
    const text = await res.text();
    if (!res.ok) return [];
    const data = JSON.parse(text) as { models?: ListedModel[]; nextPageToken?: string };
    out.push(...(data.models ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

function extractJsonBlock(raw: string): string | null {
  const t = String(raw || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const s0 = (fence?.[1]?.trim() || t).trim();
  const start = s0.indexOf('{');
  const end = s0.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return s0.slice(start, end + 1);
}

async function probeGenerateContent(params: {
  apiKey: string;
  modelId: string;
  apiVersion: ApiVersion;
}): Promise<boolean> {
  const url = new URL(
    `https://generativelanguage.googleapis.com/${params.apiVersion}/models/${params.modelId}:generateContent`,
  );
  url.searchParams.set('key', params.apiKey);
  const prompt = [
    'Return ONLY a JSON object.',
    'Keys: lang,t,c,timeSpec.',
    'lang must be an ISO-639-1 language code (e.g. "fr","en","es","de","ja").',
    'Also include logistics object: logistics.hasLogistics (boolean), logistics.destination (string|null), logistics.isLocationIncomplete (boolean).',
    'timeSpec.type is FIXED|RELATIVE|VAGUE|NONE.',
    'timeSpec.rawDay and timeSpec.rawTime are strings or null.',
    'timeSpec.value is only used for RELATIVE (minutes as string).',
    'c and t must be non-empty strings.',
    't must start with exactly one emoji followed by a space.',
    'No arithmetic: do NOT compute dates.',
    'Reference Time: Tuesday, April 21, 2026, 20:33 UTC.',
    'Rule: If a mentioned clock time is already passed relative to the reference time, treat it as next day unless user specifies otherwise.',
    'Text: "Acheter du pain à 18h"',
  ].join('\n');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2200);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Connection: 'keep-alive' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, topP: 0.1, topK: 1, candidateCount: 1, maxOutputTokens: 120 },
    }),
    signal: controller.signal,
  });
  clearTimeout(timeout);
  if (!res.ok) return false;
  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof raw !== 'string') return false;
  const block = extractJsonBlock(raw);
  if (!block) return false;
  try {
    const parsed = JSON.parse(block) as unknown;
    if (!parsed || typeof parsed !== 'object') return false;
    const p = parsed as {
      lang?: unknown;
      c?: unknown;
      t?: unknown;
      logistics?: unknown;
      timeSpec?: unknown;
    };
    if (typeof p.lang !== 'string' || !p.lang.trim()) return false;
    if (typeof p.c !== 'string' || !p.c.trim()) return false;
    if (typeof p.t !== 'string' || !p.t.trim()) return false;
    if (!p.logistics || typeof p.logistics !== 'object') return false;
    const l = p.logistics as { hasLogistics?: unknown; destination?: unknown; isLocationIncomplete?: unknown };
    if (typeof l.hasLogistics !== 'boolean') return false;
    if (!(typeof l.destination === 'string' || l.destination === null)) return false;
    if (typeof l.isLocationIncomplete !== 'boolean') return false;
    if (!p.timeSpec || typeof p.timeSpec !== 'object') return false;
    const ts = p.timeSpec as { type?: unknown; rawDay?: unknown; rawTime?: unknown; value?: unknown };
    if (ts.type !== 'FIXED' && ts.type !== 'RELATIVE' && ts.type !== 'VAGUE' && ts.type !== 'NONE') return false;
    if (!(typeof ts.rawDay === 'string' || ts.rawDay === null || typeof ts.rawDay === 'undefined')) return false;
    if (!(typeof ts.rawTime === 'string' || ts.rawTime === null || typeof ts.rawTime === 'undefined')) return false;
    if (ts.type === 'RELATIVE') {
      if (!(typeof ts.value === 'string' || typeof ts.value === 'number')) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function pickLeaderFromList(apiKey: string): Promise<Leader | null> {
  const models = await listModels(apiKey);
  const supported = models.filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'));
  const flashLite = supported.filter((m) => {
    const id = shortId(m.name);
    if (!/flash/i.test(id) || !/lite/i.test(id)) return false;
    if (/(preview|exp|experimental|image|vision|tts)/i.test(id)) return false;
    return true;
  });
  const sorted = [...flashLite].sort(comparePreferredFlashLite).slice(0, 8);
  for (const m of sorted) {
    const id = shortId(m.name);
    if (!id) continue;
    if (ban.has(id)) continue;
    let okV1 = false;
    let okV1b = false;
    try {
      okV1 = await probeGenerateContent({ apiKey, modelId: id, apiVersion: 'v1' });
    } catch {
      okV1 = false;
    }
    if (okV1) return { modelId: id, apiVersion: 'v1', chosenAtMs: Date.now() };
    try {
      okV1b = await probeGenerateContent({ apiKey, modelId: id, apiVersion: 'v1beta' });
    } catch {
      okV1b = false;
    }
    if (okV1b) return { modelId: id, apiVersion: 'v1beta', chosenAtMs: Date.now() };
    ban.add(id);
  }
  return null;
}

async function loadPersistedLeader(): Promise<Leader | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Leader>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.modelId !== 'string' || !parsed.modelId.trim()) return null;
    if (parsed.apiVersion !== 'v1' && parsed.apiVersion !== 'v1beta') return null;
    if (typeof parsed.chosenAtMs !== 'number' || !Number.isFinite(parsed.chosenAtMs)) return null;
    if (Date.now() - parsed.chosenAtMs > TTL_MS) return null;
    return { modelId: parsed.modelId.trim(), apiVersion: parsed.apiVersion, chosenAtMs: parsed.chosenAtMs };
  } catch {
    return null;
  }
}

async function persistLeader(next: Leader): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return;
  }
}

export async function ensureGeminiDiscoveryInitialized(apiKey: string): Promise<void> {
  if (leader && Date.now() - leader.chosenAtMs <= TTL_MS) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const persisted = await loadPersistedLeader();
    if (persisted) {
      leader = persisted;
      console.log(`[GeminiDiscovery] leader=${leader.modelId} api=${leader.apiVersion} source=cache`);
      return;
    }
    const picked = await pickLeaderFromList(apiKey);
    if (picked) {
      leader = picked;
      await persistLeader(picked);
      console.log(`[GeminiDiscovery] leader=${leader.modelId} api=${leader.apiVersion} source=listModels`);
    }
  })();
  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

export function getGeminiDiscoveredLeader(): { modelId: string; apiVersion: ApiVersion } | null {
  if (!leader) return null;
  if (Date.now() - leader.chosenAtMs > TTL_MS) return null;
  return { modelId: leader.modelId, apiVersion: leader.apiVersion };
}

export async function reportGeminiLeaderFailure(apiKey: string, modelId: string): Promise<void> {
  ban.add(modelId);
  if (mode === 'bulk') return;
  if (leader?.modelId === modelId) leader = null;
  await AsyncStorage.removeItem(STORAGE_KEY);
  await ensureGeminiDiscoveryInitialized(apiKey);
}
