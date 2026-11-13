import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Linking, ScrollView, Pressable, Clipboard } from 'react-native';
import * as Haptics from 'expo-haptics';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { ThemeColors } from './TypingIndicator';
import { findMatchRanges, toHighlightSegments } from './HighlightedText';
import { Colors, FontFamily } from '../../constants/theme';
import { useRevealedText } from '../../hooks/useRevealedText';

interface Props {
  content: string;
  colors: ThemeColors;
  isStreaming?: boolean;
  /** When set (chat find), matching substrings render highlighted. */
  highlightQuery?: string;
  /** Stronger treatment on the row the find bar points at. */
  highlightActive?: boolean;
}

interface TokenNode {
  type: string;
  content?: string;
  children?: TokenNode[];
  markup?: string;
  info?: string;
  level?: number;
  items?: TokenNode[][];
  tag?: string;
  nesting?: number;
  attrs?: [string, string][];
  hidden?: boolean;
  [key: string]: unknown;
}

type MarkdownParser = { parse: (src: string, env: unknown) => TokenNode[] };

let mdInstance: MarkdownParser | null = null;

function getMd(): MarkdownParser {
  if (!mdInstance) {
    // Lazy singleton — markdown-it is synchronous to construct but there is
    // no reason to pay it on every render.
    const MarkdownIt = require('markdown-it') as new (opts: unknown) => MarkdownParser;
    mdInstance = new MarkdownIt({ html: false, linkify: true, breaks: true });
  }
  return mdInstance;
}

const CodeBlock = React.memo(function CodeBlock({
  code,
  language,
  colors,
}: {
  code: string;
  language?: string;
  colors: ThemeColors;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    Clipboard.setString(code);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const cleanLang = (language?.trim().split(/\s+/)[0] || 'code').toUpperCase();

  return (
    <View
      style={[
        styles.codeBlock,
        {
          backgroundColor: colors.isDark ? '#141519' : '#f4f5f7',
          borderColor: colors.cardBorder,
        },
      ]}
    >
      <View
        style={[
          styles.codeHeader,
          {
            borderBottomColor: colors.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
          },
        ]}
      >
        <Text style={[styles.codeLang, { color: colors.textTertiary }]}>{cleanLang}</Text>
        <Pressable
          onPress={handleCopy}
          hitSlop={8}
          style={({ pressed }) => [styles.copyBtn, { opacity: pressed ? 0.6 : 1 }]}
          accessibilityLabel={copied ? 'Copied code' : 'Copy code'}
        >
          <Ionicons
            name={copied ? 'checkmark' : 'copy-outline'}
            size={12}
            color={
              copied
                ? colors.isDark
                  ? Colors.primary[300]
                  : Colors.primary[600]
                : colors.textTertiary
            }
          />
          <Text
            style={[
              styles.copyText,
              {
                color: copied
                  ? colors.isDark
                    ? Colors.primary[300]
                    : Colors.primary[600]
                  : colors.textTertiary,
              },
            ]}
          >
            {copied ? 'Copied' : 'Copy'}
          </Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.codeScrollContent}
      >
        <Text style={[styles.codeText, { color: colors.textPrimary }]}>
          {code.replace(/\n$/, '')}
        </Text>
      </ScrollView>
    </View>
  );
});

const StreamingCursor = React.memo(function StreamingCursor({ colors }: { colors: ThemeColors }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setVisible((v) => !v);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  return (
    <Text
      style={[
        styles.streamingCursor,
        {
          color: colors.isDark ? Colors.primary[300] : Colors.primary[500],
          opacity: visible ? 0.95 : 0.2,
        },
      ]}
    >
      {' ▎'}
    </Text>
  );
});

