import { LinearGradient } from 'expo-linear-gradient';
import { Mic, UserCircle2, Waves } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';

export function TalkHomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <LinearGradient
      colors={['#d7e6dc', '#f7f4eb']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.root}
    >
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.logoWrap}>
            <Waves size={18} color="#2d6f70" />
          </View>
          <Text style={[styles.brandName, { color: theme.colors.primary }]}>
            {t('talkHome.brandName')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('talkHome.profileButton')}
          style={styles.profileBtn}
        >
          <UserCircle2 size={26} color={theme.colors.outline} />
        </Pressable>
      </View>

      <View style={styles.pingCard}>
        <Text style={styles.priorityBadge}>{t('talkHome.priorityHigh')}</Text>
        <Text style={styles.question}>{t('talkHome.questionHydration')}</Text>
        <View style={styles.answerRow}>
          <Pressable style={[styles.answerBtn, styles.yesBtn]}>
            <Text style={styles.yesText}>{t('talkHome.yes')}</Text>
          </Pressable>
          <Pressable style={[styles.answerBtn, styles.noBtn]}>
            <Text style={styles.noText}>{t('talkHome.no')}</Text>
          </Pressable>
        </View>
        <Text style={styles.privacyHint}>{t('talkHome.localPrivacyHint')}</Text>
      </View>

      <View style={styles.progressCard}>
        <Text style={styles.progressLabel}>{t('talkHome.progressLabel')}</Text>
        <View style={styles.progressTrack}>
          <View style={styles.progressFill} />
        </View>
      </View>

      <View style={styles.talkWrap}>
        <View style={styles.outerRing}>
          <LinearGradient
            colors={['#3f71b5', '#6ca392']}
            start={{ x: 0.2, y: 0.1 }}
            end={{ x: 1, y: 1 }}
            style={styles.talkButton}
          >
            <Text style={styles.holdLabel}>{t('talkHome.holdToTalk')}</Text>
            <View style={styles.micCore}>
              <Mic size={30} color="#ffffff" />
            </View>
          </LinearGradient>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 18, paddingTop: 58 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  brandName: { fontSize: 30, fontWeight: '700' },
  profileBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  pingCard: {
    marginTop: 28,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#fbf8f3',
    shadowColor: '#8a8a8a',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 5 },
    shadowRadius: 8,
    elevation: 5,
  },
  priorityBadge: {
    textAlign: 'center',
    color: '#c17357',
    fontWeight: '700',
    marginBottom: 6,
    fontSize: 15,
  },
  question: { textAlign: 'center', fontSize: 28, fontWeight: '600', color: '#2a2a2a' },
  answerRow: { marginTop: 14, flexDirection: 'row', gap: 12 },
  answerBtn: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yesBtn: { backgroundColor: '#6fad7e' },
  noBtn: { backgroundColor: '#d9d8d5' },
  yesText: { color: '#f7fff7', fontWeight: '700', fontSize: 22 },
  noText: { color: '#6e7174', fontWeight: '700', fontSize: 22 },
  privacyHint: {
    marginTop: 10,
    textAlign: 'center',
    color: '#77807a',
    fontSize: 12,
    fontWeight: '500',
  },
  progressCard: {
    marginTop: 14,
    alignSelf: 'center',
    width: '86%',
    borderRadius: 16,
    backgroundColor: '#f8f8f6',
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#8f8f8f',
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 7,
    elevation: 3,
  },
  progressLabel: { textAlign: 'center', color: '#707572', fontSize: 12, marginBottom: 8 },
  progressTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: '#e5e4df',
    overflow: 'hidden',
  },
  progressFill: { width: '38%', height: '100%', backgroundColor: '#78ad92' },
  talkWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 26 },
  outerRing: {
    width: 284,
    height: 284,
    borderRadius: 142,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(220, 233, 229, 0.7)',
  },
  talkButton: {
    width: 240,
    height: 240,
    borderRadius: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holdLabel: {
    color: '#eaf6f6',
    fontSize: 20,
    letterSpacing: 2.6,
    fontWeight: '700',
    marginBottom: 24,
  },
  micCore: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
  },
});
