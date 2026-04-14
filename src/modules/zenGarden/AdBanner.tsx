import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  label: string;
  cta: string;
  disabled?: boolean;
  onPress: () => void;
};

export function AdBanner({ label, cta, disabled, onPress }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={({ pressed }) => [styles.btn, pressed && styles.pressed, disabled && styles.disabled]}
        onPress={onPress}
        disabled={disabled}
      >
        <Text style={styles.btnText}>{cta}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 10,
    width: '100%',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(45,111,112,0.14)',
    padding: 10,
  },
  label: { fontSize: 12, color: '#2f4f5a', fontWeight: '600', textAlign: 'center' },
  btn: {
    marginTop: 8,
    alignSelf: 'center',
    borderRadius: 10,
    backgroundColor: '#0d9488',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  btnText: { color: '#f8fafc', fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.9 },
  disabled: { opacity: 0.5 },
});

