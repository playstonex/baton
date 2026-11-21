import React, { useCallback, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useThemeColors } from '../hooks/useThemeColors';

/**
 * Native-feeling press feedback. Both components are drop-in replacements for
 * React Native's `Pressable` (same props, `style`/`children` may still be
 * functions of `{ pressed }`), so call sites only swap the component name and
 * drop their `opacity: pressed ? x : 1` fade.
 *
 * - `ScalePressable` — buttons, pills, icon buttons, chips. A short spring
 *   scale-down on touch-down and back on release, like UIKit buttons.
 * - `HighlightPressable` — full-width rows and list items. A highlight fill
 *   behind the content while pressed, like a UITableViewCell; Android ripple.
 */

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const PRESS_SPRING = { damping: 30, stiffness: 600, mass: 0.6 } as const;

type StyleInput = PressableProps['style'];

function resolveStyle(style: StyleInput, state: PressableStateCallbackType) {
  return typeof style === 'function' ? style(state) : style;
}

function resolveChildren(children: PressableProps['children'], state: PressableStateCallbackType) {
  return typeof children === 'function' ? children(state) : children;
}

type PressableRef = React.ComponentProps<typeof Pressable>['ref'];

export interface ScalePressableProps extends PressableProps {
  ref?: PressableRef;
  /** Scale while pressed. Default 0.96; use ~0.98 for large surfaces. */
  pressedScale?: number;
}

export function ScalePressable({
  ref,
  pressedScale = 0.96,
  style,
  children,
  onPressIn,
  onPressOut,
  disabled,
  android_ripple,
  ...rest
}: ScalePressableProps) {
  const scale = useSharedValue(1);
  const [pressed, setPressed] = useState(false);

  const handleIn = useCallback(
    (e: GestureResponderEvent) => {
      setPressed(true);
      scale.value = withSpring(pressedScale, PRESS_SPRING);
      onPressIn?.(e);
    },
    [onPressIn, pressedScale, scale],
  );
  const handleOut = useCallback(
    (e: GestureResponderEvent) => {
      setPressed(false);
      scale.value = withSpring(1, PRESS_SPRING);
      onPressOut?.(e);
    },
    [onPressOut, scale],
  );

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const state = { pressed, hovered: false } as PressableStateCallbackType;

  return (
    <AnimatedPressable
      {...rest}
      ref={ref as never}
      disabled={disabled}
      onPressIn={handleIn}
      onPressOut={handleOut}
      android_ripple={android_ripple}
      style={[resolveStyle(style, state) as StyleProp<ViewStyle>, animatedStyle]}
    >
      {resolveChildren(children, state)}
    </AnimatedPressable>
  );
}

export interface HighlightPressableProps extends PressableProps {
  ref?: PressableRef;
  /** Override the pressed fill; defaults to the system-like gray for the theme. */
  highlightColor?: string;
}

export function HighlightPressable({
  ref,
  highlightColor,
  style,
  children,
  android_ripple,
  ...rest
}: HighlightPressableProps) {
  const c = useThemeColors();
  const fill = highlightColor ?? (c.isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)');
  const useRipple = Platform.OS === 'android';

  return (
    <Pressable
      {...rest}
      ref={ref}
      android_ripple={android_ripple ?? (useRipple ? { color: fill } : undefined)}
      style={style}
    >
      {(state) => {
        const flat = StyleSheet.flatten(resolveStyle(style, state) as StyleProp<ViewStyle>) ?? {};
        return (
          <>
            {state.pressed && !useRipple && (
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: fill,
                    borderRadius: flat.borderRadius,
                    borderTopLeftRadius: flat.borderTopLeftRadius,
                    borderTopRightRadius: flat.borderTopRightRadius,
                    borderBottomLeftRadius: flat.borderBottomLeftRadius,
                    borderBottomRightRadius: flat.borderBottomRightRadius,
                    borderCurve: flat.borderCurve,
                  },
                ]}
              />
            )}
            {resolveChildren(children, state)}
          </>
        );
      }}
    </Pressable>
  );
}
