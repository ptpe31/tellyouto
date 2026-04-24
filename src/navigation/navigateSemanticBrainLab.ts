type MinimalNavigation = {
  getState: () => { routeNames?: string[] } | undefined;
  navigate: (name: string) => void;
  getParent?: () => MinimalNavigation | undefined;
};

/**
 * Ouvre SemanticBrainLab depuis un écran enfant (ex. onglet Stats) en remontant
 * jusqu’au stack qui déclare la route.
 */
export function navigateToSemanticBrainLab(navigation: {
  getParent: () => MinimalNavigation | undefined;
}): void {
  let parent: MinimalNavigation | undefined = navigation.getParent();
  while (parent) {
    const names = parent.getState?.()?.routeNames;
    if (names?.includes('SemanticBrainLab')) {
      parent.navigate('SemanticBrainLab');
      return;
    }
    parent = parent.getParent?.();
  }
}
