import * as ReactNative from 'react-native';

/**
 * Accès à `Platform` via le module namespace — évite sur Hermes/Metro un
 * `ReferenceError: Property 'Platform' doesn't exist` lié à l’import nommé.
 */
export const Platform = ReactNative.Platform;
