import React, { useEffect, useRef } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  children: React.ReactNode;
  index: number;
  style?: StyleProp<ViewStyle>;
};

const BASE_DELAY_MS = 40;
const DURATION_MS = 360;

/** Fondu + léger slide vertical (Animated standard — pas de Reanimated dans le bundle). */
export function FadeSlideIn({ children, index, style }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    const delay = index * BASE_DELAY_MS;
    const anim = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: DURATION_MS,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: DURATION_MS,
        delay,
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => {
      anim.stop();
    };
  }, [opacity, translateY, index]);

  return (
    <Animated.View
      style={[{ opacity, transform: [{ translateY }] }, style]}
    >
      {children}
    </Animated.View>
  );
}
