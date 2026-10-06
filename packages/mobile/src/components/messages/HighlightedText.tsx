import React, { useMemo } from 'react';
import { Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/theme';

/**
 * Substring-highlighting Text — the native counterpart of paseo's
 * highlighted-text (CSS Highlight API is web-only). Match finding uses
 * paseo's regex policy: escape each word, join with \s+ so multi-word
 * queries match across collapsed whitespace.
 */

export interface MatchRange {
  start: number;
  length: number;
}

export interface HighlightSegment {
  start: number;
  text: string;
  marked: boolean;
}

export function findMatchRanges(query: string, text: string): MatchRange[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const pattern = trimmed
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  const ranges: MatchRange[] = [];
  for (const match of text.matchAll(new RegExp(pattern, 'gi'))) {
    if (match.index === undefined) continue;
    ranges.push({ start: match.index, length: match[0].length });
  }
  return ranges;
}

/** Split text into marked/unmarked segments; bad ranges are clamped/skipped. */
export function toHighlightSegments(text: string, ranges: readonly MatchRange[]): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    const start = Math.max(range.start, cursor);
    const end = Math.min(start + range.length, text.length);
    if (end <= start) continue;
    if (start > cursor) {
      segments.push({ start: cursor, text: text.slice(cursor, start), marked: false });
    }
    segments.push({ start, text: text.slice(start, end), marked: true });
    cursor = end;
  }
  if (cursor < text.length) {
    segments.push({ start: cursor, text: text.slice(cursor), marked: false });
  }
  return segments;
}

interface Props {
  text: string;
  query: string;
  /** Visual treatment for the row the find bar currently points at. */
  active?: boolean;
  style?: React.ComponentProps<typeof Text>['style'];
  numberOfLines?: number;
}

export function HighlightedText({ text, query, active, style, numberOfLines }: Props) {
  const segments = useMemo(() => {
    if (!query.trim()) return null;
    return toHighlightSegments(text, findMatchRanges(query, text));
  }, [query, text]);

  if (!segments) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {text}
      </Text>
    );
  }
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {segments.map((segment) =>
        segment.marked ? (
          <Text key={segment.start} style={active ? styles.markActive : styles.mark}>
            {segment.text}
          </Text>
        ) : (
          <Text key={segment.start}>{segment.text}</Text>
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  mark: {
    backgroundColor: 'rgba(255,214,10,0.35)',
  },
  markActive: {
    backgroundColor: Colors.primary[500],
    color: '#ffffff',
  },
});
