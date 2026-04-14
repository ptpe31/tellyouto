import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Platform } from '../utils/rnPlatform';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '../theme/colors';
import { reloadApplication } from '../utils/reloadApp';
import { saveEmergencyLog } from '../api/trankilV2Db';

type Props = { children: ReactNode };

type State = { hasError: boolean; message: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      message: __DEV__ && error?.message ? error.message : '',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void saveEmergencyLog(error?.message ?? 'Unknown error', info.componentStack ?? '');
    if (__DEV__) {
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallbackScreen
          devDetail={this.state.message}
          onRestart={() => {
            void reloadApplication();
          }}
        />
      );
    }
    return this.props.children;
  }
}

function ErrorFallbackScreen({
  onRestart,
  devDetail,
}: {
  onRestart: () => void;
  devDetail: string;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
      ]}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.brand}>{t('errorBoundary.brand')}</Text>
        <Text style={styles.trankil}>{t('errorBoundary.brand')}</Text>
        <Text style={styles.title}>{t('errorBoundary.title')}</Text>
        <Text style={styles.body}>{t('errorBoundary.body')}</Text>
        {__DEV__ && devDetail ? (
          <Text style={styles.dev} selectable>
            {devDetail}
          </Text>
        ) : null}
        <Pressable
          onPress={onRestart}
          style={({ pressed }) => [
            styles.btn,
            { opacity: pressed ? 0.9 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('errorBoundary.restartA11y')}
        >
          <Text style={styles.btnText}>{t('errorBoundary.restart')}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.offWhite,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
    maxWidth: 420,
    alignSelf: 'center',
    width: '100%',
  },
  brand: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: palette.tealDark,
    textTransform: 'uppercase',
  },
  trankil: {
    marginTop: 4,
    fontSize: 28,
    fontWeight: '700',
    color: palette.textOnLight,
  },
  title: {
    marginTop: 20,
    fontSize: 18,
    fontWeight: '600',
    color: palette.textOnLight,
    lineHeight: 26,
  },
  body: {
    marginTop: 14,
    fontSize: 16,
    lineHeight: 24,
    color: palette.textOnLight,
    opacity: 0.92,
  },
  dev: {
    marginTop: 16,
    fontSize: 12,
    lineHeight: 18,
    color: palette.tealDark,
    opacity: 0.85,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  btn: {
    marginTop: 28,
    alignSelf: 'flex-start',
    backgroundColor: palette.teal,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
  },
  btnText: {
    color: palette.offWhite,
    fontSize: 16,
    fontWeight: '700',
  },
});
