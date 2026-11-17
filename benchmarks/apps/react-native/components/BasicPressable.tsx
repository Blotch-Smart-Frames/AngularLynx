import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Platform, Pressable, TouchableOpacity } from 'react-native';

interface Props extends React.PropsWithChildren {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function AndroidPressable({ onPress, children, style, testID }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={style}
      testID={testID}
      android_ripple={{ foreground: true, borderless: false }}
    >
      {children}
    </Pressable>
  );
}

function IosPressable({ onPress, children, style, testID }: Props) {
  return (
    <TouchableOpacity onPress={onPress} style={style} testID={testID}>
      {children}
    </TouchableOpacity>
  );
}

export const BasicPressable = Platform.OS === 'android' ? AndroidPressable : IosPressable;
