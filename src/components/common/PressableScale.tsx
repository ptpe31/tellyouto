import React, { useCallback } from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useDesignTokens } from '../../hooks/useDesignTokens';
import { safeHaptic, type HapticType } from '../../utils/haptics';

export type PressableScaleHapticType = HapticType | 'none';

export type PressableScaleProps = PressableProps & {
  /** Haptique au `onPressIn` (T=0). `'none'` désactive ; défaut `'light'`. */
  hapticType?: PressableScaleHapticType;
};

/**
 * Sur-couche `Pressable` avec feedback visuel (opacity + scale) et haptique à T=0 ms.
 */
export function PressableScale({
  children,
  style,
  disabled,
  hapticType = 'light',
  onPressIn,
  ...rest
}: PressableScaleProps) {
  const designTokens = useDesignTokens();

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      if (!disabled && hapticType !== 'none') {
        void safeHaptic(hapticType);
      }
      onPressIn?.(event);
    },
    [disabled, hapticType, onPressIn],
  );

  const resolveStyle = useCallback(
    (pressed: boolean): StyleProp<ViewStyle> => {
      const base = typeof style === 'function' ? style({ pressed }) : style;
      if (!pressed || disabled) {
        return base;
      }
      return [
        base,
        {
          opacity: designTokens.pressedOpacity,
          transform: [{ scale: designTokens.pressedScale }],
        },
      ];
    },
    [designTokens.pressedOpacity, designTokens.pressedScale, disabled, style],
  );

  return (
    <Pressable {...rest} disabled={disabled} onPressIn={handlePressIn} style={({ pressed }) => resolveStyle(pressed)}>
      {children}
    </Pressable>
  );
}
