import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from 'react-native-paper';
import { neumorphicInset } from '../theme/neumorphism';

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function NeumorphicSurface({ children, style }: Props) {
  const theme = useTheme();
  return (
    <View style={[neumorphicInset(theme), { padding: 12 }, style]}>
      {children}
    </View>
  );
}
