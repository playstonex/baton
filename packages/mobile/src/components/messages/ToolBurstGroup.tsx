import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from './TypingIndicator';

interface Props {
  visibleCount?: number;
  colors: ThemeColors;
  children: React.ReactNode;
  hiddenCount: number;
  isExpanded: boolean;
  onToggle: () => void;
}

export const ToolBurstGroup = React.memo(function ToolBurstGroup({
  visibleCount: _visibleCount = 5,
  colors,
  children,
  hiddenCount,
  isExpanded,
  onToggle,
}: Props) {
  return (
    <View>
      {children}
      {hiddenCount > 0 && (
        <Pressable style={styles.expandRow} onPress={onToggle}>
          <Ionicons
            name="chevron-forward"
            size={10}
            color={colors.textSecondary}
            style={{ transform: [{ rotate: isExpanded ? '90deg' : '0deg' }] }}
          />
          <Text style={[styles.countLabel, { color: colors.textSecondary }]}>
            +{hiddenCount}
          </Text>
          <Text style={[styles.nounLabel, { color: colors.textTertiary }]}>
            tool calls
          </Text>
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  expandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  countLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  nounLabel: {
    fontSize: 15,
  },
});
