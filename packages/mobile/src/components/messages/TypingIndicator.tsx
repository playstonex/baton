import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  interpolate,
} from 'react-native-reanimated';

export interface ThemeColors {
  isDark: boolean;
  bg: string;
  card: string;
  cardBorder: string;
  elevated: string;
  subtle: string;
  inputBg: string;
  inputBorder: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
}

export const TypingIndicator = React.memo(function TypingIndicator({ colors }: { colors: ThemeColors }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 1000 }), -1, false);
  }, [progress]);

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [-21, 21]) },
    ],
    opacity: interpolate(progress.value, [0, 0.5, 1], [0.04, 0.42, 0.04]),
  }));

  return (
    <View style={styles.track}>
      <Animated.View
        style={[
          styles.shimmer,
          { backgroundColor: colors.textTertiary },
          shimmerStyle,
        ]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  track: {
    width: 26,
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(142,142,147,0.12)',
    overflow: 'hidden',
  },
  shimmer: {
    width: 16,
    height: 6,
    borderRadius: 999,
  },
});
