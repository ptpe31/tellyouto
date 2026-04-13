import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, {
  Defs,
  Ellipse,
  G,
  LinearGradient as SvgLinearGradient,
  Path,
  Stop,
} from 'react-native-svg';

import type { BloomVisualState } from './types';

type Props = {
  state: BloomVisualState;
  /** Appui long : cycle des états (aperçu produit / QA). */
  onLongPressCycle?: () => void;
  accessibilityLabel?: string;
};

const W = 200;
const H = 148;

function BloomPlant() {
  return (
    <G>
      <Path
        d="M 100 118 L 98 78 L 102 78 Z"
        fill="#4a7c59"
        opacity={0.85}
      />
      <Path d="M 100 82 Q 88 58 82 44" stroke="#5a9268" strokeWidth={3} fill="none" strokeLinecap="round" />
      <Path d="M 100 80 Q 100 52 100 38" stroke="#5a9268" strokeWidth={3} fill="none" strokeLinecap="round" />
      <Path d="M 100 82 Q 112 56 118 42" stroke="#5a9268" strokeWidth={3} fill="none" strokeLinecap="round" />
      <Ellipse cx={82} cy={40} rx={5} ry={11} fill="#8b5cf6" opacity={0.92} transform="rotate(-8 82 40)" />
      <Ellipse cx={100} cy={34} rx={5} ry={13} fill="#a78bfa" opacity={0.95} />
      <Ellipse cx={118} cy={40} rx={5} ry={11} fill="#7c3aed" opacity={0.88} transform="rotate(8 118 40)" />
    </G>
  );
}

function WiltedPlant() {
  return (
    <G opacity={0.72}>
      <Path
        d="M 100 118 L 99 88 L 101 88 Z"
        fill="#6b7280"
      />
      <Path d="M 100 90 Q 86 78 80 72" stroke="#9ca3af" strokeWidth={2.5} fill="none" strokeLinecap="round" />
      <Path d="M 100 90 Q 100 74 98 66" stroke="#9ca3af" strokeWidth={2.5} fill="none" strokeLinecap="round" />
      <Path d="M 100 90 Q 114 78 120 72" stroke="#9ca3af" strokeWidth={2.5} fill="none" strokeLinecap="round" />
      <Path d="M 82 70 Q 88 76 84 82" stroke="#78716c" strokeWidth={2} fill="none" />
      <Path d="M 100 64 Q 102 72 96 78" stroke="#78716c" strokeWidth={2} fill="none" />
      <Path d="M 118 70 Q 112 76 116 82" stroke="#78716c" strokeWidth={2} fill="none" />
    </G>
  );
}

function SingleTaskMark() {
  return (
    <G>
      <Ellipse cx={100} cy={72} rx={28} ry={16} fill="url(#pebble)" opacity={0.92} />
      <Path
        d="M 72 96 Q 88 88 100 90 Q 112 88 128 96"
        stroke="rgba(45,111,112,0.35)"
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M 68 102 Q 84 96 100 98 Q 116 96 132 102"
        stroke="rgba(45,111,112,0.22)"
        strokeWidth={1.5}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M 64 108 Q 90 102 100 104 Q 110 102 136 108"
        stroke="rgba(45,111,112,0.16)"
        strokeWidth={1.2}
        fill="none"
        strokeLinecap="round"
      />
    </G>
  );
}

export function BloomStatusVisual({
  state,
  onLongPressCycle,
  accessibilityLabel,
}: Props) {
  const plant =
    state === 'bloom' ? (
      <BloomPlant />
    ) : state === 'wilted' ? (
      <WiltedPlant />
    ) : (
      <SingleTaskMark />
    );

  return (
    <Pressable
      onLongPress={onLongPressCycle}
      delayLongPress={480}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.shadow}>
        <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <Defs>
            <SvgLinearGradient id="pedestalStone" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor="#e8ebe4" />
              <Stop offset="40%" stopColor="#d4d9ce" />
              <Stop offset="100%" stopColor="#b8c4b0" />
            </SvgLinearGradient>
            <SvgLinearGradient id="pebble" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor="#eef1ea" />
              <Stop offset="100%" stopColor="#c5cfc0" />
            </SvgLinearGradient>
          </Defs>
          <Ellipse
            cx={100}
            cy={128}
            rx={62}
            ry={20}
            fill="rgba(60,70,55,0.14)"
          />
          <Ellipse cx={100} cy={122} rx={58} ry={18} fill="url(#pedestalStone)" />
          <Ellipse
            cx={100}
            cy={118}
            rx={54}
            ry={15}
            fill="rgba(255,255,255,0.22)"
          />
          {plant}
        </Svg>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowColor: '#3d4a3a',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
});
