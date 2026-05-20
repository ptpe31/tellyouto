import { useEffect, useState } from 'react';

const DEFAULT_INTERVAL_MS = 30_000;

/**
 * Horloge locale pour rafraîchir le badge scan (passage futur → « Scan en cours… »).
 * Nettoyage garanti au démontage ou quand active=false.
 */
export function useProbeScheduleClock(active: boolean, intervalMs: number = DEFAULT_INTERVAL_MS): number {
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);

  return tick;
}
