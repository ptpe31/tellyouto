import { MAP_PROVIDER, type MapProvider, getMapSearchApiKey } from '../config/mapConfig';
import { AddressResolver } from './addressResolver';
import type { AddressSelection } from './addressResolver';

export type MapSearchPrediction = {
  placeId: string;
  description: string;
  source: 'mapbox' | 'google';
};

export type MapSearchErrorKind = 'network' | 'missing_key' | 'api_error' | 'no_results';

export class MapSearchError extends Error {
  readonly kind: MapSearchErrorKind;

  constructor(kind: MapSearchErrorKind, message: string) {
    super(message);
    this.name = 'MapSearchError';
    this.kind = kind;
  }
}

function normalizeLanguage(language?: string): string {
  const l = String(language ?? '').trim();
  return l || 'fr';
}

function getAccessToken(): string {
  const token = getMapSearchApiKey('mapbox');
  if (!token) throw new MapSearchError('missing_key', 'MapSearch: missing Mapbox access token');
  return token;
}

async function safeFetch(url: string): Promise<Response> {
  try {
    return await fetch(url);
  } catch {
    throw new MapSearchError('network', 'MapSearch: network unavailable');
  }
}

type MapboxSuggestSuggestion = {
  mapbox_id?: string;
  name?: string;
  full_address?: string;
  place_formatted?: string;
  address?: string;
};

function formatMapboxDescription(s: MapboxSuggestSuggestion): string {
  const full = String(s.full_address ?? '').trim();
  if (full) return full;
  const name = String(s.name ?? '').trim();
  const place = String(s.place_formatted ?? '').trim();
  if (name && place) return `${name}, ${place}`;
  return name || place || '';
}

export async function mapboxSearch(
  query: string,
  opts: { language?: string; sessionToken: string; limit?: number },
): Promise<MapSearchPrediction[]> {
  const q = String(query ?? '').trim();
  if (!q) return [];

  const token = getAccessToken();
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 10);
  const language = normalizeLanguage(opts.language);

  console.log(`[API-CALL] 💸 MAPBOX SUGGEST | Input: "${q}"`);

  const url =
    `https://api.mapbox.com/search/searchbox/v1/suggest?q=` +
    encodeURIComponent(q) +
    `&access_token=` +
    encodeURIComponent(token) +
    `&session_token=` +
    encodeURIComponent(opts.sessionToken) +
    `&language=` +
    encodeURIComponent(language) +
    `&limit=` +
    encodeURIComponent(String(limit));

  const res = await safeFetch(url);
  let json: { suggestions?: MapboxSuggestSuggestion[]; message?: string };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new MapSearchError('api_error', 'MapSearch: invalid suggest response');
  }

  if (!res.ok) {
    throw new MapSearchError('api_error', `MapSearch: suggest http ${res.status}`);
  }

  const rows = Array.isArray(json.suggestions) ? json.suggestions : [];
  return rows
    .map((s) => {
      const placeId = String(s.mapbox_id ?? '').trim();
      const description = formatMapboxDescription(s);
      return { placeId, description, source: 'mapbox' as const };
    })
    .filter((p) => p.placeId && p.description);
}

export async function mapboxRetrieve(
  mapboxId: string,
  sessionToken: string,
  language?: string,
): Promise<AddressSelection> {
  const id = String(mapboxId ?? '').trim();
  if (!id) throw new MapSearchError('api_error', 'MapSearch: empty mapbox id');

  const token = getAccessToken();
  const lang = normalizeLanguage(language);

  console.log(`[API-CALL] 💸 MAPBOX RETRIEVE | mapbox_id: ${id}`);

  const url =
    `https://api.mapbox.com/search/searchbox/v1/retrieve/` +
    encodeURIComponent(id) +
    `?access_token=` +
    encodeURIComponent(token) +
    `&session_token=` +
    encodeURIComponent(sessionToken) +
    `&language=` +
    encodeURIComponent(lang);

  const res = await safeFetch(url);
  let json: {
    features?: Array<{
      properties?: {
        mapbox_id?: string;
        name?: string;
        full_address?: string;
        place_formatted?: string;
      };
      geometry?: { coordinates?: [number, number] };
    }>;
  };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new MapSearchError('api_error', 'MapSearch: invalid retrieve response');
  }

  if (!res.ok) {
    throw new MapSearchError('api_error', `MapSearch: retrieve http ${res.status}`);
  }

  const feature = json.features?.[0];
  const props = feature?.properties;
  const coords = feature?.geometry?.coordinates;
  const lng = Number(coords?.[0]);
  const lat = Number(coords?.[1]);
  const formattedAddress =
    String(props?.full_address ?? '').trim() ||
    [String(props?.name ?? '').trim(), String(props?.place_formatted ?? '').trim()]
      .filter(Boolean)
      .join(', ');

  if (!formattedAddress || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new MapSearchError('no_results', 'MapSearch: invalid retrieve result');
  }

  return {
    placeId: String(props?.mapbox_id ?? id),
    formattedAddress,
    lat,
    lng,
  };
}

