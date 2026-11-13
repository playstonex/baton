import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';

import { useThemeStore } from '../stores/theme';
import { wsService } from '../services/websocket';
import { parseSessionUrl, type ParsedSessionUrl } from './parseSessionUrl';

export type { ParsedSessionUrl };
export { parseSessionUrl };

/**
 * Handle inbound deep links of the form `baton://session/<sessionId>` or `baton://agent/<sessionId>`.
 * Also supports action parameters like `?action=approve` and `?action=reject` from Live Activities.
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
      // Dev automation hook: baton://theme/light and baton://theme/dark
      if (__DEV__ && url.startsWith('baton://theme/')) {
        const mode = url.slice('baton://theme/'.length);
        if (mode === 'light' || mode === 'dark') {
          useThemeStore.getState().setTheme(mode);
        }
        return;
      }
      const parsed = parseSessionUrl(url);
      if (parsed) {
        if (parsed.action === 'approve') {
          wsService.send({
            type: 'approve_input',
            sessionId: parsed.sessionId,
            reason: 'Approved via Live Activity',
          });
        } else if (parsed.action === 'reject') {
          wsService.send({
            type: 'reject_input',
            sessionId: parsed.sessionId,
            reason: 'Rejected via Live Activity',
          });
        }
        navigateToSession(parsed.sessionId);
      }
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
