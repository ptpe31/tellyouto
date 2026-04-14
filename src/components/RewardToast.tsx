import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

type Props = {
  visible: boolean;
  message: string;
};

export function RewardToast({ visible, message }: Props) {
  const y = useRef(new Animated.Value(-22)).current;
  const op = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(y, { toValue: 0, duration: 210, useNativeDriver: true }),
        Animated.timing(op, { toValue: 1, duration: 210, useNativeDriver: true }),
      ]).start();
      return;
    }
    Animated.parallel([
      Animated.timing(y, { toValue: -22, duration: 180, useNativeDriver: true }),
      Animated.timing(op, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [visible, y, op]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        { opacity: op, transform: [{ translateY: y }] },
      ]}
    >
      <View style={styles.card}>
        <Text style={styles.text}>{message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 10,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 30,
  },
  card: {
    maxWidth: '88%',
    backgroundColor: 'rgba(15,118,110,0.92)',
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  text: { color: '#f8fafc', fontSize: 13, fontWeight: '700', textAlign: 'center' },
});