export const MarkdownText = React.memo(function MarkdownText({
  content,
  colors,
  isStreaming,
  highlightQuery,
  highlightActive,
}: Props) {
  const revealedContent = useRevealedText(content, isStreaming);

  const tokens = useMemo(() => {
    try {
      return getMd().parse(revealedContent, {}) as TokenNode[];
    } catch {
      return [];
    }
  }, [revealedContent]);

  const renderTokens = useCallback(
    (tokens: TokenNode[]): React.ReactNode[] => {
      const hl = highlightQuery?.trim()
        ? { query: highlightQuery, active: highlightActive ?? false }
        : undefined;

      // Identify the last inline token so the trailing cursor attaches to it
      let lastInlineIdx = -1;
      if (isStreaming) {
        for (let j = tokens.length - 1; j >= 0; j--) {
          if (tokens[j].type === 'inline') {
            lastInlineIdx = j;
            break;
          }
        }
      }

      if (tokens.length === 0) {
        if (isStreaming) {
          return [
            <View key="cursor-only" style={styles.block}>
              <Text style={[styles.paragraph, { color: colors.textPrimary }]}>
                <StreamingCursor colors={colors} />
              </Text>
            </View>,
          ];
        }
        return [];
      }

      const elements: React.ReactNode[] = [];
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.type === 'paragraph_open') {
          continue;
        }
        if (token.type === 'paragraph_close') {
          continue;
        }
        if (token.type === 'inline') {
          const isLastInline = isStreaming && i === lastInlineIdx;
          elements.push(
            <View key={i} style={styles.block}>
              <Text style={[styles.paragraph, { color: colors.textPrimary }]}>
                {renderInline(
                  token.children ?? [],
                  colors,
                  i,
                  hl,
                  isLastInline ? <StreamingCursor key="cursor" colors={colors} /> : undefined,
                )}
              </Text>
            </View>,
          );
          continue;
        }
        if (token.type === 'heading_open') {
          const level = token.tag?.toString().replace('h', '') ?? '1';
          const sizeMap: Record<
            string,
            { size: number; lineHeight: number; marginTop: number; marginBottom: number }
          > = {
            '1': { size: 21, lineHeight: 27, marginTop: 14, marginBottom: 6 },
            '2': { size: 18.5, lineHeight: 24, marginTop: 12, marginBottom: 5 },
            '3': { size: 16.5, lineHeight: 22, marginTop: 10, marginBottom: 4 },
            '4': { size: 15, lineHeight: 20, marginTop: 8, marginBottom: 3 },
          };
          const conf = sizeMap[level] ?? {
            size: 15,
            lineHeight: 20,
            marginTop: 8,
            marginBottom: 3,
          };
          const inlineToken = tokens[i + 1];
          if (inlineToken?.type === 'inline') {
            elements.push(
              <View key={i} style={styles.block}>
                <Text
                  style={[
                    styles.heading,
                    {
                      fontSize: conf.size,
                      lineHeight: conf.lineHeight,
                      marginTop: conf.marginTop,
                      marginBottom: conf.marginBottom,
                      color: colors.textPrimary,
                    },
                  ]}
                >
                  {renderInline(inlineToken.children ?? [], colors, i, hl)}
                </Text>
              </View>,
            );
            i += 2;
          }
          continue;
        }
        if (token.type === 'code_block' || token.type === 'fence') {
          const code = token.content ?? '';
          const lang = token.info ?? '';
          elements.push(
            <View key={i} style={styles.block}>
              <CodeBlock code={code} language={lang} colors={colors} />
            </View>,
          );
          continue;
        }
        if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
          const { node, nextIndex } = renderList(tokens, i, colors, hl);
          elements.push(
            <View key={i} style={styles.block}>
              {node}
            </View>,
          );
          i = nextIndex;
          continue;
        }
        if (token.type === 'blockquote_open') {
          const inlineToken = tokens[i + 1];
          if (inlineToken?.type === 'inline') {
            elements.push(
              <View
                key={i}
                style={[styles.block, styles.blockquote, { borderLeftColor: colors.textTertiary }]}
              >
                <Text style={[styles.blockquoteText, { color: colors.textSecondary }]}>
                  {renderInline(inlineToken.children ?? [], colors, i, hl)}
                </Text>
              </View>,
            );
            i += 2;
          }
          continue;
        }
        if (token.type === 'hr') {
          elements.push(
            <View key={i} style={[styles.hr, { backgroundColor: colors.separator }]} />,
          );
          continue;
        }
        if (token.type === 'table_open') {
          const { node, next } = renderTable(tokens, i + 1, colors, hl);
          elements.push(
            <View key={i} style={styles.block}>
              {node}
            </View>,
          );
          i = next - 1;
          continue;
        }
      }

      if (isStreaming && lastInlineIdx === -1 && elements.length > 0) {
        elements.push(
          <View key="trailing-cursor" style={styles.block}>
            <Text style={[styles.paragraph, { color: colors.textPrimary }]}>
              <StreamingCursor colors={colors} />
            </Text>
          </View>,
        );
      }

      return elements;
    },
    [colors, highlightQuery, highlightActive, isStreaming],
  );

  return <View style={styles.container}>{renderTokens(tokens)}</View>;
});

