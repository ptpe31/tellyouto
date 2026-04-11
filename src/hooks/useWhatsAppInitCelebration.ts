import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useURL } from 'expo-linking';
import { useCallback, useEffect, useRef, useState } from 'react';

import { parseTellyoutoDeepLink } from '../services/connectorLinks';

type TabName = 'radar' | 'timeline';

/**
 * Affiche la célébration « Connexion réussie » quand l’utilisateur revient via
 * `tellyouto://radar?from=whatsapp_init` ou des params de navigation équivalents.
 */
export function useWhatsAppInitCelebration(tab: TabName): {
  visible: boolean;
  dismiss: () => void;
} {
  const route = useRoute();
  const navigation = useNavigation();
  const url = useURL();
  const [visible, setVisible] = useState(false);
  const consumedUrls = useRef<Set<string>>(new Set());

  const tryShow = useCallback(() => {
    const p = route.params as { from?: string } | undefined;
    if (p?.from === 'whatsapp_init') {
      setVisible(true);
      navigation.setParams({ from: undefined } as never);
      return;
    }
    if (!url) return;
    const parsed = parseTellyoutoDeepLink(url);
    if (
      parsed?.tab === tab &&
      parsed.query.from === 'whatsapp_init' &&
      !consumedUrls.current.has(url)
    ) {
      consumedUrls.current.add(url);
      setVisible(true);
    }
  }, [navigation, route.params, tab, url]);

  useEffect(() => {
    tryShow();
  }, [tryShow]);

  useFocusEffect(
    useCallback(() => {
      tryShow();
    }, [tryShow]),
  );

  const dismiss = useCallback(() => setVisible(false), []);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(t);
  }, [visible]);

  return { visible, dismiss };
}
