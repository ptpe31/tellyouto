import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

const BAR_COUNT = 26;
const PALETTE = '#14b8a6';

type VoiceMeteringWaveformProps = {
  /** dBFS approx. (−160 silence … 0 max), depuis `RecordingStatus.metering`. */
  meteringDb: number;
  accessibilityLabel?: string;
};

/**
 * Ondes **légères** pilotées par le niveau micro (metering expo-av), pour montrer
 * que la capture est active pendant la dictée.
 */
export function VoiceMeteringWaveform({ meteringDb, accessibilityLabel }: VoiceMeteringWaveformProps) {
  const norm = useMemo(() => {
    const v = Number(meteringDb);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, (v + 58) / 52));
  }, [meteringDb]);

  return (
    <View
      style={styles.row}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const phase = (i / BAR_COUNT) * Math.PI * 2;
        const wave = 0.5 + 0.5 * Math.sin(phase + norm * 4.2);
        const height = 5 + norm * wave * 34;
        return (
          <View
            key={i}
            style={[
              styles.bar,
              {
                height,
                opacity: 0.35 + norm * 0.65,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    height: 46,
    gap: 3,
    paddingHorizontal: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  bar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: PALETTE,
  },
});
