import { BlurView } from 'expo-blur';
import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

export type AIUniversalProgressOverlayProps = {
  isVisible: boolean;
  /** 0–100, valeur déjà lissée côté hook / parent. */
  progress: number;
  /** Titre d’étape affiché au-dessus de la barre. */
  label: string;
  /** Couleur de remplissage de la barre (ex. résilience orange). */
  barColor?: string;
};

const DEFAULT_BAR = '#38bdf8';

/**
 * Overlay plein écran avec flou : carte centrale reprenant la charte
 * {@link TalkPipelineProgressDashboard} (titre, piste, pourcentage).
 */
export function AIUniversalProgressOverlay({
  isVisible,
  progress,
  label,
  barColor = DEFAULT_BAR,
}: AIUniversalProgressOverlayProps) {
  const pct = Math.max(0, Math.min(100, progress));
  const rounded = Math.round(pct);

  return (
    <Modal visible={isVisible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.root} pointerEvents="box-none">
        <View style={styles.backdropSolid} pointerEvents="none" />
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.center} pointerEvents="box-none">
          <View style={styles.card} pointerEvents="box-none">
            <Text style={styles.title}>{label}</Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${pct}%`, backgroundColor: barColor }]} />
            </View>
            <Text style={styles.pctLabel}>{`${rounded}%`}</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdropSolid: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#111827',
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    paddingVertical: 28,
    paddingHorizontal: 22,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
  },
  title: {
    color: '#f1f5f9',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 22,
  },
  track: {
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(51,65,85,0.85)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
  pctLabel: {
    marginTop: 14,
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
});
