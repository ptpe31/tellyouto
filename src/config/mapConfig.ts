/** Fournisseur de recherche d'adresses (autocomplete + géocodage manuel). */
export const MAP_PROVIDER = 'mapbox' as const;

export type MapProvider = 'mapbox' | 'google';

/** Seuil anti-bruit — aucun appel distant en dessous. */
export const MAP_SEARCH_MIN_CHARS = 12;

/** @deprecated Alias rétrocompat — préférer MAP_SEARCH_MIN_CHARS. */
export const LAZY_FETCH_SEARCH_MIN_CHARS = MAP_SEARCH_MIN_CHARS;

/** Nouvelle session Mapbox après inactivité (facturation par session). */
export const MAPBOX_SESSION_IDLE_MS = 5 * 60 * 1000;

export function getMapSearchApiKey(provider: MapProvider = MAP_PROVIDER): string {
  if (provider === 'mapbox') {
    return String(process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '').trim();
  }
  return String(process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '').trim();
}

export function isMapSearchConfigured(provider: MapProvider = MAP_PROVIDER): boolean {
  return getMapSearchApiKey(provider).length > 0;
}
