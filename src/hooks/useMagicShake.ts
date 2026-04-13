import * as Haptics from 'expo-haptics';
import { Accelerometer } from 'expo-sensors';
import { useEffect, useRef, type MutableRefObject } from 'react';
import type { SharedValue } from 'react-native-reanimated';

const MAG_THRESHOLD = 15.8;
const SUSTAINED_WINDOW_MS = 650;
const SUSTAINED_HITS = 6;

type Options = {
  enabled: boolean;
  intensitySV: SharedValue<number>;
  /** Si false, le callback n’est pas déclenché (ex. tri en cours). */
  gateOpenRef: MutableRefObject<boolean>;
  onSustainedShake: () => void;
};

/**
 * Accéléromètre + intensité 0–1 pour l’agitation visuelle ; retour haptique type selection en boucle pendant le secouement.
 */
export function useMagicShake({
  enabled,
  intensitySV,
  gateOpenRef,
  onSustainedShake,
}: Options): void {
  const hitsRef = useRef<number[]>([]);
  const shakingRef = useRef(false);
  const onShakeRef = useRef(onSustainedShake);
  onShakeRef.current = onSustainedShake;

  useEffect(() => {
    if (!enabled) {
      intensitySV.value = 0;
      shakingRef.current = false;
      return;
    }

    Accelerometer.setUpdateInterval(85);

    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const mag = Math.hypot(x, y, z);
      const excess = Math.max(0, mag - 9.6);
      intensitySV.value = Math.min(1, excess / 9);

      const shaking = mag > MAG_THRESHOLD;
      if (shaking !== shakingRef.current) {
        shakingRef.current = shaking;
      }

      const now = Date.now();
      if (shaking) {
        hitsRef.current.push(now);
        hitsRef.current = hitsRef.current.filter(
          (t) => now - t < SUSTAINED_WINDOW_MS,
        );
        if (hitsRef.current.length >= SUSTAINED_HITS) {
          hitsRef.current = [];
          if (gateOpenRef.current) {
            onShakeRef.current();
          }
        }
      }
    });

    const hapticTick = setInterval(() => {
      if (shakingRef.current) {
        void Haptics.selectionAsync();
      }
    }, 155);

    return () => {
      sub.remove();
      clearInterval(hapticTick);
      intensitySV.value = 0;
      shakingRef.current = false;
    };
  }, [enabled, gateOpenRef, intensitySV]);
}

export { SUSTAINED_HITS, MAG_THRESHOLD };
