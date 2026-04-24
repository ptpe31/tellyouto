import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './types';

export const rootNavigationRef =
  createNavigationContainerRef<RootStackParamList>();
