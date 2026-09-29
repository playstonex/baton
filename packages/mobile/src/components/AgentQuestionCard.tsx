import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useThemeColors } from '../hooks/useThemeColors';
import { GlassCard, GlassButton } from './GlassKit';
import { Typography, Spacing, Colors, Glass } from '../constants/theme';

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionItem {
  id?: string;
  header?: string;
  question: string;
  options?: QuestionOption[];
}

export interface PermissionItem {
  requestId: string;
  tool: string;
  action: string;
  description?: string;
}

interface AgentQuestionCardProps {
  question?: QuestionItem;
  permission?: PermissionItem;
  onAnswer?: (answer: string) => void;
  onApprove?: () => void;
  onReject?: () => void;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}

export function AgentQuestionCard({
  question,
  permission,
  onAnswer,
  onApprove,
  onReject,
  style,
  compact = false,
}: AgentQuestionCardProps) {
  const c = useThemeColors();
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // If this is a permission request card
  if (permission) {
    return (
      <GlassCard c={c} style={[styles.card, styles.permissionCard, style]}>
        <View style={styles.headerRow}>
          <View style={styles.iconBadgePermission}>
            <Ionicons name="shield-checkmark" size={16} color={Colors.warning[400]} />
          </View>
          <View style={styles.headerTextGroup}>
            <Text style={[Typography.subhead, styles.bold, { color: c.textPrimary }]}>
              Permission Requested
            </Text>
            <View style={styles.toolPill}>
              <Text style={[Typography.caption2, { color: Colors.warning[400], fontWeight: '700' }]}>
                {permission.tool || 'Action'}
              </Text>
            </View>
          </View>
        </View>

        <Text style={[Typography.body, { color: c.textPrimary, marginVertical: Spacing.sm }]}>
          {permission.description || permission.action || 'The agent is requesting approval to execute this command.'}
        </Text>

        {permission.action && permission.description !== permission.action && (
          <View
            style={[
              styles.codeBox,
              {
                backgroundColor: c.isDark
                  ? Glass.opacity.dark.subtle
                  : Glass.opacity.light.subtle,
              },
            ]}
          >
            <Text style={[Typography.mono, { color: c.textPrimary, fontSize: 12 }]}>
              {permission.action}
            </Text>
          </View>
        )}

        <View style={styles.actionRow}>
          <View style={{ flex: 1 }}>
            <GlassButton
              c={c}
              label="Reject"
              variant="danger"
              onPress={() => {
                setSubmitted(true);
                onReject?.();
              }}
              disabled={submitted}
              icon="close"
            />
          </View>
          <View style={{ flex: 1 }}>
            <GlassButton
              c={c}
              label="Approve"
              variant="primary"
              onPress={() => {
                setSubmitted(true);
                onApprove?.();
              }}
              disabled={submitted}
              icon="checkmark"
            />
          </View>
        </View>
      </GlassCard>
    );
  }

  // If this is a structured question card
  if (question) {
    const options = question.options ?? [];
    const canSubmit = !submitted && (selectedOption !== null || customText.trim().length > 0);

    const handleSelectOption = (optLabel: string) => {
      if (submitted) return;
      setSelectedOption(optLabel);
      // Auto-submit on tap in compact docked mode, or keep selected in full mode
      if (compact) {
        setSubmitted(true);
        onAnswer?.(optLabel);
      }
    };

    const handleSubmit = () => {
      if (!canSubmit) return;
      const answer = customText.trim() || selectedOption || '';
      if (!answer) return;
      setSubmitted(true);
      onAnswer?.(answer);
    };

    return (
      <GlassCard c={c} style={[styles.card, styles.questionCard, style]}>
        <View style={styles.headerRow}>
          <View style={styles.iconBadgeQuestion}>
            <Ionicons name="chatbubbles" size={16} color={Colors.primary[500]} />
          </View>
          <View style={styles.headerTextGroup}>
            <Text style={[Typography.subhead, styles.bold, { color: c.textPrimary }]}>
              {question.header || 'Agent Question'}
            </Text>
            {compact && (
              <Text style={[Typography.caption2, { color: Colors.primary[500] }]}>
                Action needed
              </Text>
            )}
          </View>
        </View>

        <Text style={[Typography.body, { color: c.textPrimary, marginVertical: Spacing.xs }]}>
          {question.question}
        </Text>

        {/* Options List */}
        {options.length > 0 && (
          <View style={styles.optionsContainer}>
            {options.map((opt, i) => {
              const isSelected = selectedOption === opt.label;
              return (
                <Pressable
                  key={i}
                  onPress={() => handleSelectOption(opt.label)}
                  disabled={submitted}
                  style={({ pressed }) => [
                    styles.optionButton,
                    {
                      backgroundColor: isSelected
                        ? Colors.primary[500] + (c.isDark ? '40' : '1F')
                        : c.isDark
                          ? Glass.opacity.dark.border
                          : Glass.opacity.light.border,
                      borderColor: isSelected
                        ? Colors.primary[500]
                        : c.isDark
                          ? Glass.opacity.dark.border
                          : Glass.opacity.light.border,
                      opacity: submitted && !isSelected ? 0.4 : pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <View style={styles.optionContent}>
                    <Text
                      style={[
                        Typography.subhead,
                        {
                          color: isSelected ? Colors.primary[500] : c.textPrimary,
                          fontWeight: isSelected ? '700' : '500',
                        },
                      ]}
                    >
                      {opt.label}
                    </Text>
                    {opt.description ? (
                      <Text
                        style={[
                          Typography.caption2,
                          { color: c.textSecondary, marginTop: 2 },
                        ]}
                      >
                        {opt.description}
                      </Text>
                    ) : null}
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={18} color={Colors.primary[500]} />
                  )}
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Custom Answer Input (when not compact or options empty) */}
        {(!compact || options.length === 0) && !submitted && (
          <View style={styles.customInputRow}>
            <TextInput
              style={[
                styles.customInput,
                {
                  color: c.textPrimary,
                  backgroundColor: c.isDark
                    ? Glass.opacity.dark.subtle
                    : Glass.opacity.light.subtle,
                  borderColor: c.isDark
                    ? Glass.opacity.dark.border
                    : Glass.opacity.light.border,
                },
              ]}
              placeholder="Or type a custom reply..."
              placeholderTextColor={c.textTertiary}
              value={customText}
              onChangeText={(t) => {
                setCustomText(t);
                if (t.trim().length > 0) setSelectedOption(null);
              }}
              onSubmitEditing={handleSubmit}
              returnKeyType="send"
            />
            <GlassButton
              c={c}
              label="Reply"
              onPress={handleSubmit}
              disabled={!canSubmit}
              variant="primary"
              style={{ minWidth: 70 }}
            />
          </View>
        )}

        {/* Action button in compact mode if an option was selected but not auto-submitted */}
        {compact && !submitted && (
          <View style={{ marginTop: Spacing.sm }}>
            <GlassButton
              c={c}
              label="Submit Choice"
              onPress={handleSubmit}
              disabled={!canSubmit}
              variant="primary"
            />
          </View>
        )}
      </GlassCard>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.md,
    borderRadius: 16,
    marginVertical: Spacing.xs,
  },
  permissionCard: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.warning[400],
  },
  questionCard: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary[500],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  iconBadgePermission: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.warning[400] + '26',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBadgeQuestion: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.primary[500] + '26',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bold: {
    fontWeight: '700',
  },
  toolPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: Colors.warning[400] + '1F',
  },
  codeBox: {
    padding: Spacing.sm,
    borderRadius: 8,
    marginBottom: Spacing.md,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  optionsContainer: {
    gap: Spacing.xs,
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
  },
  optionContent: {
    flex: 1,
  },
  customInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  customInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    ...Typography.subhead,
  },
});
