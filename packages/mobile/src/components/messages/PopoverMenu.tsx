import React, { useMemo } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, Dimensions, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Colors, CornerRadius, Glass, Shadows } from '../../constants/theme';
import type { ThemeColors } from './TypingIndicator';

export interface MenuOption {
  label?: string;
  value?: string;
  selected?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  separator?: true;
}

export interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  visible: boolean;
  title?: string;
  options: MenuOption[];
  colors: ThemeColors;
  anchor?: AnchorRect;
  onSelect: (index: number) => void;
  onClose: () => void;
}

const CARD_WIDTH = 280;
const GAP = 6;
const SCREEN_MARGIN = 16;
const OPTION_HEIGHT = 44;
const TITLE_HEIGHT = 36;
const SEP_HEIGHT = 9;

function estimateCardHeight(options: MenuOption[], hasTitle: boolean): number {
  let h = 12;
  if (hasTitle) h += TITLE_HEIGHT;
  for (const opt of options) {
    h += opt.separator ? SEP_HEIGHT : OPTION_HEIGHT;
  }
  return h;
}

export const PopoverMenu = React.memo(function PopoverMenu({
  visible,
  title,
  options,
  colors,
  anchor,
  onSelect,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();

  const { containerStyle, maxHeight } = useMemo(() => {
    if (!anchor) {
      return { containerStyle: styles.cardCentered, maxHeight: undefined };
    }
    const { width: screenW, height: screenH } = Dimensions.get('window');
    const { x, y, height: ah } = anchor;

    let left = x;
    if (left + CARD_WIDTH > screenW - SCREEN_MARGIN) {
      left = screenW - CARD_WIDTH - SCREEN_MARGIN;
    }
    if (left < SCREEN_MARGIN) left = SCREEN_MARGIN;

    // Keep clear of iOS notch / Dynamic Island and home indicator
    const topMargin = Math.max(insets.top, 44) + 10;
    const bottomMargin = Math.max(insets.bottom, 24) + 10;

    const spaceBelow = screenH - (y + ah + GAP) - bottomMargin;
    const spaceAbove = y - GAP - topMargin;
    const cardH = estimateCardHeight(options, !!title);

    let top: number | undefined;
    let bottom: number | undefined;
    let maxH: number | undefined;

    if (spaceBelow >= cardH || spaceBelow >= spaceAbove) {
      top = Math.max(topMargin, y + ah + GAP);
      maxH = Math.min(cardH, Math.max(120, spaceBelow));
    } else {
      bottom = Math.max(bottomMargin, screenH - y + GAP);
      maxH = Math.min(cardH, Math.max(120, spaceAbove));
    }

    const positionStyle = {
      position: 'absolute' as const,
      left,
      width: CARD_WIDTH,
      ...(top !== undefined ? { top } : { bottom }),
    };

    return { containerStyle: positionStyle, maxHeight: maxH };
  }, [anchor, options, title, insets.top, insets.bottom]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.card, containerStyle]} onPress={() => {}}>
          <BlurView
            tint={colors.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
            intensity={Glass.blur.sheet}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: colors.isDark
                  ? Glass.opacity.dark.elevated
                  : Glass.opacity.light.surface,
                borderRadius: CornerRadius.large,
              },
            ]}
            pointerEvents="none"
          />
          {title && <Text style={[styles.title, { color: colors.textTertiary }]}>{title}</Text>}

          <ScrollView
            style={maxHeight ? { maxHeight: maxHeight - (title ? TITLE_HEIGHT : 16) } : undefined}
            showsVerticalScrollIndicator={true}
          >
            {options.map((opt, i) => {
              if (opt.separator) {
                return (
                  <View
                    key={`sep-${i}`}
                    style={[styles.separator, { backgroundColor: colors.subtle }]}
                  />
                );
              }

              return (
                <Pressable
                  key={`opt-${i}`}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      backgroundColor: pressed
                        ? colors.isDark
                          ? 'rgba(255,255,255,0.08)'
                          : 'rgba(0,0,0,0.05)'
                        : 'transparent',
                    },
                  ]}
                  onPress={() => onSelect(i)}
                >
                  <Text
                    style={[
                      styles.optionText,
                      {
                        color: opt.destructive
                          ? Colors.danger[400]
                          : opt.selected
                            ? Colors.primary[500]
                            : colors.textPrimary,
                        fontWeight: opt.selected ? '600' : '400',
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {opt.label}
                  </Text>
                  {opt.selected && (
                    <Text style={[styles.checkmark, { color: Colors.primary[500] }]}>✓</Text>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  card: {
    borderRadius: CornerRadius.large,
    borderCurve: 'continuous',
    overflow: 'hidden',
    paddingVertical: 6,
    ...Shadows.elevated,
  },
  cardCentered: {
    alignSelf: 'center',
    width: '84%',
    maxWidth: 340,
  },
  title: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  optionText: {
    flex: 1,
    fontSize: 14,
  },
  checkmark: {
    fontSize: 16,
    marginLeft: 8,
  },
  separator: {
    height: 1,
    marginVertical: 4,
    marginHorizontal: 16,
  },
});
