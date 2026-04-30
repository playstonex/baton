import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from './TypingIndicator';

const STATUS_COLORS: Record<string, string> = {
  completed: '#21C45E',
  in_progress: '#FF9500',
  pending: '#78716c',
};

interface Props {
  explanation?: string;
  steps?: Array<{ step: string; status: string }>;
  presentation: string;
  colors: ThemeColors;
}

export const PlanCard = React.memo(function PlanCard({ explanation, steps, colors }: Props) {
  return (
    <View style={[styles.container, { backgroundColor: colors.subtle }]}>
      <View style={styles.header}>
        <Ionicons name="list-outline" size={14} color={colors.textSecondary} />
        <Text style={[styles.headerLabel, { color: colors.textSecondary }]}>
          Plan
        </Text>
      </View>
      {explanation ? (
        <Text style={[styles.explanation, { color: colors.textPrimary }]}>
          {explanation}
        </Text>
      ) : null}
      {steps && steps.length > 0 && (
        <View style={styles.steps}>
          {steps.map((s, i) => {
            const sc = STATUS_COLORS[s.status] ?? STATUS_COLORS.pending;
            return (
              <View key={i} style={styles.step}>
                <View style={[styles.stepIndicator, { borderColor: sc }]}>
                  {s.status === 'completed' && (
                    <Ionicons name="checkmark" size={10} color={sc} />
                  )}
                </View>
                <Text
                  style={[
                    styles.stepText,
                    { color: s.status === 'completed' ? colors.textTertiary : colors.textPrimary },
                    s.status === 'completed' && styles.stepDone,
                  ]}
                  numberOfLines={2}
                >
                  {s.step}
                </Text>
              </View>
            );
          })}
        </View>
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
  explanation: {
    fontSize: 14,
    marginTop: 8,
    lineHeight: 19,
  },
  steps: {
    marginTop: 10,
    gap: 6,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  stepIndicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 17,
  },
  stepDone: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
});
