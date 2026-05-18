/** Modes de transport TRIP supportés (transit / bus retiré — horaires TC non gérés). */
export type TripTransportMode = 'auto' | 'walking' | 'bike';

export function normalizeTripTransportMode(raw: string | null | undefined): TripTransportMode {
  const m = String(raw ?? '').trim().toLowerCase();
  if (m === 'walking' || m === 'walk') return 'walking';
  if (m === 'bike' || m === 'bicycle' || m === 'bicycling') return 'bike';
  return 'auto';
}

export function isLegacyTransitTransportMode(raw: string | null | undefined): boolean {
  const m = String(raw ?? '').trim().toLowerCase();
  return m === 'transit' || m === 'train';
}