/**
 * Walks inline children, pairing `*_open` markers with their `*_close` and
 * wrapping the enclosed span in a styled <Text>. Nesting (bold inside a link,
 * code inside bold, …) falls out of the recursion.
 */
function renderInline(
  children: TokenNode[],
  colors: ThemeColors,
  baseKey: number,
  hl?: { query: string; active: boolean },
  trailingNode?: React.ReactNode,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < children.length) {
    const child = children[i];
    const key = `${baseKey}-${i}`;
    switch (child.type) {
      case 'text': {
        const content = child.content ?? '';
        if (hl && content) {
          const ranges = findMatchRanges(hl.query, content);
          if (ranges.length > 0) {
            out.push(
              <Text key={key}>
                {toHighlightSegments(content, ranges).map((seg, si) =>
                  seg.marked ? (
                    <Text key={si} style={hl.active ? styles.markActive : styles.mark}>
                      {seg.text}
                    </Text>
                  ) : (
                    <Text key={si}>{seg.text}</Text>
                  ),
                )}
              </Text>,
            );
            i++;
            break;
          }
        }
        out.push(<Text key={key}>{content}</Text>);
        i++;
        break;
      }
      case 'softbreak':
      case 'hardbreak':
        out.push(<Text key={key}>{'\n'}</Text>);
        i++;
        break;
      case 'code_inline':
        out.push(
          <Text key={key} style={[styles.inlineCode, { backgroundColor: colors.subtle }]}>
            {child.content}
          </Text>,
        );
        i++;
        break;
      case 'strong_open': {
        const close = findClose(children, i, 'strong_close');
        out.push(
          <Text key={key} style={styles.strong}>
            {renderInline(
              children.slice(i + 1, close === -1 ? children.length : close),
              colors,
              i,
              hl,
            )}
          </Text>,
        );
        i = close === -1 ? children.length : close + 1;
        break;
      }
      case 'em_open': {
        const close = findClose(children, i, 'em_close');
        out.push(
          <Text key={key} style={styles.em}>
            {renderInline(
              children.slice(i + 1, close === -1 ? children.length : close),
              colors,
              i,
              hl,
            )}
          </Text>,
        );
        i = close === -1 ? children.length : close + 1;
        break;
      }
      case 's_open': {
        const close = findClose(children, i, 's_close');
        out.push(
          <Text key={key} style={styles.strikethrough}>
            {renderInline(
              children.slice(i + 1, close === -1 ? children.length : close),
              colors,
              i,
              hl,
            )}
          </Text>,
        );
        i = close === -1 ? children.length : close + 1;
        break;
      }
      case 'link_open': {
        const close = findClose(children, i, 'link_close');
        const href = child.attrs?.find(([k]) => k === 'href')?.[1] ?? '';
        out.push(
          <Text
            key={key}
            style={styles.link}
            onPress={() => {
              if (href) void Linking.openURL(href).catch(() => {});
            }}
          >
            {renderInline(
              children.slice(i + 1, close === -1 ? children.length : close),
              colors,
              i,
              hl,
            )}
          </Text>,
        );
        i = close === -1 ? children.length : close + 1;
        break;
      }
      case 'image': {
        const src = child.attrs?.find(([k]) => k === 'src')?.[1];
        out.push(
          <Text key={key} style={[styles.link, { fontStyle: 'italic' }]}>
            {` ${child.content || src || 'image'} `}
          </Text>,
        );
        i++;
        break;
      }
      default:
        // open/close markers of unknown marks and their pairs are skipped by
        // the recursion — the slice between them still renders.
        if (child.type.endsWith('_open') || child.type.endsWith('_close')) {
          i++;
        } else if (child.content && !child.hidden) {
          out.push(<Text key={key}>{child.content}</Text>);
          i++;
        } else {
          i++;
        }
    }
  }
  if (trailingNode) {
    out.push(trailingNode);
  }
  return out;
}

