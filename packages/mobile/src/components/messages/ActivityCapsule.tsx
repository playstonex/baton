import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  LayoutAnimation,
  ScrollView,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import * as Haptics from 'expo-haptics';
import type { ChatMessage } from '../../stores/chat';
import type { ThemeColors } from './TypingIndicator';
import { Colors, FontFamily } from '../../constants/theme';
import {
  deriveActivitySummary,
  normalizeActivityStep,
  type NormalizedActivityStep,
} from './activitySummary';
import { HighlightedText } from './HighlightedText';
import { DiffRenderer } from './DiffRenderer';

export interface ActivityCapsuleProps {
  messages: ChatMessage[];
  isStreaming?: boolean;
  colors: ThemeColors;
  isExpanded: boolean;
  onToggle: () => void;
  onReviewDiff?: () => void;
  findQuery?: string;
  findActiveMsgId?: string | null;
}

export const ActivityCapsule = React.memo(function ActivityCapsule({
  messages,
  isStreaming = false,
  colors: c,
  isExpanded,
  onToggle,
  onReviewDiff,
  findQuery,
  findActiveMsgId,
}: ActivityCapsuleProps) {
  const summary = useMemo(
    () => deriveActivitySummary(messages, isStreaming),
    [messages, isStreaming],
  );

  const steps = useMemo(
    () => messages.map(normalizeActivityStep),
    [messages],
  );

  // Set of individual step IDs that are expanded to view details
  const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(() => new Set());

  const handleToggleCapsule = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onToggle();
  }, [onToggle]);

  const toggleStepDetails = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setExpandedStepIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return (
    <View
      style={[
        styles.capsuleCard,
        {
          backgroundColor: c.isDark ? 'rgba(23, 24, 28, 0.78)' : 'rgba(255, 255, 255, 0.92)',
          borderColor: c.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.07)',
        },
      ]}
    >
      {/* ── Capsule Header ── */}
      <Pressable
        style={({ pressed }) => [styles.header, { opacity: pressed ? 0.75 : 1 }]}
        onPress={handleToggleCapsule}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={
          isExpanded
            ? `Collapse ${summary.title}`
            : `Expand ${summary.title}`
        }
      >
        {/* Status Indicator */}
        <View style={styles.statusWrap}>
          {summary.isActive ? (
            <View
              style={[
                styles.livePulseWrap,
                { backgroundColor: c.isDark ? 'rgba(94,106,210,0.25)' : 'rgba(94,106,210,0.15)' },
              ]}
            >
              <View style={[styles.liveDot, { backgroundColor: Colors.primary[300] }]} />
            </View>
          ) : summary.hasError ? (
            <View
              style={[
                styles.livePulseWrap,
                { backgroundColor: c.isDark ? 'rgba(235,77,85,0.2)' : 'rgba(207,34,46,0.12)' },
              ]}
            >
              <Ionicons name="alert-circle" size={13} color={Colors.danger[400]} />
            </View>
          ) : (
            <View
              style={[
                styles.livePulseWrap,
                { backgroundColor: c.isDark ? 'rgba(63,185,80,0.18)' : 'rgba(26,127,55,0.12)' },
              ]}
            >
              <Ionicons name="checkmark" size={12} color={c.isDark ? Colors.success[400] : Colors.success[600]} />
            </View>
          )}
        </View>

        {/* Title */}
        <View style={styles.titleWrap}>
          <Text style={[styles.titleText, { color: c.textSecondary }]} numberOfLines={1}>
            {summary.title}
          </Text>

          {/* Micro Category Pills */}
          {summary.pills.length > 0 && summary.totalSteps > 1 && (
            <View style={styles.pillRow}>
              {summary.pills.map((p, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.microPill,
                    {
                      backgroundColor: c.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
                    },
                  ]}
                >
                  <Text style={[styles.microPillText, { color: c.textTertiary }]}>{p}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Right Info: Duration & Chevron */}
        <View style={styles.headerRight}>
          {summary.formattedDuration ? (
            <Text style={[styles.durationText, { color: c.textTertiary }]}>
              {summary.formattedDuration}
            </Text>
          ) : null}
          <Ionicons
            name="chevron-forward"
            size={12}
            color={c.textTertiary}
            style={{ transform: [{ rotate: isExpanded ? '90deg' : '0deg' }] }}
          />
        </View>
      </Pressable>

      {/* ── Expanded Step Timeline ── */}
      {isExpanded && (
        <View
          style={[
            styles.timelineContainer,
            { borderTopColor: c.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' },
          ]}
        >
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;
            const isStepExpanded = expandedStepIds.has(step.id);
            const hasDetails = Boolean(
              step.command ||
                step.output ||
                (step.kind === 'thinking' && step.rawContent) ||
                step.diff ||
                step.filePath,
            );

            return (
              <TimelineStepRow
                key={step.id}
                step={step}
                isLast={isLast}
                isExpanded={isStepExpanded}
                hasDetails={hasDetails}
                colors={c}
                onToggle={() => toggleStepDetails(step.id)}
                findQuery={findQuery}
                isFindActive={step.id === findActiveMsgId}
              />
            );
          })}

          {/* Diff Review Pill Footer */}
          {summary.hasFileChanges && onReviewDiff && (
            <Pressable
              style={({ pressed }) => [
                styles.reviewDiffPill,
                {
                  backgroundColor: c.isDark ? 'rgba(94,106,210,0.12)' : 'rgba(94,106,210,0.08)',
                  borderColor: c.isDark ? 'rgba(94,106,210,0.25)' : 'rgba(94,106,210,0.2)',
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
              onPress={onReviewDiff}
              hitSlop={4}
            >
              <Ionicons name="git-compare-outline" size={13} color={Colors.primary[400]} />
              <Text style={[styles.reviewDiffLabel, { color: Colors.primary[400] }]}>
                Review {summary.fileChangesCount} changed file{summary.fileChangesCount !== 1 ? 's' : ''}
              </Text>
              <Ionicons name="arrow-forward" size={11} color={Colors.primary[400]} />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
});

// ── Individual Step Row in the Timeline ──

interface StepRowProps {
  step: NormalizedActivityStep;
  isLast: boolean;
  isExpanded: boolean;
  hasDetails: boolean;
  colors: ThemeColors;
  onToggle: () => void;
  findQuery?: string;
  isFindActive?: boolean;
}

const TimelineStepRow = React.memo(function TimelineStepRow({
  step,
  isLast,
  isExpanded,
  hasDetails,
  colors: c,
  onToggle,
  findQuery,
  isFindActive,
}: StepRowProps) {
  // Determine step accent tint
  const nodeBg = useMemo(() => {
    if (step.status === 'failed') {
      return c.isDark ? 'rgba(235,77,85,0.18)' : 'rgba(207,34,46,0.12)';
    }
    if (step.kind === 'thinking') {
      return c.isDark ? 'rgba(130, 143, 255, 0.15)' : 'rgba(94,106,210,0.12)';
    }
    if (step.kind === 'commandExecution') {
      return c.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0,0,0,0.06)';
    }
    if (step.kind === 'fileChange') {
      return c.isDark ? 'rgba(63, 185, 80, 0.16)' : 'rgba(26,127,55,0.1)';
    }
    return c.isDark ? 'rgba(94, 106, 210, 0.15)' : 'rgba(94,106,210,0.08)';
  }, [step.status, step.kind, c.isDark]);

  const iconColor = useMemo(() => {
    if (step.status === 'failed') return Colors.danger[400];
    if (step.kind === 'thinking') return Colors.primary[300];
    if (step.kind === 'fileChange') return c.isDark ? Colors.success[400] : Colors.success[600];
    return c.textSecondary;
  }, [step.status, step.kind, c]);

  return (
    <View style={styles.stepRowWrapper}>
      {/* Vertical Connecting Rail Line */}
      {!isLast && (
        <View
          style={[
            styles.timelineRail,
            { backgroundColor: c.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' },
          ]}
        />
      )}

      {/* Row Header */}
      <Pressable
        style={({ pressed }) => [styles.stepHeader, { opacity: pressed && hasDetails ? 0.75 : 1 }]}
        onPress={hasDetails ? onToggle : undefined}
        hitSlop={4}
      >
        {/* Step Icon Node */}
        <View style={[styles.stepNode, { backgroundColor: nodeBg }]}>
          {step.status === 'running' ? (
            <View style={[styles.nodeDot, { backgroundColor: Colors.primary[300] }]} />
          ) : (
            <Ionicons name={step.iconName as any} size={11} color={iconColor} />
          )}
        </View>

        {/* Step Title & Target */}
        <View style={styles.stepTitleArea}>
          <Text style={[styles.stepVerb, { color: c.textSecondary }]}>
            {step.verb}
            {step.target ? (
              <Text
                style={[
                  styles.stepTarget,
                  { color: step.kind === 'thinking' ? c.textTertiary : Colors.primary[400] },
                ]}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {' '}
                {step.target}
              </Text>
            ) : null}
          </Text>
        </View>

        {/* Step Duration & Expand Indicator */}
        <View style={styles.stepRight}>
          {step.duration ? (
            <Text style={[styles.stepDuration, { color: c.textTertiary }]}>{step.duration}</Text>
          ) : null}
          {hasDetails && (
            <Ionicons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={11}
              color={c.textTertiary}
            />
          )}
        </View>
      </Pressable>

      {/* Step Detail Content Drawer */}
      {isExpanded && hasDetails && (
        <View
          style={[
            styles.detailDrawer,
            {
              backgroundColor: c.isDark ? '#111215' : '#f0f2f5',
              borderColor: c.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
            },
          ]}
        >
          {/* Thinking Detail */}
          {step.detailType === 'thinking' && (
            <Text style={[styles.detailText, { color: c.textSecondary }]}>
              {step.rawContent}
            </Text>
          )}

          {/* Command Detail */}
          {step.detailType === 'command' && (
            <View style={styles.commandDetailWrap}>
              {step.command ? (
                <View style={styles.commandLineWrap}>
                  <Text style={[styles.commandPrompt, { color: Colors.primary[400] }]}>$</Text>
                  <Text
                    style={[styles.commandLine, { color: c.textPrimary }]}
                    selectable
                    numberOfLines={4}
                  >
                    {step.command}
                  </Text>
                  {step.exitCode !== undefined && (
                    <View
                      style={[
                        styles.exitBadge,
                        {
                          backgroundColor:
                            step.exitCode === 0
                              ? c.isDark
                                ? 'rgba(63,185,80,0.18)'
                                : 'rgba(26,127,55,0.12)'
                              : c.isDark
                                ? 'rgba(235,77,85,0.2)'
                                : 'rgba(207,34,46,0.12)',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.exitBadgeText,
                          {
                            color:
                              step.exitCode === 0
                                ? c.isDark
                                  ? Colors.success[400]
                                  : Colors.success[600]
                                : Colors.danger[400],
                          },
                        ]}
                      >
                        exit {step.exitCode}
                      </Text>
                    </View>
                  )}
                </View>
              ) : null}

              {step.output ? (
                <ScrollView
                  style={styles.outputScroll}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                >
                  <HighlightedText
                    text={step.output}
                    query={findQuery ?? ''}
                    active={isFindActive}
                    style={[styles.detailMono, { color: c.textTertiary }]}
                  />
                </ScrollView>
              ) : null}
            </View>
          )}

          {/* Tool Detail */}
          {step.detailType === 'tool' && (
            <View style={styles.toolDetailWrap}>
              {step.filePath ? (
                <Text style={[styles.detailPath, { color: Colors.primary[400] }]} selectable>
                  {step.filePath}
                </Text>
              ) : null}
              {step.output ? (
                <ScrollView
                  style={styles.outputScroll}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                >
                  <HighlightedText
                    text={step.output}
                    query={findQuery ?? ''}
                    active={isFindActive}
                    style={[styles.detailMono, { color: c.textTertiary }]}
                  />
                </ScrollView>
              ) : null}
            </View>
          )}

          {/* File Change Diff Detail */}
          {step.detailType === 'file' && (
            <View style={styles.fileDetailWrap}>
              <Text style={[styles.detailPath, { color: Colors.primary[400] }]} selectable>
                {step.filePath}
              </Text>
              {step.diff ? (
                <DiffRenderer diff={step.diff} colors={c} maxLines={16} />
              ) : null}
            </View>
          )}

          {/* Subagent Detail */}
          {step.detailType === 'subagent' && (
            <Text style={[styles.detailText, { color: c.textSecondary }]}>
              {step.output || step.rawContent}
            </Text>
          )}
        </View>
      )}
    </View>
  );
});

// ── Styles ──

const styles = StyleSheet.create({
  capsuleCard: {
    alignSelf: 'stretch',
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
    overflow: 'hidden',
    marginVertical: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 9,
  },
  statusWrap: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  livePulseWrap: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  titleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  titleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  microPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  microPillText: {
    fontSize: 10.5,
    fontWeight: '500',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  durationText: {
    fontFamily: FontFamily.mono,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  timelineContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 12,
    gap: 0,
  },
  stepRowWrapper: {
    position: 'relative',
    paddingVertical: 5,
  },
  timelineRail: {
    position: 'absolute',
    left: 9.5,
    top: 24,
    bottom: -4,
    width: 1.5,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  stepNode: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nodeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  stepTitleArea: {
    flex: 1,
    minWidth: 0,
  },
  stepVerb: {
    fontSize: 12.5,
    fontWeight: '500',
  },
  stepTarget: {
    fontSize: 12,
    fontFamily: FontFamily.mono,
  },
  stepRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  stepDuration: {
    fontSize: 10.5,
    fontFamily: FontFamily.mono,
    fontVariant: ['tabular-nums'],
  },
  detailDrawer: {
    marginTop: 6,
    marginLeft: 29,
    padding: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  detailText: {
    fontSize: 11.5,
    lineHeight: 16,
  },
  detailPath: {
    fontSize: 11.5,
    fontFamily: FontFamily.mono,
    marginBottom: 4,
  },
  commandDetailWrap: {
    gap: 6,
  },
  commandLineWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    flexWrap: 'wrap',
  },
  commandPrompt: {
    fontSize: 11.5,
    fontFamily: FontFamily.mono,
    fontWeight: '700',
  },
  commandLine: {
    fontSize: 11.5,
    fontFamily: FontFamily.mono,
    flex: 1,
    lineHeight: 16,
  },
  exitBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  exitBadgeText: {
    fontSize: 10,
    fontFamily: FontFamily.mono,
    fontWeight: '600',
  },
  outputScroll: {
    maxHeight: 160,
  },
  detailMono: {
    fontSize: 11,
    fontFamily: FontFamily.mono,
    lineHeight: 15,
  },
  toolDetailWrap: {
    gap: 4,
  },
  fileDetailWrap: {
    gap: 4,
  },
  reviewDiffPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 8,
    marginLeft: 29,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  reviewDiffLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
});
