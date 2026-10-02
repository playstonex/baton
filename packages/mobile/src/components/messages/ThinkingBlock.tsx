import React, { useState, useCallback } from 'react';
import { Text, Pressable, StyleSheet, LayoutAnimation } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { ThemeColors } from './TypingIndicator';
import { TypingIndicator } from './TypingIndicator';

interface Props {
  content: string;
  colors: ThemeColors;
  isStreaming?: boolean;
}

/**
 * Quiet inline row (Codex-style) — no filled card, just a collapsible
 * "Thought process" line that keeps the transcript visually calm.
 */
export const ThinkingBlock = React.memo(function ThinkingBlock({ content, colors, isStreaming }: Props) {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => !prev);
  }, []);

  return (
    <Pressable
      style={styles.container}
      onPress={toggle}
      hitSlop={4}
      accessibilityLabel={expanded ? 'Collapse thought process' : 'Expand thought process'}
    >
      <Ionicons
        name="chevron-forward"
        size={10}
        color={colors.textTertiary}
        style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
      />
      <Text style={[styles.label, { color: colors.textTertiary }]}>
        {isStreaming ? 'Thinking' : 'Thought process'}
      </Text>
      {isStreaming && <TypingIndicator colors={colors} />}
      {expanded && (
        <Text style={[styles.content, { color: colors.textSecondary }]}>{content}</Text>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 2,
  },
  label: {
    fontSize: 12.5,
    fontWeight: '500',
  },
  content: {
    fontSize: 12,
    lineHeight: 18,
    width: '100%',
    paddingLeft: 17,
  },
});
