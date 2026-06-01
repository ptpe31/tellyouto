import { ActionSheetIOS, Linking, Platform } from 'react-native';

import { clearAllDepartureNotifications } from '../services/NotificationService';
import { normalizeTripTransportMode, type TripTransportMode } from './tripTransportMode';

function buildGoogleMapsDirectionsUrlWithOrigin(params: {
  origin?: string | null;
  destination: string;
  mode: TripTransportMode;
}): string {
  const travelmode =
    params.mode === 'walking' ? 'walking' : params.mode === 'bike' ? 'bicycling' : 'driving';
  const base = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(params.destination)}&travelmode=${travelmode}`;
  const origin = String(params.origin ?? '').trim();
  if (!origin) return base;
  return `${base}&origin=${encodeURIComponent(origin)}`;
}

function buildGeoUrl(destination: string): string {
  return `geo:0,0?q=${encodeURIComponent(destination)}`;
}

function buildAppleMapsUrl(params: {
  origin?: string | null;
  destination: string;
  mode: TripTransportMode;
}): string {
  const dirflg = params.mode === 'walking' ? 'w' : 'd';
  const dest = encodeURIComponent(params.destination);
  const origin = String(params.origin ?? '').trim();
  const base = `maps://?daddr=${dest}&dirflg=${dirflg}`;
  if (!origin) return base;
  return `${base}&saddr=${encodeURIComponent(origin)}`;
}

function buildGoogleMapsUrlNative(params: {
  origin?: string | null;
  destination: string;
  mode: TripTransportMode;
}): string {
  const destination = encodeURIComponent(params.destination);
  const origin = String(params.origin ?? '').trim();
  if (Platform.OS === 'android') {
    const mode = params.mode === 'walking' ? 'w' : params.mode === 'bike' ? 'b' : 'd';
    return `google.navigation:q=${destination}&mode=${mode}`;
  }
  const directionsmode =
    params.mode === 'walking' ? 'walking' : params.mode === 'bike' ? 'bicycling' : 'driving';
  const base = `comgooglemaps://?daddr=${destination}&directionsmode=${encodeURIComponent(directionsmode)}`;
  if (!origin) return base;
  return `${base}&saddr=${encodeURIComponent(origin)}`;
}

function buildWazeUrl(destination: string): string {
  return `waze://?q=${encodeURIComponent(destination)}&navigate=yes`;
}

export async function openTripNavigationUniversal(params: {
  origin?: string | null;
  destination: string;
  mode: TripTransportMode;
  /** Id intention / tâche Sentinel — annule les signaux de départ planifiés. */
  intentionId?: string;
}): Promise<void> {
  const destination = String(params.destination ?? '').trim();
  if (!destination) return;
  if (params.intentionId) {
    await clearAllDepartureNotifications(params.intentionId);
  }
  const origin = String(params.origin ?? '').trim() || null;

  if (Platform.OS === 'android') {
    const googleUrl = buildGoogleMapsUrlNative({ origin, destination, mode: params.mode });
    const wazeUrl = buildWazeUrl(destination);
    const canGoogle = await Linking.canOpenURL(googleUrl);
    const canWaze = await Linking.canOpenURL(wazeUrl);
    if (canGoogle && !canWaze) {
      await Linking.openURL(googleUrl);
      return;
    }
    if (canWaze && !canGoogle) {
      await Linking.openURL(wazeUrl);
      return;
    }
    await Linking.openURL(buildGeoUrl(destination));
    return;
  }

  if (Platform.OS === 'ios') {
    const apple = { key: 'apple', label: 'Apple Maps', url: buildAppleMapsUrl({ origin, destination, mode: params.mode }) };
    const google = {
      key: 'google',
      label: 'Google Maps',
      url: buildGoogleMapsUrlNative({ origin, destination, mode: params.mode }),
    };
    const waze = { key: 'waze', label: 'Waze', url: buildWazeUrl(destination) };
    const providers = [apple] as Array<{ key: string; label: string; url: string }>;
    if (await Linking.canOpenURL(google.url)) providers.push(google);
    if (await Linking.canOpenURL(waze.url)) providers.push(waze);
    if (providers.length === 1) {
      await Linking.openURL(providers[0].url);
      return;
    }
    await new Promise<void>((resolve) => {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...providers.map((p) => p.label), 'Annuler'],
          cancelButtonIndex: providers.length,
          title: destination,
        },
        (buttonIndex) => {
          const picked = typeof buttonIndex === 'number' ? providers[buttonIndex] : undefined;
          if (!picked) {
            resolve();
            return;
          }
          void Linking.openURL(picked.url).finally(resolve);
        },
      );
    });
    return;
  }

  await Linking.openURL(buildGoogleMapsDirectionsUrlWithOrigin({ origin, destination, mode: params.mode }));
}

export async function openTripNavigationFromRecords(input: {
  trip: Record<string, unknown> | null;
  destination: string;
  transportMode?: string | null;
  intentionId?: string;
}): Promise<void> {
  const destination = String(input.destination ?? '').trim();
  if (!destination) return;
  if (input.intentionId) {
    await clearAllDepartureNotifications(input.intentionId);
  }
  const trip = input.trip ?? {};
  const origin = String(trip.origin_address ?? '').trim() || null;
  const mode = normalizeTripTransportMode(
    String(trip.transportMode ?? input.transportMode ?? 'auto'),
  );
  await openTripNavigationUniversal({ origin, destination, mode, intentionId: input.intentionId });
}

/** Action primaire carte trajet — ouvre la navigation vers la destination. */
export async function launchNavigation(input: {
  trip: Record<string, unknown> | null;
  destination: string;
  transportMode?: string | null;
  intentionId?: string;
}): Promise<void> {
  await openTripNavigationFromRecords(input);
}
