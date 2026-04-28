import * as Linking from 'expo-linking';

import { APP_SCHEME } from '../services/connectorLinks';

/**
 * Préfixes + mapping pour `tellyouto://radar` → onglet Radar, etc.
 */
export const appLinking = {
  prefixes: [
    Linking.createURL('/'),
    `${APP_SCHEME}://`,
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
};
