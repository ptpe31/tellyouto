/**
 * Deep linking : préfixes Expo + schème `APP_SCHEME`, mapping vers les tabs.
 * Chemins utiles : `…/home` → TalkDebug, `…/timeline` → Timeline, `…/debug` → Debug (`PROJECT_STATUS.md` §1.2).
 * Intégration `expo-share-intent` pour cold-start / background share (iOS + Android).
 *
 * @module navigation/linking
 */
import {
  getStateFromPath as defaultGetStateFromPath,
  type LinkingOptions,
} from '@react-navigation/native';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import {
  ShareIntentModule,
  getScheme,
  getShareExtensionKey,
} from 'expo-share-intent';

import { APP_SCHEME } from '../services/connectorLinks';
import type { RootStackParamList } from './types';

const PACKAGE_NAME =
  Constants.expoConfig?.android?.package || Constants.expoConfig?.ios?.bundleIdentifier;

const shareIntentHomePath = {
  routes: [
    {
      name: 'App' as const,
      state: {
        routes: [
          {
            name: 'Tabs' as const,
            state: {
              routes: [{ name: 'TalkDebug' as const }],
            },
          },
        ],
      },
    },
  ],
};

export const appLinking: LinkingOptions<RootStackParamList> = {
  prefixes: [
    Linking.createURL('/'),
    `${APP_SCHEME}://`,
    ...(PACKAGE_NAME ? [`${PACKAGE_NAME}://`] : []),
  ],
  config: {
    screens: {
      App: {
        path: '',
        screens: {
          Tabs: {
            path: '',
            screens: {
              TalkDebug: 'home',
              Timeline: {
                path: 'timeline',
                parse: {
                  from: (value: string) => value ?? undefined,
                },
              },
              Debug: 'debug',
            },
          },
        },
      },
    },
  },
  getStateFromPath(path, config) {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) {
      return shareIntentHomePath;
    }
    return defaultGetStateFromPath(path, config);
  },
  subscribe(listener) {
    const scheme = getScheme() || APP_SCHEME;
    const onReceiveURL = ({ url }: { url: string }) => {
      if (url.includes(getShareExtensionKey())) {
        listener(`${scheme}://home`);
      } else {
        listener(url);
      }
    };

    const shareIntentStateSubscription = ShareIntentModule?.addListener('onStateChange', (event) => {
      if (event.value === 'pending') {
        listener(`${scheme}://home`);
      }
    });

    const shareIntentValueSubscription = ShareIntentModule?.addListener('onChange', async () => {
      const url = await appLinking.getInitialURL?.();
      if (url) onReceiveURL({ url });
    });

    const urlEventSubscription = Linking.addEventListener('url', onReceiveURL);

    return () => {
      shareIntentStateSubscription?.remove();
      shareIntentValueSubscription?.remove();
      urlEventSubscription.remove();
    };
  },
  async getInitialURL() {
    const needRedirect = ShareIntentModule?.hasShareIntent(getShareExtensionKey());
    const scheme = getScheme() || APP_SCHEME;
    if (needRedirect) {
      return `${scheme}://home`;
    }
    return (await Linking.getInitialURL()) ?? undefined;
  },
};