function findClose(children: TokenNode[], from: number, closeType: string): number {
  // Only same-type nesting needs tracking; markdown-it emits balanced pairs,
  // so the first close of the SAME type at depth 0 is ours.
  let depth = 0;
  const openType = closeType.replace('_close', '_open');
  for (let i = from + 1; i < children.length; i++) {
    if (children[i].type === openType) depth++;
    else if (children[i].type === closeType) {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/**
 * Renders nested markdown-it bullet or ordered lists with reliable depth tracking.
 */
function renderList(
  tokens: TokenNode[],
  startIndex: number,
  colors: ThemeColors,
  hl?: { query: string; active: boolean },
): { node: React.ReactNode; nextIndex: number } {
  const isOrdered = tokens[startIndex].type === 'ordered_list_open';
  const closeType = isOrdered ? 'ordered_list_close' : 'bullet_list_close';
  const openType = tokens[startIndex].type;
  const items: React.ReactNode[] = [];
  let depth = 1;
  let j = startIndex + 1;
  let counter = 0;

  while (j < tokens.length && depth > 0) {
    const t = tokens[j];
    if (t.type === openType) {
      depth++;
      j++;
      continue;
    }
    if (t.type === closeType) {
      depth--;
      if (depth === 0) break;
      j++;
      continue;
    }
    if (t.type === 'list_item_open' && depth === 1) {
      counter++;
      let itemDepth = 1;
      let k = j + 1;
      const inlineTokens: TokenNode[] = [];
      while (k < tokens.length && itemDepth > 0) {
        if (tokens[k].type === 'list_item_open') itemDepth++;
        else if (tokens[k].type === 'list_item_close') {
          itemDepth--;
          if (itemDepth === 0) break;
        } else if (tokens[k].type === 'inline' && itemDepth === 1) {
          inlineTokens.push(tokens[k]);
        }
        k++;
      }

      items.push(
        <View key={j} style={styles.listItem}>
          <Text style={[styles.bullet, { color: colors.textTertiary }]}>
            {isOrdered ? `${counter}.` : '•'}
          </Text>
          <View style={styles.listTextContainer}>
            {inlineTokens.map((inlineTok, idx) => (
              <Text key={idx} style={[styles.listText, { color: colors.textPrimary }]}>
                {renderInline(inlineTok.children ?? [], colors, j * 100 + idx, hl)}
              </Text>
            ))}
          </View>
        </View>,
      );
      j = k + 1;
      continue;
    }
    j++;
  }

  return {
    node: (
      <View key={`list-${startIndex}`} style={styles.list}>
        {items}
      </View>
    ),
    nextIndex: j,
  };
}

/** Renders a markdown-it table as a hairline grid; wide tables scroll. */
function renderTable(
  tokens: TokenNode[],
  start: number,
  colors: ThemeColors,
  hl?: { query: string; active: boolean },
): { node: React.ReactNode; next: number } {
  const rows: { cells: TokenNode[][]; header: boolean }[] = [];
  let headerRow = true;
  let i = start;
  for (; i < tokens.length && tokens[i].type !== 'table_close'; i++) {
    const t = tokens[i];
    if (t.type === 'thead_close') headerRow = false;
    if (t.type !== 'tr_open') continue;
    const cells: TokenNode[][] = [];
    let j = i + 1;
    for (; j < tokens.length && tokens[j].type !== 'tr_close'; j++) {
      if (tokens[j].type === 'th_open' || tokens[j].type === 'td_open') {
        const inline = tokens[j + 1];
        cells.push(inline?.type === 'inline' ? (inline.children ?? []) : []);
      }
    }
    rows.push({ cells, header: headerRow });
    i = j;
  }
  const colCount = Math.max(...rows.map((r) => r.cells.length), 1);
  const node = (
    <ScrollView key={`tbl-${start}`} horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.table}>
        {rows.map((row, ri) => (
          <View
            key={ri}
            style={[
              styles.tableRow,
              {
                borderColor: colors.separator,
                backgroundColor: row.header ? colors.subtle : 'transparent',
              },
            ]}
          >
            {Array.from({ length: colCount }).map((_, ci) => (
              <Text
                key={ci}
                style={[
                  styles.tableCell,
                  { color: row.header ? colors.textPrimary : colors.textSecondary },
                  row.header && styles.tableCellHeader,
                ]}
                numberOfLines={row.header ? 1 : 3}
              >
                {row.cells[ci]?.length
                  ? renderInline(row.cells[ci], colors, ri * 1000 + ci, hl)
                  : ''}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
  return { node, next: i + 1 };
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  block: {
    width: '100%',
  },
  paragraph: {
    fontSize: 15.5,
    lineHeight: 23,
    letterSpacing: -0.15,
    marginVertical: 3,
  },
  heading: {
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  strong: {
    fontWeight: '700',
  },
  em: {
    fontStyle: 'italic',
  },
  strikethrough: {
    textDecorationLine: 'line-through',
  },
  link: {
    color: '#0a84ff',
    textDecorationLine: 'underline',
  },
  mark: {
    backgroundColor: 'rgba(255,214,10,0.35)',
  },
  markActive: {
    backgroundColor: Colors.primary[500],
    color: '#ffffff',
  },
  codeBlock: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginVertical: 6,
  },
  codeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  codeLang: {
    fontFamily: FontFamily.mono,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  copyText: {
    fontSize: 11,
    fontWeight: '500',
  },
  codeScrollContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  codeText: {
    fontFamily: FontFamily.mono,
    fontSize: 13,
    lineHeight: 19,
  },
  inlineCode: {
    fontFamily: FontFamily.mono,
    fontSize: 13.5,
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  list: {
    width: '100%',
    gap: 4,
    marginVertical: 4,
  },
  listItem: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginVertical: 2,
    paddingLeft: 4,
  },
  listTextContainer: {
    flex: 1,
    minWidth: 0,
  },
  bullet: {
    fontSize: 15,
    lineHeight: 22,
    minWidth: 16,
    textAlign: 'right',
  },
  listText: {
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: -0.15,
  },
  blockquote: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    marginVertical: 6,
  },
  blockquoteText: {
    fontSize: 15,
    lineHeight: 22.5,
    fontStyle: 'italic',
  },
  hr: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  table: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.35)',
    marginVertical: 6,
    minWidth: '100%',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.35)',
  },
  tableCell: {
    flex: 1,
    fontSize: 13.5,
    lineHeight: 18,
    paddingHorizontal: 10,
    paddingVertical: 7,
    minWidth: 90,
  },
  tableCellHeader: {
    fontWeight: '600',
  },
  streamingCursor: {
    fontFamily: FontFamily.mono,
    fontWeight: '700',
    fontSize: 15.5,
    lineHeight: 22,
  },
});
