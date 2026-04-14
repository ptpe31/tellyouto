import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Ellipse, G, LinearGradient, Path, Stop } from 'react-native-svg';
import { STRINGS } from '../constants/Strings';

type Props = {
  growthStage: number;
  pulseKey?: number;
  size?: number;
  flowerGlyph?: string;
  nightMode?: boolean;
};

function clampGrowth(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function growthPhase(score: number): 'germ' | 'stem' | 'bud' | 'bloom' {
  if (score <= 25) return 'germ';
  if (score <= 50) return 'stem';
  if (score <= 75) return 'bud';
  return 'bloom';
}

export function LifeFlower({
  growthStage,
  pulseKey = 0,
  size = 118,
  flowerGlyph,
  nightMode = false,
}: Props) {
  const score = clampGrowth(growthStage);
  const phase = growthPhase(score);
  const baseScale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  const leafJitter = useRef(new Animated.Value(0)).current;
  const withered = useMemo(() => score <= 5, [score]);

  useEffect(() => {
    Animated.parallel([
      Animated.sequence([
        Animated.timing(baseScale, { toValue: 1.08, duration: 180, useNativeDriver: true }),
        Animated.timing(baseScale, { toValue: 1, duration: 260, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(glow, { toValue: 0.95, duration: 160, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 380, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(leafJitter, { toValue: 1, duration: 85, useNativeDriver: true }),
        Animated.timing(leafJitter, { toValue: -1, duration: 85, useNativeDriver: true }),
        Animated.timing(leafJitter, { toValue: 0, duration: 140, useNativeDriver: true }),
      ]),
    ]).start();
  }, [pulseKey, baseScale, glow, leafJitter]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sway, { toValue: 1, duration: 2200, useNativeDriver: true }),
        Animated.timing(sway, { toValue: -1, duration: 2200, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sway]);

  const petals =
    phase === 'germ' ? 0 : phase === 'stem' ? 2 : phase === 'bud' ? 5 : 8;
  const coreTone =
    flowerGlyph === '🍃' ? '#34d399' : flowerGlyph === '🌿' ? '#86efac' : '#f9a8d4';
  const petalTone = nightMode
    ? '#93c5fd'
    : flowerGlyph === '🍃'
      ? '#6ee7b7'
      : flowerGlyph === '🌿'
        ? '#bbf7d0'
        : '#fbcfe8';
  const stemTone = nightMode ? '#334155' : '#2f6f6b';
  const opacity = withered ? 0.56 : 1;
  const saturation = nightMode ? '#93c5fd' : withered ? '#9ca3af' : '#2f6f6b';
  const canvas = size * 0.82;
  const cx = canvas / 2;
  const cy = canvas * 0.38;

  return (
    <View style={[styles.root, { width: size, height: size }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glow,
          {
            opacity: glow,
            width: size * 0.9,
            height: size * 0.9,
            borderRadius: (size * 0.9) / 2,
          },
        ]}
      />
      <Animated.View
        style={[
          {
            transform: [
              { scale: baseScale },
              {
                translateX: leafJitter.interpolate({
                  inputRange: [-1, 1],
                  outputRange: [-1.4, 1.4],
                }),
              },
              {
                rotate: sway.interpolate({
                  inputRange: [-1, 1],
                  outputRange: ['-2deg', '2deg'],
                }),
              },
            ],
            opacity,
          },
        ]}
      >
        <Svg width={canvas} height={canvas} viewBox={`0 0 ${canvas} ${canvas}`}>
          <Defs>
            <LinearGradient id="stemGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor={stemTone} />
              <Stop offset="100%" stopColor={nightMode ? '#1e293b' : '#164e63'} />
            </LinearGradient>
          </Defs>
          <Path
            d={`M ${cx} ${canvas * 0.9} C ${cx - 8} ${canvas * 0.76}, ${cx + 5} ${canvas * 0.58}, ${cx} ${canvas * 0.42}`}
            stroke="url(#stemGrad)"
            strokeWidth={Math.max(2.5, canvas * (phase === 'germ' ? 0.018 : 0.03))}
            fill="none"
            strokeLinecap="round"
          />
          {phase !== 'germ' ? (
            <>
              <G>
                <Ellipse
                  cx={cx - canvas * 0.11}
                  cy={canvas * 0.62}
                  rx={canvas * 0.11}
                  ry={canvas * 0.06}
                  fill={nightMode ? 'rgba(59,130,246,0.34)' : 'rgba(34,197,94,0.32)'}
                  transform={`rotate(-24 ${cx - canvas * 0.11} ${canvas * 0.62})`}
                />
                {phase !== 'stem' ? (
                  <Ellipse
                    cx={cx + canvas * 0.12}
                    cy={canvas * 0.56}
                    rx={canvas * 0.11}
                    ry={canvas * 0.06}
                    fill={nightMode ? 'rgba(96,165,250,0.34)' : 'rgba(16,185,129,0.3)'}
                    transform={`rotate(22 ${cx + canvas * 0.12} ${canvas * 0.56})`}
                  />
                ) : null}
              </G>
            </>
          ) : null}
          {phase === 'germ' ? (
            <Ellipse
              cx={cx}
              cy={canvas * 0.76}
              rx={canvas * 0.07}
              ry={canvas * 0.03}
              fill={nightMode ? '#475569' : '#84cc16'}
              opacity={0.85}
            />
          ) : null}
          <G>
            {Array.from({ length: petals }, (_, idx) => {
              const angle = (360 / Math.max(1, petals)) * idx;
              return (
                <Ellipse
                  key={idx}
                  cx={cx}
                  cy={cy - canvas * 0.11}
                  rx={canvas * 0.055}
                  ry={canvas * 0.13}
                  fill={petalTone}
                  transform={`rotate(${angle} ${cx} ${cy})`}
                  opacity={0.92}
                />
              );
            })}
            <Ellipse
              cx={cx}
              cy={cy}
              rx={canvas * (phase === 'bud' ? 0.075 : 0.09)}
              ry={canvas * (phase === 'bud' ? 0.075 : 0.09)}
              fill={phase === 'bud' ? '#fda4af' : coreTone}
            />
            {phase === 'bloom' ? (
              <>
                <Ellipse
                  cx={cx - canvas * 0.2}
                  cy={cy - canvas * 0.16}
                  rx={canvas * 0.018}
                  ry={canvas * 0.018}
                  fill="#ffffff"
                  opacity={0.78}
                />
                <Ellipse
                  cx={cx + canvas * 0.17}
                  cy={cy - canvas * 0.12}
                  rx={canvas * 0.014}
                  ry={canvas * 0.014}
                  fill="#ffffff"
                  opacity={0.74}
                />
              </>
            ) : null}
          </G>
        </Svg>
      </Animated.View>
      <Text style={[styles.score, { color: saturation }]}>
        {STRINGS.FLOWER.GROWTH_LABEL} {score}%
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center' },
  glow: {
    position: 'absolute',
    backgroundColor: 'rgba(110, 231, 183, 0.35)',
  },
  score: { marginTop: 8, fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
});
