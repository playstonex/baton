import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolate,
  Extrapolation,
  runOnJS,
} from 'react-native-reanimated';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatSidebar } from './ChatSidebar';
import { useThemeColors } from '../hooks/useThemeColors';
import { useLayoutStore } from '../stores/layout';

const DUO_WIDE_BREAKPOINT = 600;
// One spring for open and close so the drawer moves the same way in both
// directions; overshoot is clamped so it never pulls past either edge.
const SPRING_CONFIG = { damping: 26, stiffness: 260, mass: 0.9, overshootClamping: true };
/** Fling speed (pt/s) that decides open/close regardless of position. */
const FLING_VELOCITY = 500;
/** Width of the left-edge strip that starts an open-drag on the root screen. */
const EDGE_WIDTH = 20;

interface SidebarLayoutProps {
  currentSessionId?: string;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  children: (props: {
    isWide: boolean;
    openSidebar: () => void;
    toggleSidebar: () => void;
    sidebarOpen: boolean;
  }) => React.ReactNode;
}

export function SidebarLayout({
  currentSessionId,
  onSelectSession,
  onNewChat,
  children,
}: SidebarLayoutProps) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Wide screen breakpoint for iPhone Duo inner display (951pt landscape / 669pt portrait), iPad, and tablets.
  const isWide = width >= DUO_WIDE_BREAKPOINT;

  // Responsive sidebar width: on Duo (951pt), ~310pt fits standard list-detail sizing while leaving fold (475.5pt) clear.
  const sidebarWidth = isWide
    ? Math.min(320, Math.max(280, Math.floor(width * 0.33)))
    : Math.min(320, width * 0.82);

  const sidebarOpen = useLayoutStore((s) => s.sidebarOpen);
  const setSidebarOpen = useLayoutStore((s) => s.setSidebarOpen);
  const sidebarPinned = useLayoutStore((s) => s.sidebarPinned);
  const setSidebarPinned = useLayoutStore((s) => s.setSidebarPinned);

  const [drawerRendered, setDrawerRendered] = useState(false);
  const drawerProgress = useSharedValue(0);
  const dragStart = useSharedValue(0);
  // Set when a drag already started the settle animation, so the store-driven
  // effect below doesn't restart it (and drop the fling velocity).
  const settledByGesture = useRef(false);

  // On a pushed screen the left edge belongs to the native back-swipe.
  const router = useRouter();
  const edgeSwipeToOpen = !router.canGoBack();

  // Animate drawer progress for compact mode
  useEffect(() => {
    if (isWide) return;
    if (sidebarOpen) setDrawerRendered(true);
    if (settledByGesture.current) {
      settledByGesture.current = false;
      return;
    }
    drawerProgress.value = withSpring(sidebarOpen ? 1 : 0, SPRING_CONFIG, (finished) => {
      if (finished && !sidebarOpen) runOnJS(setDrawerRendered)(false);
    });
  }, [sidebarOpen, isWide, drawerProgress]);

  const finishDrag = useCallback(
    (open: boolean) => {
      if (open !== useLayoutStore.getState().sidebarOpen) settledByGesture.current = true;
      setSidebarOpen(open);
      if (!open) setDrawerRendered(false);
    },
    [setSidebarOpen],
  );

  // Horizontal drag that follows the finger, then settles by fling velocity or
  // by how far it got. Vertical movement fails it so list scrolling still works.
  const dragConfig = {
    activeOffsetX: [-10, 10],
    failOffsetY: [-15, 15],
    onActivate: () => {
      'worklet';
      dragStart.value = drawerProgress.value;
      runOnJS(setDrawerRendered)(true);
    },
    onUpdate: (e) => {
      'worklet';
      const next = dragStart.value + e.translationX / sidebarWidth;
      drawerProgress.value = Math.min(1, Math.max(0, next));
    },
    onDeactivate: (e) => {
      'worklet';
      const open =
        e.velocityX > FLING_VELOCITY
          ? true
          : e.velocityX < -FLING_VELOCITY
            ? false
            : drawerProgress.value > 0.5;
      drawerProgress.value = withSpring(
        open ? 1 : 0,
        { ...SPRING_CONFIG, velocity: e.velocityX / sidebarWidth },
        (finished) => {
          if (finished) runOnJS(finishDrag)(open);
        },
      );
      if (open) runOnJS(finishDrag)(true);
    },
  } satisfies Parameters<typeof usePanGesture>[0];
  // Two instances: a gesture object can only be attached to one detector, and
  // the edge strip stays mounted while its drag brings the drawer in.
  const edgeGesture = usePanGesture(dragConfig);
  const drawerGesture = usePanGesture(dragConfig);

  const openSidebar = useCallback(() => {
    if (isWide) {
      setSidebarPinned(true);
    } else {
      setSidebarOpen(true);
    }
  }, [isWide, setSidebarPinned, setSidebarOpen]);

  const toggleSidebar = useCallback(() => {
    if (isWide) {
      setSidebarPinned(!sidebarPinned);
    } else {
      setSidebarOpen(!sidebarOpen);
    }
  }, [isWide, sidebarPinned, sidebarOpen, setSidebarPinned, setSidebarOpen]);

  const closeDrawer = useCallback(() => {
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  // Wide sidebar animated collapse/expand style
  const wideSidebarStyle = useAnimatedStyle(() => {
    return {
      width: sidebarPinned ? sidebarWidth : 0,
      opacity: sidebarPinned ? 1 : 0,
    };
  }, [sidebarPinned, sidebarWidth]);

  // Compact drawer animation style
  const drawerAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {
          translateX: interpolate(
            drawerProgress.value,
            [0, 1],
            [-sidebarWidth, 0],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  });

  const backdropAnimatedStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(drawerProgress.value, [0, 1], [0, 1]),
    };
  });

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      {isWide ? (
        // ── DUAL PANE MODE (iPhone Duo Unfolded / iPad / Desktop) ──────────
        <View style={styles.dualPaneContainer}>
          {/* Left Pane: Sidebar */}
          {sidebarPinned && (
            <Animated.View
              style={[
                styles.wideSidebarPane,
                {
                  borderRightColor: c.separator,
                },
                wideSidebarStyle,
              ]}
            >
              <ChatSidebar
                currentSessionId={currentSessionId}
                onSelectSession={onSelectSession}
                onNewChat={onNewChat}
                onClose={() => setSidebarPinned(false)}
                isWide={true}
              />
            </Animated.View>
          )}

          {/* Right Pane: Content / Active Chat */}
          {/* Note: iPhone Duo trailing edge has an 84pt vertical bar, absorbed by insets.right */}
          <View style={[styles.dualPaneMain, { paddingRight: insets.right }]}>
            {children({
              isWide: true,
              openSidebar,
              toggleSidebar,
              sidebarOpen: sidebarPinned,
            })}
          </View>
        </View>
      ) : (
        // ── SINGLE PANE MODE (iPhone Air / Duo Closed / Phone) ─────────────
        <View style={styles.singlePaneContainer}>
          {/* Main Content */}
          {children({
            isWide: false,
            openSidebar,
            toggleSidebar,
            sidebarOpen,
          })}

          {/* Left-edge strip: drag right to pull the drawer out. */}
          {edgeSwipeToOpen && !sidebarOpen && (
            <GestureDetector gesture={edgeGesture}>
              <View style={[styles.edgeStrip, { width: EDGE_WIDTH + insets.left }]} />
            </GestureDetector>
          )}

          {/* Slide-out Drawer Overlay */}
          {drawerRendered && (
            <GestureDetector gesture={drawerGesture}>
              <View
                style={StyleSheet.absoluteFill}
                pointerEvents={sidebarOpen ? 'auto' : 'box-none'}
              >
                {/* Dimmed Backdrop */}
                <Animated.View
                  pointerEvents={sidebarOpen ? 'auto' : 'none'}
                  style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: 'rgba(0, 0, 0, 0.45)' },
                    backdropAnimatedStyle,
                  ]}
                >
                  <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={closeDrawer}
                    accessibilityRole="button"
                    accessibilityLabel="Close sidebar"
                  />
                </Animated.View>

                {/* Drawer Content */}
                <Animated.View
                  pointerEvents={sidebarOpen ? 'auto' : 'none'}
                  style={[
                    styles.drawerSheet,
                    {
                      width: sidebarWidth,
                      borderRightColor: c.separator,
                    },
                    drawerAnimatedStyle,
                  ]}
                >
                  <ChatSidebar
                    currentSessionId={currentSessionId}
                    onSelectSession={onSelectSession}
                    onNewChat={onNewChat}
                    onClose={closeDrawer}
                    isWide={false}
                  />
                </Animated.View>
              </View>
            </GestureDetector>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  dualPaneContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  wideSidebarPane: {
    height: '100%',
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  dualPaneMain: {
    flex: 1,
    height: '100%',
  },
  singlePaneContainer: {
    flex: 1,
  },
  edgeStrip: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
  drawerSheet: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 16,
  },
});
