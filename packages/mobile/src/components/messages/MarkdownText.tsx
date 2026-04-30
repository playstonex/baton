import React, { useMemo, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ThemeColors } from './TypingIndicator';

interface Props {
  content: string;
  colors: ThemeColors;
  isStreaming?: boolean;
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
  [key: string]: unknown;
}

export const MarkdownText = React.memo(function MarkdownText({ content, colors }: Props) {
  const tokens = useMemo(() => {
    try {
      const MarkdownIt = require('markdown-it');
      const md = MarkdownIt({ html: false, linkify: true, breaks: true });
      return md.parse(content, {});
    } catch {
      return [];
    }
  }, [content]);

  const renderTokens = useCallback(
    (tokens: TokenNode[]): React.ReactNode[] => {
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
              {renderInline(token.children ?? [], colors, i)}
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
                {renderInline(inlineToken.children ?? [], colors, i)}
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
              <Text style={styles.codeText}>{code}</Text>
            </View>,
          );
          continue;
        }
        if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
          const items: React.ReactNode[] = [];
          let j = i + 1;
          while (j < tokens.length && tokens[j].type !== 'bullet_list_close' && tokens[j].type !== 'ordered_list_close') {
            if (tokens[j].type === 'list_item_open') {
              const inlineToken = tokens[j + 1];
              if (inlineToken?.type === 'inline') {
                items.push(
                  <View key={j} style={styles.listItem}>
                    <Text style={[styles.bullet, { color: colors.textTertiary }]}>{'\u2022'}</Text>
                    <Text style={[styles.listText, { color: colors.textPrimary }]}>
                      {renderInline(inlineToken.children ?? [], colors, j)}
                    </Text>
                  </View>,
                );
              }
              j += 3;
            } else {
              j++;
            }
          }
          elements.push(<View key={i} style={styles.list}>{items}</View>);
          i = j;
          continue;
        }
        if (token.type === 'blockquote_open') {
          const inlineToken = tokens[i + 1];
          if (inlineToken?.type === 'inline') {
            elements.push(
              <View key={i} style={[styles.blockquote, { borderLeftColor: colors.textTertiary }]}>
                <Text style={[styles.blockquoteText, { color: colors.textSecondary }]}>
                  {renderInline(inlineToken.children ?? [], colors, i)}
                </Text>
              </View>,
            );
            i += 2;
          }
          continue;
        }
      }
      return elements;
    },
    [colors],
  );

  return <View>{renderTokens(tokens)}</View>;
});

function renderInline(children: TokenNode[], colors: ThemeColors, baseKey: number): React.ReactNode[] {
  return children.map((child, idx) => {
    const key = `${baseKey}-${idx}`;
    if (child.type === 'text') {
      return <Text key={key}>{child.content}</Text>;
    }
    if (child.type === 'strong_open' || child.type === 'strong_close') {
      return null;
    }
    if (child.type === 'em_open' || child.type === 'em_open') {
      return null;
    }
    if (child.type === 'softbreak' || child.type === 'hardbreak') {
      return <Text key={key}>{'\n'}</Text>;
    }
    if (child.type === 'code_inline') {
      return (
        <Text key={key} style={[styles.inlineCode, { backgroundColor: colors.subtle }]}>
          {child.content}
        </Text>
      );
    }
    if (child.type === 'link_open') {
      return null;
    }
    if (child.type === 'link_close') {
      return null;
    }
    if (child.type === 'text' && child.content) {
      return <Text key={key}>{child.content}</Text>;
    }
    if (child.content) {
      return <Text key={key}>{child.content}</Text>;
    }
    return null;
  });
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
  codeBlock: {
    borderRadius: 8,
    padding: 12,
    marginVertical: 4,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#e8e8e8',
    lineHeight: 18,
  },
  inlineCode: {
    fontFamily: 'monospace',
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
});
