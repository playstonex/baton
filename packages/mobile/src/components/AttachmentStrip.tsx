import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Colors, Glass, Spacing } from '../constants/theme';
import type { ThemeColors } from './messages';

/** A picked-but-unsent image attachment, base64 payload ready for the wire. */
export interface PendingAttachment {
  id: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  /** Base64 (no data: prefix) — exactly what chat_input.images expects. */
  data: string;
  width: number;
  height: number;
}

/**
 * Removable thumbnail rail above the composer — happy's
 * AgentInputAttachmentStrip pattern: 64pt tiles, close button on the corner.
 */
export function AttachmentStrip({
  images,
  onRemove,
  colors,
}: {
  images: PendingAttachment[];
  onRemove: (id: string) => void;
  colors: ThemeColors;
}) {
  if (images.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      contentContainerStyle={styles.content}
      style={styles.strip}
    >
      {images.map((img) => (
        <View
          key={img.id}
          style={[
            styles.tile,
            { borderColor: colors.isDark ? Glass.opacity.dark.border : Glass.opacity.light.border },
          ]}
        >
          <Image
            source={{ uri: `data:${img.mediaType};base64,${img.data}` }}
            style={styles.image}
            resizeMode="cover"
          />
          <Pressable
            onPress={() => onRemove(img.id)}
            hitSlop={6}
            style={({ pressed }) => [styles.remove, pressed && { opacity: 0.6 }]}
            accessibilityLabel="Remove attachment"
          >
            <Ionicons name="close" size={11} color="#ffffff" />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const THUMB = 56;

const styles = StyleSheet.create({
  strip: {
    marginBottom: Spacing.xs,
  },
  content: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xs + 2,
  },
  tile: {
    width: THUMB,
    height: THUMB,
    borderRadius: 10,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'visible',
    position: 'relative',
  },
  image: {
    width: THUMB,
    height: THUMB,
    borderRadius: 10,
  },
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.danger[500],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.5)',
  },
});
