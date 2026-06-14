import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon } from 'react-native-paper';

import { PressableScale } from './common/PressableScale';

export const HUB_TASK_CHECKBOX_SIZE = 22;

type Props = {
  checked: boolean;
  onPress: () => void;
  a11yLabel: string;
  outlineColor: string;
};

/** Case carrée unifiée — Inbox, hubs, jalons voyage, sous-tâches zoom. */
export function HubTaskCheckbox(props: Props) {
  const { checked, onPress, a11yLabel, outlineColor } = props;
  return (
    <PressableScale
      style={styles.hit}
      hapticType="light"
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={a11yLabel}
    >
      <View
        style={[
          styles.box,
          { borderColor: checked ? '#16a34a' : outlineColor },
          checked ? styles.boxChecked : null,
        ]}
      >
        {checked ? <Icon source="check" size={14} color="#ffffff" /> : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  hit: { flexShrink: 0, marginTop: 1 },
  box: {
    width: HUB_TASK_CHECKBOX_SIZE,
    height: HUB_TASK_CHECKBOX_SIZE,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  boxChecked: {
    backgroundColor: '#16a34a',
    borderColor: '#16a34a',
  },
});
