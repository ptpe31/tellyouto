import React from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
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
  flowerType?: string;
  onLongPressCycle?: () => void;
  accessibilityLabel?: string;
};

/** ViewBox — espace vertical étendu (y négatif) pour la plante ×2 sans rognage. */
const VB_W = 200;
const VB_MIN_Y = -52;
const VB_H = 278;

function bloomColors(flowerType?: string): { left: string; center: string; right: string } {
  if (flowerType === 'tulipe') {
    return { left: '#ef4444', center: '#f97316', right: '#dc2626' };
  }
  if (flowerType === 'tournesol') {
    return { left: '#f59e0b', center: '#facc15', right: '#d97706' };
  }
  if (flowerType === 'chrysanthème') {
    return { left: '#ec4899', center: '#f472b6', right: '#db2777' };
  }
  return { left: '#8b5cf6', center: '#a78bfa', right: '#7c3aed' };
}

function BloomPlant({ flowerType }: { flowerType?: string }) {
  const colors = bloomColors(flowerType);
  return (
    <G>
      <Path
        d="M 100 118 L 98 78 L 102 78 Z"
        fill="#4a7c59"
        opacity={0.85}
      />
      <Path
        d="M 100 82 Q 88 58 82 44"
        stroke="#5a9268"
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M 100 80 Q 100 52 100 38"
        stroke="#5a9268"
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M 100 82 Q 112 56 118 42"
        stroke="#5a9268"
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
      />
      <Ellipse
        cx={82}
        cy={40}
        rx={5}
        ry={11}
        fill={colors.left}
        opacity={0.92}
        transform="rotate(-8 82 40)"
      />
      <Ellipse cx={100} cy={34} rx={5} ry={13} fill={colors.center} opacity={0.95} />
      <Ellipse
        cx={118}
        cy={40}
        rx={5}
        ry={11}
        fill={colors.right}
        opacity={0.88}
        transform="rotate(8 118 40)"
      />
    </G>
  );
}

function WiltedPlant() {
  return (
    <G opacity={0.72}>
      <Path d="M 100 118 L 99 88 L 101 88 Z" fill="#6b7280" />
      <Path
        d="M 100 90 Q 86 78 80 72"
        stroke="#9ca3af"
        strokeWidth={2.5}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M 100 90 Q 100 74 98 66"
        stroke="#9ca3af"
        strokeWidth={2.5}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M 100 90 Q 114 78 120 72"
        stroke="#9ca3af"
        strokeWidth={2.5}
        fill="none"
        strokeLinecap="round"
      />
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
  flowerType,
  onLongPressCycle,
  accessibilityLabel,
}: Props) {
  const { width: screenW } = useWindowDimensions();
  /** ~40 % de l’écran — plafonner sur très grands écrans pour garder une composition. */
  const svgDisplayWidth = Math.min(screenW * 0.4, 200);
  const svgDisplayHeight = svgDisplayWidth * (VB_H / VB_W);
  const viewBoxStr = `0 ${VB_MIN_Y} ${VB_W} ${VB_H}`;

  const plant =
    state === 'bloom' ? (
      <BloomPlant flowerType={flowerType} />
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
      style={styles.press}
    >
      <View
        style={[
          styles.shadow,
          {
            width: svgDisplayWidth,
            height: svgDisplayHeight,
          },
        ]}
      >
        <Svg
          width="100%"
          height="100%"
          viewBox={viewBoxStr}
          preserveAspectRatio="xMidYMid meet"
        >
          <Defs>
            <SvgLinearGradient
              id="pedestalStone"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="100%"
            >
              <Stop offset="0%" stopColor="#eceee8" />
              <Stop offset="35%" stopColor="#d8ded0" />
              <Stop offset="72%" stopColor="#c0cbb8" />
              <Stop offset="100%" stopColor="#9daa94" />
            </SvgLinearGradient>
            <SvgLinearGradient id="pebble" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor="#eef1ea" />
              <Stop offset="100%" stopColor="#c5cfc0" />
            </SvgLinearGradient>
          </Defs>
          {/* Ombre au sol — ancrage */}
          <Ellipse
            cx={100}
            cy={204}
            rx={84}
            ry={26}
            fill="rgba(35,45,38,0.22)"
          />
          {/* Corps du socle — plus haut (perspective) */}
          <Ellipse cx={100} cy={182} rx={80} ry={34} fill="url(#pedestalStone)" />
          <Ellipse
            cx={100}
            cy={172}
            rx={74}
            ry={22}
            fill="rgba(255,255,255,0.2)"
          />
          <Ellipse
            cx={100}
            cy={158}
            rx={68}
            ry={18}
            fill="rgba(255,255,255,0.14)"
          />
          {/* Plante — ~x2 visuel autour du pied */}
          <G transform="translate(100, 122) scale(2) translate(-100, -122)">
            {plant}
          </G>
        </Svg>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  press: { alignItems: 'center' },
  shadow: {
    alignSelf: 'center',
    shadowColor: '#1a2418',
    shadowOpacity: 0.38,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    elevation: 18,
  },
});
