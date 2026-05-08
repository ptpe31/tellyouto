type CachedPosition = {
  lat: number;
  lng: number;
  capturedAtMs: number;
};

let lastPosition: CachedPosition | null = null;

export async function getForegroundOriginSnapshot(params?: {
  maxAgeMs?: number;
}): Promise<CachedPosition> {
  const nowMs = Date.now();
  const maxAgeMs = Math.max(0, Math.round(params?.maxAgeMs ?? 60_000));
  if (lastPosition && nowMs - lastPosition.capturedAtMs <= maxAgeMs) return lastPosition;

  const Location = await import('expo-location');
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== Location.PermissionStatus.GRANTED) {
    throw new Error('Location permission denied');
  }

  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
    mayShowUserSettingsDialog: true,
  });
  const lat = Number(pos.coords.latitude);
  const lng = Number(pos.coords.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Location unavailable');
  }
  lastPosition = { lat, lng, capturedAtMs: nowMs };
  return lastPosition;
}
