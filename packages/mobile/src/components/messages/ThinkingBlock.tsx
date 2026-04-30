import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, LayoutAnimation } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from './TypingIndicator';
import { TypingIndicator } from './TypingIndicator';

interface Props {
  content: string;
  colors: ThemeColors;
  isStreaming?: boolean;
}

export const ThinkingBlock = React.memo(function ThinkingBlock({ content, colors, isStreaming }: Props) {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => !prev);
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.subtle }]}>
      <Pressable style={styles.header} onPress={toggle}>
        <Ionicons
          name="chevron-forward"
          size={10}
          color={colors.textSecondary}
          style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
        />
        <Text style={[styles.headerLabel, { color: colors.textSecondary }]}>
          Thinking
        </Text>
        {isStreaming && <TypingIndicator colors={colors} />}
      </Pressable>
      {expanded && (
        <Text style={[styles.content, { color: colors.textSecondary }]}>
          {content}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  content: {
    fontSize: 12,
    lineHeight: 18,
    opacity: 0.85,
    marginTop: 8,
  },
});
