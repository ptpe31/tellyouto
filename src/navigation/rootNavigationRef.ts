/**
 * Référence globale au `NavigationContainer` (ex. ouvrir `ProSubscription` depuis un écran sans props navigation).
 *
 * @module navigation/rootNavigationRef
 */
import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './types';

export const rootNavigationRef =
  createNavigationContainerRef<RootStackParamList>();
