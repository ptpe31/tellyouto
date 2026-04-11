import { randomUUID } from 'expo-crypto';
import React, { useCallback, useEffect, useState } from 'react';
import {
  DeviceEventEmitter,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  FAB,
  Portal,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  insertIntention,
  listIntentionsDescending,
  LOCAL_DB_RESET_EVENT,
  type IntentionRow,
} from '../api/localDb';
import { syncPendingIntentions } from '../api/syncService';
import { INTENTIONS_CHANGED_EVENT } from '../services/externalIntentIngest';
import { NeumorphicCard } from '../components';
import { useUserSpectrum } from '../context/UserSpectrumContext';
import {
  computeIntentionPriority,
  estimateDurationMinutes,
} from '../services/agentLogic';

export function RadarScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { spectrum } = useUserSpectrum();

  const [rows, setRows] = useState<IntentionRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const load = useCallback(async () => {
    const list = await listIntentionsDescending();
    setRows(list);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(LOCAL_DB_RESET_EVENT, () => {
      void load();
    });
    const sub2 = DeviceEventEmitter.addListener(INTENTIONS_CHANGED_EVENT, () => {
      void load();
    });
    return () => {
      sub.remove();
      sub2.remove();
    };
  }, [load]);

  const onAdd = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    const priority = computeIntentionPriority(
      trimmedTitle,
      description.trim(),
      spectrum,
    );
    const estimated_duration = estimateDurationMinutes(
      trimmedTitle,
      description.trim(),
      spectrum,
    );

    await insertIntention({
      id: randomUUID(),
      title: trimmedTitle,
      description: description.trim(),
      status: 'pending',
      priority,
      weights: {
        structure: spectrum.structure,
        momentum: spectrum.momentum,
        zen: spectrum.zen,
        stats: spectrum.stats,
      },
      platform_type: 'none',
      platform_user_id: spectrum.platform_user_id,
      created_at: Date.now(),
      estimated_duration,
    });

    setTitle('');
    setDescription('');
    setDialogOpen(false);
    await load();
    void syncPendingIntentions();
  };

  const renderItem = ({ item }: { item: IntentionRow }) => (
    <NeumorphicCard style={styles.card}>
      <Text style={[styles.cardTitle, { color: theme.colors.onSurface }]}>
        {item.title}
      </Text>
      {item.description ? (
        <Text
          style={[styles.cardDesc, { color: theme.colors.onSurfaceVariant }]}
        >
          {item.description}
        </Text>
      ) : null}
      <Text style={[styles.meta, { color: theme.colors.primary }]}>
        {t('radar.priority', { value: item.priority })} ·{' '}
        {t(`radar.status.${item.status}`)}
      </Text>
    </NeumorphicCard>
  );

  return (
    <View
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
    >
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.listPad,
          { paddingBottom: 100 + insets.bottom },
        ]}
        ListHeaderComponent={
          <NeumorphicCard style={styles.headerCard}>
            <Text style={[styles.title, { color: theme.colors.onBackground }]}>
              {t('tabs.radar')}
            </Text>
          </NeumorphicCard>
        }
        ListEmptyComponent={
          <NeumorphicCard>
            <Text style={{ color: theme.colors.onSurface }}>
              {t('radar.empty')}
            </Text>
          </NeumorphicCard>
        }
      />

      <FAB
        icon="plus"
        style={[
          styles.fab,
          {
            bottom: 24 + insets.bottom,
            backgroundColor: theme.colors.secondary,
          },
        ]}
        onPress={() => setDialogOpen(true)}
        color={theme.colors.onSecondary}
        size="medium"
      />

      <Portal>
        <Dialog
          visible={dialogOpen}
          onDismiss={() => setDialogOpen(false)}
          style={{ backgroundColor: theme.colors.surface }}
        >
          <Dialog.Title>{t('radar.quickAddTitle')}</Dialog.Title>
          <Dialog.Content>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              <TextInput
                mode="outlined"
                label={t('radar.fieldTitle')}
                value={title}
                onChangeText={setTitle}
                style={styles.input}
              />
              <TextInput
                mode="outlined"
                label={t('radar.fieldDescription')}
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={3}
                style={styles.input}
              />
            </KeyboardAvoidingView>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialogOpen(false)}>
              {t('radar.cancel')}
            </Button>
            <Button mode="contained" onPress={() => void onAdd()}>
              {t('radar.save')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listPad: { padding: 16, paddingBottom: 8 },
  headerCard: { marginBottom: 14, paddingVertical: 14 },
  title: { fontSize: 22, fontWeight: '600' },
  card: { marginBottom: 14 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  cardDesc: { marginTop: 6, fontSize: 14, lineHeight: 20 },
  meta: { marginTop: 10, fontSize: 12, fontWeight: '600' },
  fab: { position: 'absolute', right: 20 },
  input: { marginBottom: 8 },
});
