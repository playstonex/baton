import React, { useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, Linking, ScrollView } from 'react-native';
import type { ThemeColors } from './TypingIndicator';
import { findMatchRanges, toHighlightSegments } from './HighlightedText';
import { Colors, FontFamily } from '../../constants/theme';

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

export const MarkdownText = React.memo(function MarkdownText({
  content,
  colors,
  highlightQuery,
  highlightActive,
}: Props) {
  const tokens = useMemo(() => {
    try {
      return getMd().parse(content, {}) as TokenNode[];
    } catch {
      return [];
    }
  }, [content]);

  const renderTokens = useCallback(
    (tokens: TokenNode[]): React.ReactNode[] => {
      const hl = highlightQuery?.trim()
        ? { query: highlightQuery, active: highlightActive ?? false }
        : undefined;
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
          elements.push(
            <Text key={i} style={[styles.paragraph, { color: colors.textPrimary }]}>
              {renderInline(token.children ?? [], colors, i, hl)}
            </Text>,
          );
          continue;
        }
        if (token.type === 'heading_open') {
          const level = token.tag?.toString().replace('h', '') ?? '1';
          const sizeMap: Record<string, number> = { '1': 22, '2': 18, '3': 16, '4': 14 };
          const size = sizeMap[level] ?? 14;
          const inlineToken = tokens[i + 1];
          if (inlineToken?.type === 'inline') {
            elements.push(
              <Text
                key={i}
                style={[styles.heading, { fontSize: size, color: colors.textPrimary }]}
              >
                {renderInline(inlineToken.children ?? [], colors, i, hl)}
              </Text>,
            );
            i += 2;
          }
          continue;
        }
        if (token.type === 'code_block' || token.type === 'fence') {
          const code = token.content ?? '';
          elements.push(
            <View key={i} style={[styles.codeBlock, { backgroundColor: colors.subtle }]}>
              <Text style={[styles.codeText, { color: colors.textPrimary }]}>{code}</Text>
            </View>,
          );
          continue;
        }
        if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
          const ordered = token.type === 'ordered_list_open';
          const items: React.ReactNode[] = [];
          let j = i + 1;
          let n = 0;
          while (
            j < tokens.length &&
            tokens[j].type !== 'bullet_list_close' &&
            tokens[j].type !== 'ordered_list_close'
          ) {
            if (tokens[j].type === 'list_item_open') {
              n += 1;
              // A list item wraps its inline content one level deeper
              // (paragraph_open → inline); find the first inline descendant.
              const inlineToken = tokens[j + 1]?.type === 'inline'
                ? tokens[j + 1]
                : tokens[j + 2]?.type === 'inline'
                  ? tokens[j + 2]
                  : undefined;
              if (inlineToken) {
                items.push(
                  <View key={j} style={styles.listItem}>
                    <Text style={[styles.bullet, { color: colors.textTertiary }]}>
                      {ordered ? `${n}.` : '\u2022'}
                    </Text>
                    <Text style={[styles.listText, { color: colors.textPrimary }]}>
                      {renderInline(inlineToken.children ?? [], colors, j, hl)}
                    </Text>
                  </View>,
                );
              }
              j += 3;
            } else {
              j++;
            }
          }
          elements.push(
            <View key={i} style={styles.list}>
              {items}
            </View>,
          );
          i = j;
          continue;
        }
        if (token.type === 'blockquote_open') {
          const inlineToken = tokens[i + 1];
          if (inlineToken?.type === 'inline') {
            elements.push(
              <View
                key={i}
                style={[styles.blockquote, { borderLeftColor: colors.textTertiary }]}
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
          const { node, next } = renderTable(tokens, i + 1, colors);
          elements.push(node);
          i = next - 1;
          continue;
        }
      }
      return elements;
    },
    [colors, highlightQuery, highlightActive],
  );

  return <View>{renderTokens(tokens)}</View>;
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
                    <Text
                      key={si}
                      style={
                        hl.active
                          ? styles.markActive
                          : styles.mark
                      }
                    >
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
            {renderInline(children.slice(i + 1, close === -1 ? children.length : close), colors, i, hl)}
          </Text>,
        );
        i = close === -1 ? children.length : close + 1;
        break;
      }
      case 'em_open': {
        const close = findClose(children, i, 'em_close');
        out.push(
          <Text key={key} style={styles.em}>
            {renderInline(children.slice(i + 1, close === -1 ? children.length : close), colors, i, hl)}
          </Text>,
        );
        i = close === -1 ? children.length : close + 1;
        break;
      }
      case 's_open': {
        const close = findClose(children, i, 's_close');
        out.push(
          <Text key={key} style={styles.strikethrough}>
            {renderInline(children.slice(i + 1, close === -1 ? children.length : close), colors, i, hl)}
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
            {renderInline(children.slice(i + 1, close === -1 ? children.length : close), colors, i, hl)}
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
  paragraph: {
    fontSize: 14,
    lineHeight: 20,
  },
  heading: {
    fontWeight: '600',
    marginTop: 8,
    lineHeight: 22,
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
    borderRadius: 8,
    padding: 12,
    marginVertical: 4,
  },
  codeText: {
    fontFamily: FontFamily.mono,
    fontSize: 13,
    lineHeight: 18,
  },
  inlineCode: {
    fontFamily: FontFamily.mono,
    fontSize: 13,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  list: {
    gap: 2,
    marginTop: 4,
    marginBottom: 4,
  },
  listItem: {
    flexDirection: 'row',
    gap: 8,
    paddingLeft: 8,
  },
  bullet: {
    fontSize: 14,
    lineHeight: 20,
    minWidth: 16,
  },
  listText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  blockquote: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    marginVertical: 4,
  },
  blockquoteText: {
    fontSize: 14,
    lineHeight: 20,
  },
  hr: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 10,
  },
  table: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.35)',
    marginVertical: 4,
    minWidth: '100%',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.35)',
  },
  tableCell: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 17,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minWidth: 90,
  },
  tableCellHeader: {
    fontWeight: '600',
  },
});
