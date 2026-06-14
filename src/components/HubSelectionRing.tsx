import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon } from 'react-native-paper';

import { PressableScale } from './common/PressableScale';
import { HUB_TASK_CHECKBOX_SIZE } from './HubTaskCheckbox';

type Props = {
  selected: boolean;
  indeterminate?: boolean;
  onPress: () => void;
  a11yLabel: string;
  outlineColor: string;
  selectedColor: string;
};

/** Cercle de sélection — mode suppression hub. */
export function HubSelectionRing(props: Props) {
  const { selected, indeterminate = false, onPress, a11yLabel, outlineColor, selectedColor } = props;
  const filled = selected && !indeterminate;
  return (
    <PressableScale
      style={styles.hit}
      hapticType="light"
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: filled, expanded: indeterminate ? true : undefined }}
      accessibilityLabel={a11yLabel}
    >
      <View
        style={[
          styles.ring,
          { borderColor: filled || indeterminate ? selectedColor : outlineColor },
          filled ? { backgroundColor: selectedColor } : null,
          indeterminate ? { backgroundColor: `${selectedColor}22` } : null,
        ]}
      >
        {filled ? <Icon source="check" size={14} color="#ffffff" /> : null}
        {indeterminate && !filled ? (
          <View style={[styles.indeterminateBar, { backgroundColor: selectedColor }]} />
        ) : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  hit: { flexShrink: 0, marginTop: 1 },
  ring: {
    width: HUB_TASK_CHECKBOX_SIZE,
    height: HUB_TASK_CHECKBOX_SIZE,
    borderRadius: HUB_TASK_CHECKBOX_SIZE / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  indeterminateBar: {
    width: 10,
    height: 2,
    borderRadius: 1,
  },
});
