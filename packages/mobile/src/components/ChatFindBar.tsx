import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Glass, Spacing } from '../constants/theme';
import type { ThemeColors } from './messages';

/**
 * In-chat find bar — the native adaptation of paseo's PaneFind: query field
 * with an inline "N of M" counter, previous/next, close. Enter jumps to the
 * next match, shift+enter goes back.
 */
interface Props {
  query: string;
  onQueryChange: (query: string) => void;
  /** Preformatted status: "3 of 12" / "No matches" / "" */
  status: string;
  canNavigate: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  colors: ThemeColors;
}

export function ChatFindBar({
  query,
  onQueryChange,
  status,
  canNavigate,
  onNext,
  onPrevious,
  onClose,
  colors,
}: Props) {
  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.isDark
            ? Glass.opacity.dark.subtle
            : Glass.opacity.light.subtle,
          borderColor: colors.isDark ? Glass.opacity.dark.border : Glass.opacity.light.border,
        },
      ]}
    >
      <Ionicons name="search" size={13} color={colors.textTertiary} />
      <TextInput
        style={[styles.input, { color: colors.textPrimary }]}
        value={query}
        onChangeText={onQueryChange}
        placeholder="Find in conversation"
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        blurOnSubmit={false}
        onSubmitEditing={onNext}
        onKeyPress={(e) => {
          const key = e.nativeEvent as { key?: string };
          if (key.key === 'Escape') onClose();
        }}
      />
      {status ? (
        <Text style={[styles.status, { color: colors.textTertiary }]}>{status}</Text>
      ) : null}
      <Pressable
        onPress={onPrevious}
        disabled={!canNavigate}
        hitSlop={4}
        accessibilityLabel="Previous match"
        style={({ pressed }) => [styles.btn, (!canNavigate || pressed) && { opacity: 0.4 }]}
      >
        <Ionicons name="chevron-up" size={15} color={colors.textSecondary} />
      </Pressable>
      <Pressable
        onPress={onNext}
        disabled={!canNavigate}
        hitSlop={4}
        accessibilityLabel="Next match"
        style={({ pressed }) => [styles.btn, (!canNavigate || pressed) && { opacity: 0.4 }]}
      >
        <Ionicons name="chevron-down" size={15} color={colors.textSecondary} />
      </Pressable>
      <Pressable
        onPress={onClose}
        hitSlop={4}
        accessibilityLabel="Close find"
        style={({ pressed }) => [styles.btn, pressed && { opacity: 0.4 }]}
      >
        <Ionicons name="close" size={15} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md - 2,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    padding: 0,
  },
  status: {
    fontSize: 11.5,
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
  },
  btn: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
  },
});
