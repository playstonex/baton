import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';

/**
 * File/directory list icon: a quiet rounded tile that carries type at a
 * glance — filled folder glyph for directories, an uppercase extension
 * monogram ("TS", "JSON", "MD"…) for files. Replaces the old mix of emoji
 * folders and mismatched vendor logos.
 */

interface FileIconTileProps {
  isDir: boolean;
  /** File name (extension is derived internally). */
  name: string;
  /** 'md' for file-browser rows, 'sm' for compact pickers. */
  size?: 'sm' | 'md';
}

interface Family {
  color: string;
  /** Short monogram; defaults to the uppercased extension. */
  label?: string;
}

const FAMILY_BY_EXT: Record<string, Family> = {
  ts: { color: '#5E6AD2' },
  tsx: { color: '#5E6AD2' },
  js: { color: '#B7BA24' },
  jsx: { color: '#61DAFB' },
  mjs: { color: '#B7BA24' },
  cjs: { color: '#B7BA24' },
  json: { color: '#D97706' },
  md: { color: '#64748B' },
  mdx: { color: '#64748B' },
  txt: { color: '#64748B' },
  log: { color: '#64748B' },
  py: { color: '#3572A5' },
  rb: { color: '#CC342D' },
  rs: { color: '#CE7150' },
  go: { color: '#00ADD8' },
  sh: { color: '#4EAA25', label: 'SH' },
  bash: { color: '#4EAA25', label: 'SH' },
  zsh: { color: '#4EAA25', label: 'SH' },
  css: { color: '#2563EB' },
  scss: { color: '#C2578E' },
  less: { color: '#2563EB' },
  html: { color: '#E34C26' },
  vue: { color: '#42B883' },
  svelte: { color: '#FF6259' },
  yml: { color: '#E11D48' },
  yaml: { color: '#E11D48' },
  toml: { color: '#E11D48' },
  ini: { color: '#E11D48' },
  conf: { color: '#E11D48' },
  env: { color: '#CA8A04' },
  sql: { color: '#336791' },
  png: { color: '#8B5CF6' },
  jpg: { color: '#8B5CF6' },
  jpeg: { color: '#8B5CF6' },
  gif: { color: '#8B5CF6' },
  webp: { color: '#8B5CF6' },
  svg: { color: '#8B5CF6' },
  ico: { color: '#8B5CF6' },
  pdf: { color: '#DC2626', label: 'PDF' },
  zip: { color: '#CA8A04' },
  gz: { color: '#CA8A04' },
  lock: { color: '#6E7681' },
  gitignore: { color: '#F05032' },
};

const FALLBACK: Family = { color: '#64748B' };

export function fileFamily(name: string): Family {
  const parts = name.split('.');
  if (parts.length < 2) return FALLBACK;
  const ext = parts.pop()!.toLowerCase();
  // Dotfiles like ".gitignore" and ".env" have no real extension.
  if (name.startsWith('.') && parts[0] === '') {
    return FAMILY_BY_EXT[name.slice(1).toLowerCase()] ?? FALLBACK;
  }
  return FAMILY_BY_EXT[ext] ?? FALLBACK;
}

export function FileIconTile({ isDir, name, size = 'md' }: FileIconTileProps) {
  const tile = size === 'md' ? styles.tileMd : styles.tileSm;
  if (isDir) {
    return (
      <View style={[tile, styles.center, { backgroundColor: 'rgba(94,106,210,0.12)' }]}>
        <Ionicons
          name="folder"
          size={size === 'md' ? 17 : 15}
          color="#5E6AD2"
        />
      </View>
    );
  }
  const family = fileFamily(name);
  const ext = name.split('.').pop() ?? '';
  const label = (family.label ?? ext).toUpperCase().slice(0, 4);
  return (
    <View
      style={[
        tile,
        styles.center,
        {
          backgroundColor: family.color + '17',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: family.color + '33',
        },
      ]}
    >
      <Text
        style={[
          size === 'md' ? styles.monogramMd : styles.monogramSm,
          { color: family.color },
        ]}
        numberOfLines={1}
      >
        {label || 'FILE'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  tileMd: {
    width: 34,
    height: 34,
    borderRadius: 9,
  },
  tileSm: {
    width: 28,
    height: 28,
    borderRadius: 7,
  },
  monogramMd: {
    fontSize: 9,
    fontWeight: '800',
    fontFamily: 'JetBrainsMono_600SemiBold',
    letterSpacing: 0.2,
  },
  monogramSm: {
    fontSize: 7,
    fontWeight: '800',
    fontFamily: 'JetBrainsMono_600SemiBold',
    letterSpacing: 0.1,
  },
});
