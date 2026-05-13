/**
 * Deep linking : préfixes Expo + schème `APP_SCHEME`, mapping vers les tabs.
 * Chemins utiles : `…/home` → TalkDebug, `…/timeline` → Timeline, `…/debug` → Debug (`PROJECT_STATUS.md` §1.2).
 *
 * @module navigation/linking
 */
import * as Linking from 'expo-linking';

import { APP_SCHEME } from '../services/connectorLinks';

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