export async function mapboxForward(query: string, language?: string): Promise<AddressSelection> {
  const q = String(query ?? '').trim();
  if (!q) throw new MapSearchError('api_error', 'MapSearch: empty forward query');

  const token = getAccessToken();
  const lang = normalizeLanguage(language);

  console.log(`[API-CALL] 💸 MAPBOX FORWARD | Input: "${q}"`);

  const url =
    `https://api.mapbox.com/search/searchbox/v1/forward?q=` +
    encodeURIComponent(q) +
    `&access_token=` +
    encodeURIComponent(token) +
    `&language=` +
    encodeURIComponent(lang) +
    `&limit=1`;

  const res = await safeFetch(url);
  let json: {
    features?: Array<{
      properties?: {
        mapbox_id?: string;
        name?: string;
        full_address?: string;
        place_formatted?: string;
      };
      geometry?: { coordinates?: [number, number] };
    }>;
  };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new MapSearchError('api_error', 'MapSearch: invalid forward response');
  }

  if (!res.ok) {
    throw new MapSearchError('api_error', `MapSearch: forward http ${res.status}`);
  }

  const feature = json.features?.[0];
  const props = feature?.properties;
  const coords = feature?.geometry?.coordinates;
  const lng = Number(coords?.[0]);
  const lat = Number(coords?.[1]);
  const formattedAddress =
    String(props?.full_address ?? '').trim() ||
    [String(props?.name ?? '').trim(), String(props?.place_formatted ?? '').trim()]
      .filter(Boolean)
      .join(', ');

  if (!formattedAddress || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new MapSearchError('no_results', 'MapSearch: no forward result');
  }

  return {
    placeId: String(props?.mapbox_id ?? `mapbox:${lat},${lng}`),
    formattedAddress,
    lat,
    lng,
  };
}

export async function searchPlaces(
  query: string,
  opts: { language?: string; sessionToken: string; limit?: number },
  provider: MapProvider = MAP_PROVIDER,
): Promise<MapSearchPrediction[]> {
  if (provider === 'google') {
    const apiKey = getMapSearchApiKey('google');
    if (!apiKey) throw new MapSearchError('missing_key', 'MapSearch: missing Google Places key');
    try {
      const rows = await AddressResolver.fetchAutocompletePredictions(
        query,
        opts.sessionToken,
        opts.language,
      );
      return rows.map((r) => ({ ...r, source: 'google' as const }));
    } catch (err) {
      if (err instanceof MapSearchError) throw err;
      throw new MapSearchError('api_error', 'MapSearch: Google autocomplete failed');
    }
  }
  return mapboxSearch(query, opts);
}

export async function resolvePlaceFromPrediction(
  prediction: MapSearchPrediction,
  opts: { language?: string; sessionToken: string },
  provider: MapProvider = MAP_PROVIDER,
): Promise<AddressSelection> {
  if (provider === 'google') {
    return AddressResolver.resolveFromPlaceId(prediction.placeId, opts.language);
  }
  return mapboxRetrieve(prediction.placeId, opts.sessionToken, opts.language);
}

export async function resolveManualPlace(
  query: string,
  language?: string,
  provider: MapProvider = MAP_PROVIDER,
): Promise<AddressSelection> {
  if (provider === 'google') {
    return AddressResolver.resolveManual(query, language);
  }
  return mapboxForward(query, language);
}
