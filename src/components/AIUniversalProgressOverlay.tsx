import { BlurView } from 'expo-blur';
import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  type StyleProp,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';

export type CaptureTranscriptEditorProps = {
  text: string;
  isEditing: boolean;
  onChangeText: (value: string) => void;
  placeholder?: string;
  textStyle?: StyleProp<TextStyle>;
  inputStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
};

/**
 * Affichage lecture / édition du transcript STT (TextInput multiline + autoFocus en mode édition).
 * Réutilisé par {@link TalkCaptureMicButton} et {@link AIUniversalProgressOverlay}.
 */
export function CaptureTranscriptEditor({
  text,
  isEditing,
  onChangeText,
  placeholder,
  textStyle,
  inputStyle,
  containerStyle,
}: CaptureTranscriptEditorProps) {
  if (isEditing) {
    return (
      <TextInput
        autoFocus
        multiline
        value={text}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(148,163,184,0.65)"
        style={[styles.transcriptInput, inputStyle]}
        textAlignVertical="top"
        scrollEnabled
        accessibilityLabel={placeholder}
      />
    );
  }
  return (
    <View style={containerStyle}>
      <Text style={[styles.transcriptText, textStyle]}>{text.trim() ? text : ' '}</Text>
    </View>
  );
}

export type VerticalAnchorBand = {
  topPx: number;
  bottomPx: number;
};

export type AIUniversalProgressOverlayProps = {
  isVisible: boolean;
  /** 0–100, valeur déjà lissée côté hook / parent. */
  progress: number;
  /** Titre d'étape affiché au-dessus de la barre. */
  label: string;
  /** Couleur de remplissage de la barre (ex. résilience orange). */
  barColor?: string;
  /** TalkDebug : centre la carte dans la bande verticale [topPx, bottomPx] (coordonnées fenêtre). */
  verticalAnchorBand?: VerticalAnchorBand | null;
  /** Transcript STT optionnel (lecture ou édition selon `isEditingTranscription`). */
  transcript?: string;
  isEditingTranscription?: boolean;
  onTranscriptChange?: (value: string) => void;
  transcriptPlaceholder?: string;
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
  verticalAnchorBand,
  transcript,
  isEditingTranscription = false,
  onTranscriptChange,
  transcriptPlaceholder,
}: AIUniversalProgressOverlayProps) {
  const { height: windowHeight } = useWindowDimensions();
  const pct = Math.max(0, Math.min(100, progress));
  const rounded = Math.round(pct);
  const showTranscript = typeof transcript === 'string';
  const band =
    verticalAnchorBand && verticalAnchorBand.bottomPx > verticalAnchorBand.topPx ? verticalAnchorBand : null;
  const centerStyle = band
    ? [
        styles.center,
        {
          paddingTop: band.topPx,
          paddingBottom: Math.max(0, windowHeight - band.bottomPx),
        },
      ]
    : styles.center;

  return (
    <Modal visible={isVisible} transparent animationType="fade" statusBarTranslucent>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        pointerEvents="box-none"
      >
        <View style={styles.backdropSolid} pointerEvents="none" />
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={centerStyle} pointerEvents="box-none">
          <View style={styles.card} pointerEvents="box-none">
            {showTranscript ? (
              <View style={styles.transcriptShell}>
                <CaptureTranscriptEditor
                  text={transcript}
                  isEditing={isEditingTranscription}
                  onChangeText={onTranscriptChange ?? (() => undefined)}
                  placeholder={transcriptPlaceholder}
                  textStyle={styles.transcriptText}
                  inputStyle={styles.transcriptInputOverlay}
                />
              </View>
            ) : null}
            <Text style={[styles.title, showTranscript ? styles.titleWithTranscript : null]}>{label}</Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${pct}%`, backgroundColor: barColor }]} />
            </View>
            <Text style={styles.pctLabel}>{`${rounded}%`}</Text>
          </View>
        </View>
      </KeyboardAvoidingView>
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
  transcriptShell: {
    width: '100%',
    maxHeight: 160,
    marginBottom: 18,
    borderRadius: 14,
    backgroundColor: 'rgba(15,23,42,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.28)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  transcriptText: {
    color: '#e2e8f0',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  transcriptInput: {
    color: '#f1f5f9',
    fontSize: 15,
    lineHeight: 22,
    minHeight: 72,
    maxHeight: 140,
    padding: 0,
    width: '100%',
  },
  transcriptInputOverlay: {
    textAlign: 'center',
  },
  title: {
    color: '#f1f5f9',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 22,
  },
  titleWithTranscript: {
    marginBottom: 16,
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
