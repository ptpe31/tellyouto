export type AddressSelection = {
  placeId: string;
  formattedAddress: string;
  lat: number;
  lng: number;
};

/** @deprecated Alias rétrocompat — préférer AddressSelection. */
export type GooglePlaceSelection = AddressSelection;

function getMapsApiKey(): string {
  return String(process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '').trim();
}

function normalizeLanguage(language?: string): string {
  const l = String(language ?? '').trim();
  return l || 'fr';
}

export class AddressResolver {
  static async resolveManual(text: string, language?: string): Promise<AddressSelection> {
    const query = String(text ?? '').trim();
    if (!query) throw new Error('AddressResolver: empty query');

    const apiKey = getMapsApiKey();
    if (!apiKey) throw new Error('AddressResolver: missing api key');

    console.log(`[API-CALL] 💸 GOOGLE GEOCODING | Input: "${query}"`);

    const url =
      `https://maps.googleapis.com/maps/api/geocode/json?address=` +
      encodeURIComponent(query) +
      `&key=` +
      encodeURIComponent(apiKey) +
      `&language=` +
      encodeURIComponent(normalizeLanguage(language));

    const res = await fetch(url);
    const json = (await res.json()) as {
      status?: string;
      results?: Array<{
        formatted_address?: string;
        place_id?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }>;
    };

    if (!res.ok) throw new Error(`AddressResolver: http ${res.status}`);
    if (json.status && json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
      throw new Error(`AddressResolver: geocode ${json.status}`);
    }

    const first = json.results?.[0];
    const formattedAddress = String(first?.formatted_address ?? '').trim();
    const lat = Number(first?.geometry?.location?.lat);
    const lng = Number(first?.geometry?.location?.lng);
    const placeId = String(first?.place_id ?? '').trim();

    if (!formattedAddress || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error('AddressResolver: no geocode result');
    }

    return { placeId: placeId || `geocode:${lat},${lng}`, formattedAddress, lat, lng };
  }

  static async resolveFromPlaceId(placeId: string, language?: string): Promise<AddressSelection> {
    const id = String(placeId ?? '').trim();
    if (!id) throw new Error('AddressResolver: empty placeId');

    const apiKey = getMapsApiKey();
    if (!apiKey) throw new Error('AddressResolver: missing api key');

    console.log(`[API-CALL] 💸 GOOGLE PLACES DETAILS | Requesting PlaceID: ${id}`);

    const url =
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=` +
      encodeURIComponent(id) +
      `&fields=` +
      encodeURIComponent('formatted_address,geometry') +
      `&key=` +
      encodeURIComponent(apiKey) +
      `&language=` +
      encodeURIComponent(normalizeLanguage(language));

    const res = await fetch(url);
    const json = (await res.json()) as {
      result?: {
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      };
    };

    if (!res.ok) throw new Error(`AddressResolver: http ${res.status}`);

    const formattedAddress = String(json.result?.formatted_address ?? '').trim();
    const lat = Number(json.result?.geometry?.location?.lat);
    const lng = Number(json.result?.geometry?.location?.lng);

    if (!formattedAddress || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error('AddressResolver: invalid place details');
    }

    return { placeId: id, formattedAddress, lat, lng };
  }
}
