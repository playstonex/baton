import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';

import { useThemeStore } from '../stores/theme';

/**
 * Handle inbound deep links of the form `baton://session/<sessionId>`.
 *
 * Two entry points:
 *  - Cold launch: `Linking.getInitialURL()` — the URL that launched the app.
 *  - Warm launch: `Linking.addEventListener('url')` — fires while the app runs
 *    (e.g. tapping a notification that emits a baton:// URL, or another app
 *    opening a link).
 *
 * Both feed into `navigateToSession`, which routes to the chat screen for the
 * session. The scheme `baton` is registered in app.json.
 */
export function useDeepLinking(): void {
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    function navigateToSession(sessionId: string) {
      if (!mounted) return;
      router.navigate(`/chat/${sessionId}`);
    }

    function handleUrl(url: string | null) {
      if (!url) return;
      // Dev automation hook (simulator screenshot tours): baton://theme/light
      // and baton://theme/dark flip the theme. Dev builds only.
      if (__DEV__ && url.startsWith('baton://theme/')) {
        const mode = url.slice('baton://theme/'.length);
        if (mode === 'light' || mode === 'dark') {
          useThemeStore.getState().setTheme(mode);
        }
        return;
      }
      const parsed = parseSessionUrl(url);
      if (parsed) navigateToSession(parsed);
    }

    // Cold launch.
    Linking.getInitialURL()
      .then(handleUrl)
      .catch(() => {
        // ignore — malformed initial URL
      });

    // Warm launch.
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));

    return () => {
      mounted = false;
      sub.remove();
    };
  }, [router]);
}

/**
 * Parse `baton://session/<id>` (or `baton:///session/<id>`) → sessionId.
 * Returns null for unrecognized URLs so unrelated links are ignored.
 */
export function parseSessionUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'baton:') return null;
    // pathname may be "/session/<id>" or "session/<id>"
    const segments = parsed.pathname.replace(/^\/+/, '').split('/');
    if (segments[0] !== 'session' || segments.length < 2) return null;
    const id = segments.slice(1).join('/');
    return id || null;
  } catch {
    return null;
  }
}
