import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  Path,
  Stop,
} from 'react-native-svg';

type Props = {
  /** 0–1 (ex. 780/1000). */
  progress: number;
  levelLabel: string;
  growthXpLabel: string;
};

const W = 248;
const H = 118;
const CX = W / 2;
const CY = 102;
const R = 78;

/** Arc supérieur : gauche → droite, courbure vers le haut. */
const ARC_D = `M ${CX - R} ${CY} A ${R} ${R} 0 0 0 ${CX + R} ${CY}`;

export function GrowthArcGraph({
  progress,
  levelLabel,
  growthXpLabel,
}: Props) {
  const p = Math.min(1, Math.max(0, progress));
  const arcLen = Math.PI * R;
  const dashOffset = arcLen * (1 - p);

  const beadAngle = useMemo(() => Math.PI - p * Math.PI, [p]);
  const beadX = CX + R * Math.cos(beadAngle);
  const beadY = CY - R * Math.sin(beadAngle);

  return (
    <View style={styles.wrap} accessibilityRole="summary">
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <SvgLinearGradient id="zenArcGlow" x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
            <Stop offset="45%" stopColor="rgba(255,255,255,0.95)" />
            <Stop offset="100%" stopColor="rgba(200,230,220,0.55)" />
          </SvgLinearGradient>
          <SvgLinearGradient id="zenArcTrack" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="rgba(255,255,255,0.5)" />
            <Stop offset="100%" stopColor="rgba(120,150,140,0.25)" />
          </SvgLinearGradient>
        </Defs>
        <Path
          d={ARC_D}
          stroke="url(#zenArcTrack)"
          strokeWidth={5}
          strokeLinecap="round"
          fill="none"
        />
        <Path
          d={ARC_D}
          stroke="url(#zenArcGlow)"
          strokeWidth={4}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${arcLen}`}
          strokeDashoffset={dashOffset}
        />
        <Circle
          cx={beadX}
          cy={beadY}
          r={7}
          fill="rgba(255,255,255,0.95)"
          opacity={0.95}
        />
        <Circle
          cx={beadX}
          cy={beadY}
          r={11}
          fill="none"
          stroke="rgba(255,255,255,0.45)"
          strokeWidth={2}
        />
      </Svg>
      <View style={styles.badges}>
        <View style={styles.levelPill}>
          <Text style={styles.levelText}>{levelLabel}</Text>
        </View>
        <View style={styles.xpPill}>
          <Text style={styles.xpText}>{growthXpLabel}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  badges: {
    marginTop: -4,
    alignItems: 'center',
    gap: 6,
  },
  levelPill: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.52)',
    borderWidth: 1,
    borderColor: 'rgba(45, 111, 112, 0.12)',
  },
  levelText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#2e5f68',
  },
  xpPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(245, 248, 246, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(0, 128, 128, 0.15)',
  },
  xpText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#3d5c55',
  },
});
