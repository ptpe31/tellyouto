import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  Path,
  Stop,
} from 'react-native-svg';

import { palette } from '../../theme';

type Props = {
  levelLine: string;
  growthLine: string;
  xpIntoLevel: number;
  xpForNext: number;
};

export function GrowthArcGraph({
  levelLine,
  growthLine,
  xpIntoLevel,
  xpForNext,
}: Props) {
  const { width: screenW } = useWindowDimensions();
  const arcW = Math.min(screenW * 0.92, 380);
  const arcH = arcW * 0.5;
  const R = arcW * 0.38;
  const CX = arcW / 2;
  const CY = arcH * 0.82;
  const sweep = Math.PI * 0.78;
  const start = Math.PI + (Math.PI - sweep) / 2;
  const t = xpForNext > 0 ? Math.min(1, xpIntoLevel / xpForNext) : 1;
  const end = start + sweep * t;
  const sx = CX + R * Math.cos(start);
  const sy = CY + R * Math.sin(start);
  const ex = CX + R * Math.cos(end);
  const ey = CY + R * Math.sin(end);
  const exFull = CX + R * Math.cos(start + sweep);
  const eyFull = CY + R * Math.sin(start + sweep);
  const largeArcFg = end - start > Math.PI ? 1 : 0;
  const dFg = `M ${sx} ${sy} A ${R} ${R} 0 ${largeArcFg} 1 ${ex} ${ey}`;
  const largeArcBg = sweep > Math.PI ? 1 : 0;
  const dBg = `M ${sx} ${sy} A ${R} ${R} 0 ${largeArcBg} 1 ${exFull} ${eyFull}`;

  return (
    <View style={styles.wrap}>
      <View style={styles.badgesRow}>
        <View style={[styles.badge, styles.badgeLevel]}>
          <Text style={styles.badgeLine} numberOfLines={2}>
            {levelLine}
          </Text>
        </View>
        <View style={[styles.badge, styles.badgeGrowth]}>
          <Text style={styles.badgeLineGrowth} numberOfLines={3}>
            {growthLine}
          </Text>
        </View>
      </View>
      <View style={[styles.svgBox, { width: arcW, height: arcH }]}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${arcW} ${arcH}`}>
          <Defs>
            <SvgLinearGradient id="arcFill" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor={palette.teal} stopOpacity={0.95} />
              <Stop offset="100%" stopColor={palette.orange} stopOpacity={0.9} />
            </SvgLinearGradient>
          </Defs>
          <Path
            d={dBg}
            stroke="rgba(45,111,112,0.18)"
            strokeWidth={10}
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d={dFg}
            stroke="url(#arcFill)"
            strokeWidth={10}
            fill="none"
            strokeLinecap="round"
          />
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', width: '100%' },
  badgesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '88%',
    maxWidth: 360,
    marginBottom: 2,
  },
  badge: {
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: '42%',
    flex: 1,
    maxWidth: '48%',
    borderWidth: 1,
    justifyContent: 'center',
  },
  badgeLevel: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderColor: 'rgba(45,111,112,0.2)',
    marginRight: 6,
  },
  badgeGrowth: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderColor: 'rgba(255,140,0,0.22)',
    marginLeft: 6,
  },
  badgeLine: {
    fontSize: 15,
    fontWeight: '800',
    color: palette.textOnLight,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  badgeLineGrowth: {
    fontSize: 12,
    fontWeight: '700',
    color: palette.textOnLight,
    textAlign: 'center',
    lineHeight: 16,
  },
  svgBox: { alignSelf: 'center' },
});
