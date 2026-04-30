import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, LayoutAnimation } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from './TypingIndicator';

const AGENT_COLORS = [
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f97316',
  '#14b8a6',
  '#06b6d4',
  '#a855f7',
  '#ef4444',
];

function agentColor(name?: string): string {
  if (!name) return AGENT_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

const ACTION_ICON = {
  started: 'play-circle-outline',
  completed: 'checkmark-circle-outline',
  message: 'chatbubble-outline',
} as const;

interface Props {
  name?: string;
  model?: string;
  action: string;
  content?: string;
  status?: string;
  colors: ThemeColors;
}

export const SubagentActionCard = React.memo(function SubagentActionCard({
  name,
  model,
  action,
  content,
  status,
  colors: c,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const accent = agentColor(name);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((e) => !e);
  };

  const iconName = ACTION_ICON[action as keyof typeof ACTION_ICON] ?? 'play-circle-outline';

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
      <Pressable style={styles.header} onPress={content ? toggle : undefined}>
        <View style={[styles.indicator, { backgroundColor: accent }]} />
        <Ionicons name={iconName} size={14} color={accent} />
        <Text style={[styles.nameLabel, { color: c.textPrimary }]} numberOfLines={1}>
          {name ?? 'Subagent'}
        </Text>
        {model && (
          <Text style={[styles.modelLabel, { color: c.textTertiary }]} numberOfLines={1}>
            {model}
          </Text>
        )}
        {status && (
          <View style={[styles.statusPill, { backgroundColor: c.subtle }]}>
            <Text style={[styles.statusText, { color: c.textTertiary }]}>{status}</Text>
          </View>
        )}
        {content && (
          <Ionicons
            name="chevron-forward"
            size={12}
            color={c.textTertiary}
            style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
          />
        )}
      </Pressable>
      {expanded && content && (
        <View style={styles.body}>
          <Text style={[styles.bodyText, { color: c.textSecondary }]}>{content}</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  indicator: {
    width: 3,
    height: 20,
    borderRadius: 1.5,
  },
  nameLabel: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  modelLabel: {
    fontSize: 11,
    fontWeight: '400',
    flexShrink: 1,
  },
  statusPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '500',
  },
  body: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.15)',
  },
  bodyText: {
    fontSize: 12,
    lineHeight: 16,
  },
});
