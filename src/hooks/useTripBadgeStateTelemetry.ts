import { useEffect, useRef } from 'react';

import type { TripTimelineFooter } from '../utils/tripTimelineCard';

/**
 * Télémétrie temporaire des transitions badge TRIP Timeline.
 *
 * Tag de retrait : `TRIP_BADGE_STATE_TELEMETRY`
 * (supprimer ce fichier + l'appel dans IntentionCard.tsx)
 */
export const TRIP_BADGE_STATE_TELEMETRY = true;

const LOG_PREFIX = '[TRIP-BADGE-STATE]';
const PROBE1_SLOW_GRACE_MS = 10_000;

type TripBadgeKind = TripTimelineFooter['kind'] | 'none';

export function useTripBadgeStateTelemetry(input: {
  enabled: boolean;
  intentionId: string;
  tripAlias: string;
  footer: TripTimelineFooter | null;
  nextProbeAtMs: number | null;
  /** Horloge locale (tick 30 s) pour détecter les lenteurs PROBE1 sans spam. */
  nowMs: number;
}): void {
  const prevKindRef = useRef<TripBadgeKind | null>(null);
  const scanScheduledEnteredAtRef = useRef<number | null>(null);
  const slowProbeAlertLoggedRef = useRef(false);

  const footerKind: TripBadgeKind = input.footer?.kind ?? 'none';

  useEffect(() => {
    if (!TRIP_BADGE_STATE_TELEMETRY || !input.enabled) return;

    const prevKind = prevKindRef.current;
    const newKind = footerKind;

    if (prevKind === null) {
      prevKindRef.current = newKind;
      if (newKind === 'scanScheduled') {
        scanScheduledEnteredAtRef.current = Date.now();
        slowProbeAlertLoggedRef.current = false;
      }
      return;
    }

    if (prevKind === newKind) {
      if (
        newKind === 'scanScheduled' &&
        input.nextProbeAtMs != null &&
        input.nowMs > input.nextProbeAtMs + PROBE1_SLOW_GRACE_MS &&
        !slowProbeAlertLoggedRef.current
      ) {
        slowProbeAlertLoggedRef.current = true;
        console.warn(
          `${LOG_PREFIX} ⚠️ Lenteur anormale : Le badge attend PROBE1 depuis plus de 10s. | ID: ${input.intentionId}`,
        );
      }
      return;
    }

    console.log(`${LOG_PREFIX} 🔄 ID: ${input.intentionId} | State: ${prevKind} -> ${newKind}`);

    if (prevKind === 'scanScheduled' && newKind === 'elasticDeparture') {
      const enteredAt = scanScheduledEnteredAtRef.current;
      if (enteredAt != null) {
        const delta_ms = Date.now() - enteredAt;
        console.log(
          `${LOG_PREFIX} ⏱️ PROBE1 Résolu en ${delta_ms}ms pour l'intention ${input.tripAlias}`,
        );
      }
    }

    if (newKind === 'scanScheduled') {
      scanScheduledEnteredAtRef.current = Date.now();
      slowProbeAlertLoggedRef.current = false;
    } else {
      scanScheduledEnteredAtRef.current = null;
      slowProbeAlertLoggedRef.current = false;
    }

    prevKindRef.current = newKind;
  }, [
    footerKind,
    input.enabled,
    input.intentionId,
    input.nextProbeAtMs,
    input.nowMs,
    input.tripAlias,
  ]);
}
