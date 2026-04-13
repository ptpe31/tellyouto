import { LinearGradient } from 'expo-linear-gradient';
import { Mic, UserCircle2, Waves } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'react-native-paper';

export function TalkHomeScreen() {
  const { t } = useTranslation();
  useTheme();

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
          <Text style={styles.brandName}>
            {t('talkHome.brandName')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('talkHome.profileButton')}
          style={styles.profileBtn}
        >
          <UserCircle2 size={26} color="#9fa7a3" />
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
        <Text style={styles.progressLabel}>{t('talkHome.progressCurrent')}</Text>
        <Text style={styles.progressLabel}>{t('talkHome.progressNextAnchor')}</Text>
        <View style={styles.progressTrack}>
          <View style={styles.progressFill} />
        </View>
      </View>

      <View style={styles.talkWrap}>
        <View style={styles.outerRing}>
          <LinearGradient
            colors={['#4c73ad', '#5f8fa3', '#79a89c']}
            start={{ x: 0.15, y: 0.05 }}
            end={{ x: 0.95, y: 0.95 }}
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
  root: { flex: 1, paddingHorizontal: 22, paddingTop: 62 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  brandName: { fontSize: 34, fontWeight: '700', color: '#2e5f68' },
  profileBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  pingCard: {
    marginTop: 24,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: '#fbf8f3',
    shadowColor: '#707b75',
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 7,
  },
  priorityBadge: {
    textAlign: 'center',
    color: '#c17357',
    fontWeight: '700',
    marginBottom: 8,
    fontSize: 17,
  },
  question: { textAlign: 'center', fontSize: 34, fontWeight: '600', color: '#2f4f5a' },
  answerRow: { marginTop: 16, flexDirection: 'row', gap: 12 },
  answerBtn: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yesBtn: { backgroundColor: '#6fad7e' },
  noBtn: { backgroundColor: '#d9d8d5' },
  yesText: { color: '#f7fff7', fontWeight: '700', fontSize: 24 },
  noText: { color: '#6e7174', fontWeight: '700', fontSize: 24 },
  privacyHint: {
    marginTop: 12,
    textAlign: 'center',
    color: '#77807a',
    fontSize: 13,
    fontWeight: '500',
  },
  progressCard: {
    marginTop: 16,
    alignSelf: 'center',
    width: '80%',
    borderRadius: 14,
    backgroundColor: '#f8f8f6',
    paddingHorizontal: 12,
    paddingVertical: 9,
    shadowColor: '#8f8f8f',
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 7,
    elevation: 3,
  },
  progressLabel: { textAlign: 'center', color: '#707572', fontSize: 10, marginBottom: 3 },
  progressTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: '#e5e4df',
    overflow: 'hidden',
  },
  progressFill: { width: '38%', height: '100%', backgroundColor: '#78ad92' },
  talkWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 36 },
  outerRing: {
    width: 312,
    height: 312,
    borderRadius: 156,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(214, 227, 223, 0.56)',
    borderWidth: 14,
    borderColor: 'rgba(255,255,255,0.62)',
  },
  talkButton: {
    width: 248,
    height: 248,
    borderRadius: 124,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holdLabel: {
    color: '#eff8f8',
    fontSize: 21,
    letterSpacing: 2.2,
    fontWeight: '700',
    marginBottom: 26,
  },
  micCore: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 255, 251, 0.22)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
  },
});
