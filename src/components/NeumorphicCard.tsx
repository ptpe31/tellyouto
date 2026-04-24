import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from 'react-native-paper';
import { neumorphicRaised } from '../theme/neumorphism';

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function NeumorphicCard({ children, style }: Props) {
  const theme = useTheme();
  return (
    <View style={[neumorphicRaised(theme), { padding: 16 }, style]}>
      {children}
    </View>
  );
}
