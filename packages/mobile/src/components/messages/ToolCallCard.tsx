import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, LayoutAnimation } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from './TypingIndicator';

interface Props {
  toolName: string;
  args?: Record<string, unknown>;
  output?: string;
  colors: ThemeColors;
}

export const ToolCallCard = React.memo(function ToolCallCard({ toolName, args, output, colors }: Props) {
  const [showOutput, setShowOutput] = useState(false);
  const filePath = (args?.filePath ?? args?.path ?? '') as string;

  const toggle = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowOutput((prev) => !prev);
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Ionicons name="construct-outline" size={12} color={colors.textTertiary} />
        <Text style={[styles.toolName, { color: colors.textSecondary }]}>
          {toolName}
        </Text>
        {filePath ? (
          <>
            <Text style={[styles.arrow, { color: colors.textTertiary }]}>{' \u2192 '}</Text>
            <Text style={styles.filePath} numberOfLines={1} ellipsizeMode="middle">
              {filePath}
            </Text>
          </>
        ) : null}
      </View>
      {output ? (
        <Pressable onPress={toggle}>
          <Text
            style={[styles.output, { color: colors.textTertiary }]}
            numberOfLines={showOutput ? undefined : 3}
          >
            {output}
          </Text>
          {!showOutput && output.length > 120 && (
            <Text style={[styles.more, { color: colors.textTertiary }]}>
              Show more
            </Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  toolName: {
    fontSize: 12,
    fontWeight: '500',
    fontFamily: 'monospace',
  },
  arrow: {
    fontSize: 12,
  },
  filePath: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#3b82f6',
    flexShrink: 1,
  },
  output: {
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 4,
    lineHeight: 15,
  },
  more: {
    fontSize: 11,
    marginTop: 2,
  },
});
