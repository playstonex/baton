import React, { useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  Dimensions,
  ScrollView,
} from 'react-native';
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

const CARD_WIDTH = 240;
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
  const { containerStyle, maxHeight } = useMemo(() => {
    if (!anchor) {
      return { containerStyle: styles.cardCentered, maxHeight: undefined };
    }
    const { width: screenW, height: screenH } = Dimensions.get('window');
    const { x, y, width: aw, height: ah } = anchor;

    let left = x;
    if (left + CARD_WIDTH > screenW - SCREEN_MARGIN) {
      left = screenW - CARD_WIDTH - SCREEN_MARGIN;
    }
    if (left < SCREEN_MARGIN) left = SCREEN_MARGIN;

    const spaceBelow = screenH - (y + ah + GAP) - SCREEN_MARGIN;
    const spaceAbove = y - GAP - SCREEN_MARGIN;
    const cardH = estimateCardHeight(options, !!title);

    let top: number | undefined;
    let bottom: number | undefined;
    let maxH: number | undefined;

    if (spaceBelow >= cardH || spaceBelow >= spaceAbove) {
      top = y + ah + GAP;
      maxH = Math.min(cardH, spaceBelow);
    } else {
      bottom = screenH - y + GAP;
      maxH = Math.min(cardH, spaceAbove);
    }

    const positionStyle = {
      position: 'absolute' as const,
      left,
      width: CARD_WIDTH,
      ...(top !== undefined ? { top } : { bottom }),
    };

    return { containerStyle: positionStyle, maxHeight: maxH };
  }, [anchor, options, title]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.card, { backgroundColor: colors.bg }, containerStyle]}
          onPress={() => {}}
        >
          {title && (
            <Text style={[styles.title, { color: colors.textTertiary }]}>{title}</Text>
          )}

          <ScrollView style={maxHeight ? { maxHeight } : undefined}>
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
                    pressed && { backgroundColor: colors.subtle },
                  ]}
                  onPress={() => {
                    if (!opt.disabled) onSelect(i);
                  }}
                  disabled={opt.disabled}
                >
                  <Text
                    style={[
                      styles.optionText,
                      { color: opt.destructive ? '#F04545' : colors.textPrimary },
                      opt.disabled && { opacity: 0.35 },
                    ]}
                    numberOfLines={1}
                  >
                    {opt.label}
                  </Text>
                  {opt.selected && (
                    <Text style={[styles.checkmark, { color: colors.textPrimary }]}>✓</Text>
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
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  card: {
    borderRadius: 14,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  cardCentered: {
    alignSelf: 'center',
    width: '76%',
    maxWidth: 320,
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
    fontSize: 15,
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
