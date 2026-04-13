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
              Radar: {
                path: 'radar',
                parse: {
                  from: (value: string) => value ?? undefined,
                },
              },
              Timeline: {
                path: 'timeline',
                parse: {
                  from: (value: string) => value ?? undefined,
                },
              },
              Recharge: 'recharge',
            },
          },
        },
      },
    },
  },
};
