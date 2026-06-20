import { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  Dimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../src/hooks/useThemeColors';
import {
  GlassCard,
  GlassButton,
  GlassDivider,
} from '../src/components/GlassKit';
import { Typography, Spacing, Glass, Colors } from '../src/constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const SLIDES = [
  {
    icon: 'sparkles',
    title: 'Welcome to Baton',
    subtitle: 'Your AI agent command center',
    description:
      'Spawn, observe, and control coding agents — Claude Code, Codex, OpenCode — right from your phone.',
  },
  {
    icon: 'wifi',
    title: 'Connect Anywhere',
    subtitle: 'Local or remote',
    description:
      'Pair with your daemon over local network or connect remotely via relay with E2E encryption.',
  },
  {
    icon: 'terminal',
    title: 'Live Terminal',
    subtitle: 'Real-time control',
    description:
      'Watch your agents work in real-time. See tool calls, file changes, and thinking state as they happen.',
  },
  {
    icon: 'git-network',
    title: 'Pipeline Orchestration',
    subtitle: 'Chain agents together',
    description:
      'Create multi-step pipelines that chain agents sequentially. Auto-advance on completion.',
  },
  {
    icon: 'checkmark-circle',
    title: 'Ready to Go',
    subtitle: 'The power is yours',
    description:
      'Launch your first agent session and start coding. You can always revisit this guide in Settings.',
  },
];

function Slide({
  item,
  c,
}: {
  item: (typeof SLIDES)[0];
  c: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
      <View style={styles.slideContent}>
        <GlassCard c={c} style={styles.iconCard}>
          <Ionicons name={item.icon as any} size={48} color={Colors.primary[500]} />
        </GlassCard>
        <Text style={[styles.title, { color: c.textPrimary }]}>{item.title}</Text>
        <Text style={[styles.subtitle, { color: Colors.primary[500] }]}>{item.subtitle}</Text>
        <Text style={[styles.description, { color: c.textSecondary }]}>{item.description}</Text>
      </View>
    </View>
  );
}

export default function OnboardingScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatRef = useRef<FlatList>(null);
  const isLast = currentIndex === SLIDES.length - 1;

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setCurrentIndex(idx);
  }, []);

  const goNext = useCallback(() => {
    if (isLast) {
      router.replace('/(tabs)');
    } else {
      flatRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
    }
  }, [isLast, currentIndex, router]);

  const skip = useCallback(() => {
    router.replace('/(tabs)');
  }, [router]);

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={c.isDark ? 'light' : 'dark'} />

      <FlatList
        ref={flatRef}
        data={SLIDES}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        bounces={false}
        renderItem={({ item }) => <Slide item={item} c={c} />}
      />

      {/* Progress dots */}
      <View style={[styles.dotsContainer, { bottom: insets.bottom + 140 }]}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              {
                backgroundColor:
                  i === currentIndex ? Colors.primary[500] : c.isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)',
                width: i === currentIndex ? 24 : 8,
              },
            ]}
          />
        ))}
      </View>

      {/* Bottom controls */}
      <BlurView
        tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
        intensity={Glass.blur.nav}
        style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.lg }]}
      >
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: c.isDark ? Glass.opacity.dark.surface : Glass.opacity.light.surface },
          ]}
          pointerEvents="none"
        />
        <View style={styles.bottomRow}>
          {!isLast ? (
            <Pressable onPress={skip} hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}>
              <Text style={[Typography.subhead, { color: c.textSecondary, fontWeight: '500' }]}>Skip</Text>
            </Pressable>
          ) : (
            <View />
          )}
          <GlassButton
            c={c}
            label={isLast ? 'Get Started' : 'Next'}
            icon={isLast ? 'checkmark' : 'arrow-forward'}
            onPress={goNext}
            variant="primary"
            style={styles.ctaGlass}
          />
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  slide: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  slideContent: {
    alignItems: 'center',
    paddingHorizontal: Spacing['3xl'],
    gap: Spacing.lg,
  },
  iconCard: {
    width: 100,
    height: 100,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  title: {
    ...Typography.title1,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    ...Typography.headline,
    textAlign: 'center',
    marginTop: -Spacing.sm,
  },
  description: {
    ...Typography.body,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: Spacing.lg,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
    position: 'absolute',
    left: 0,
    right: 0,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ctaGlass: {
    minWidth: 160,
  },
});
