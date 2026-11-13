import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  interpolate,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatSidebar } from './ChatSidebar';
import { useThemeColors } from '../hooks/useThemeColors';
import { useLayoutStore } from '../stores/layout';

const DUO_WIDE_BREAKPOINT = 600;
const SPRING_CONFIG = { damping: 24, stiffness: 300, mass: 0.9 };

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
  const sidebarWidth = isWide ? Math.min(320, Math.max(280, Math.floor(width * 0.33))) : Math.min(320, width * 0.82);

  const sidebarOpen = useLayoutStore((s) => s.sidebarOpen);
  const setSidebarOpen = useLayoutStore((s) => s.setSidebarOpen);
  const sidebarPinned = useLayoutStore((s) => s.sidebarPinned);
  const setSidebarPinned = useLayoutStore((s) => s.setSidebarPinned);

  const [drawerRendered, setDrawerRendered] = useState(false);
  const drawerProgress = useSharedValue(0);

  // Animate drawer progress for compact mode
  useEffect(() => {
    if (!isWide) {
      if (sidebarOpen) {
        setDrawerRendered(true);
        drawerProgress.value = withSpring(1, SPRING_CONFIG);
      } else {
        drawerProgress.value = withTiming(
          0,
          { duration: 200, easing: Easing.in(Easing.cubic) },
          (finished) => {
            if (finished) {
              runOnJS(setDrawerRendered)(false);
            }
          },
        );
      }
    }
  }, [sidebarOpen, isWide, drawerProgress]);

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
          translateX: interpolate(drawerProgress.value, [0, 1], [-sidebarWidth, 0]),
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

          {/* Slide-out Drawer Overlay */}
          {drawerRendered && (
            <View style={StyleSheet.absoluteFill} pointerEvents={sidebarOpen ? 'auto' : 'none'}>
              {/* Dimmed Backdrop */}
              <Animated.View
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: 'rgba(0, 0, 0, 0.45)' },
                  backdropAnimatedStyle,
                ]}
              >
                <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} />
              </Animated.View>

              {/* Drawer Content */}
              <Animated.View
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
