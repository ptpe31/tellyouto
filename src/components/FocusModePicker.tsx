import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useTheme } from 'react-native-paper';

import type { FocusCapsuleMode } from '../navigation/types';
import { neumorphicInset } from '../theme/neumorphism';

type Props = {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (mode: FocusCapsuleMode) => void;
  title: string;
  chronoLabel: string;
  chronoHint: string;
  pomodoroLabel: string;
  pomodoroHint: string;
};

export function FocusModePicker({
  visible,
  onDismiss,
  onSelect,
  title,
  chronoLabel,
  chronoHint,
  pomodoroLabel,
  pomodoroHint,
}: Props) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const maxW = Math.min(360, width - 48);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable
          style={[
            styles.sheet,
            { maxWidth: maxW, backgroundColor: theme.colors.surface },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[styles.sheetTitle, { color: theme.colors.onSurface }]}>
            {title}
          </Text>

          <Pressable
            onPress={() => onSelect('chrono')}
            style={({ pressed }) => [
              styles.option,
              neumorphicInset(theme),
              { opacity: pressed ? 0.92 : 1 },
            ]}
            accessibilityRole="button"
          >
            <Text style={[styles.optionTitle, { color: theme.colors.primary }]}>
              {chronoLabel}
            </Text>
            <Text
              style={[styles.optionHint, { color: theme.colors.onSurfaceVariant }]}
            >
              {chronoHint}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => onSelect('pomodoro')}
            style={({ pressed }) => [
              styles.option,
              neumorphicInset(theme),
              { marginTop: 12, opacity: pressed ? 0.92 : 1 },
            ]}
            accessibilityRole="button"
          >
            <Text style={[styles.optionTitle, { color: theme.colors.primary }]}>
              {pomodoroLabel}
            </Text>
            <Text
              style={[styles.optionHint, { color: theme.colors.onSurfaceVariant }]}
            >
              {pomodoroHint}
            </Text>
          </Pressable>

          <Pressable
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.dismiss,
              { opacity: pressed ? 0.7 : 1 },
            ]}
            accessibilityRole="button"
          >
            <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 15 }}>
              ✕
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.38)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    padding: 20,
    borderRadius: 20,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 16,
  },
  option: {
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 16,
  },
  optionTitle: { fontSize: 16, fontWeight: '700' },
  optionHint: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  dismiss: {
    alignSelf: 'center',
    marginTop: 14,
    padding: 8,
  },
});
