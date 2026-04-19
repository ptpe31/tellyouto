import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Mic, Pause, Play, Send, Trash2 } from 'lucide-react-native';

export type UiMode = 'IDLE' | 'RECORDING' | 'DECISION';
export type MainConceptTarget = 'PROJECT' | 'TASK' | 'NOTE';

const CONCEPT_META: Record<MainConceptTarget, { title: string; subtitle: string }> = {
  PROJECT: { title: '[GENERER PROJET]', subtitle: 'ATOMISER LA PENSEE EN ACTIONS' },
  TASK: { title: '[CREER TACHE RAPIDE]', subtitle: 'UNE ACTION SIMPLE, UN RAPPEL' },
  NOTE: { title: '[PRENDRE NOTE BRUTE]', subtitle: 'SIMPLE CAPTURE TEXTE OU AUDIO' },
};

type Props = {
  uiMode: UiMode;
  currentTarget: MainConceptTarget;
  onSelectTarget: (target: MainConceptTarget) => void;
  centerContent: React.ReactNode;
  bottomInset: number;
  micDisabled: boolean;
  onMicStartPress: () => void;
  onCaptureCancel: () => void;
  onCapturePauseToggle: () => void;
  onCaptureSend: () => void;
  isCapturePaused: boolean;
  showDecisionActions: boolean;
  onDecisionCancel: () => void;
  onDecisionSaveNote: () => void;
  onDecisionSaveAudio: () => void;
  onDecisionGenerate: () => void;
  decisionDisabled?: boolean;
};

export function MainInterface({
  uiMode,
  currentTarget,
  onSelectTarget,
  centerContent,
  bottomInset,
  micDisabled,
  onMicStartPress,
  onCaptureCancel,
  onCapturePauseToggle,
  onCaptureSend,
  isCapturePaused,
  showDecisionActions,
  onDecisionCancel,
  onDecisionSaveNote,
  onDecisionSaveAudio,
  onDecisionGenerate,
  decisionDisabled = false,
}: Props) {
  return (
    <>
      {uiMode === 'IDLE' ? (
        <View style={styles.conceptBar}>
          {(['PROJECT', 'TASK', 'NOTE'] as MainConceptTarget[]).map((target) => {
            const isActive = currentTarget === target;
            return (
              <Pressable
                key={target}
                style={[styles.conceptBtn, isActive ? styles.conceptBtnActive : null]}
                onPress={() => onSelectTarget(target)}
                disabled={decisionDisabled}
              >
                <Text style={[styles.conceptBtnText, isActive ? styles.conceptBtnTextActive : null]}>
                  {CONCEPT_META[target].title}
                </Text>
                <Text style={[styles.conceptBtnSub, isActive ? styles.conceptBtnSubActive : null]}>
                  {CONCEPT_META[target].subtitle}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={styles.centerZone}>{centerContent}</View>

      <View style={[styles.micDock, { bottom: bottomInset + 26 }]}>
        {uiMode === 'DECISION' && showDecisionActions ? (
          <View style={styles.decisionBar}>
            <Pressable style={[styles.decisionBtn, styles.decisionBtnNeutral]} onPress={onDecisionCancel} disabled={decisionDisabled}>
              <Text style={styles.decisionNeutralText}>❌ ANNULER</Text>
            </Pressable>
            <Pressable style={[styles.decisionBtn, styles.decisionBtnNeutral]} onPress={onDecisionSaveNote} disabled={decisionDisabled}>
              <Text style={styles.decisionNeutralText}>💾 NOTE</Text>
            </Pressable>
            <Pressable style={[styles.decisionBtn, styles.decisionBtnNeutral]} onPress={onDecisionSaveAudio} disabled={decisionDisabled}>
              <Text style={styles.decisionNeutralText}>🎙️ AUDIO</Text>
            </Pressable>
            <Pressable style={[styles.decisionBtn, styles.decisionBtnActive]} onPress={onDecisionGenerate} disabled={decisionDisabled}>
              <Text style={styles.decisionActiveText}>✨ GENERER PLAN PROJET</Text>
            </Pressable>
          </View>
        ) : uiMode === 'RECORDING' ? (
          <View style={styles.captureControlBar}>
            <Pressable style={[styles.captureCtrlBtn, styles.captureCtrlDanger]} onPress={onCaptureCancel} disabled={decisionDisabled}>
              <Trash2 size={22} color="#f8d7d7" />
            </Pressable>
            <Pressable style={[styles.captureCtrlBtn, styles.captureCtrlCenter]} onPress={onCapturePauseToggle} disabled={decisionDisabled}>
              {isCapturePaused ? <Play size={22} color="#dffcff" /> : <Pause size={22} color="#dffcff" />}
            </Pressable>
            <Pressable style={[styles.captureCtrlBtn, styles.captureCtrlSend]} onPress={onCaptureSend} disabled={decisionDisabled}>
              <Send size={22} color="#dffcff" />
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.micBtn} onPress={onMicStartPress} disabled={micDisabled}>
            <Mic size={26} color="#e4edf5" />
          </Pressable>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  conceptBar: {
    position: 'absolute',
    top: 134,
    left: 22,
    right: 22,
    flexDirection: 'row',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(168,179,197,0.28)',
    backgroundColor: '#2a313d',
    zIndex: 12,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 6,
  },
  conceptBtn: {
    flex: 1,
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(54,63,79,0.68)',
    borderWidth: 1,
    borderColor: 'rgba(17,22,31,0.45)',
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  conceptBtnActive: {
    backgroundColor: 'rgba(40,57,52,0.95)',
    borderColor: 'rgba(60, 234, 159, 0.45)',
    shadowColor: '#3CEA9F',
    shadowOpacity: 0.24,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 10,
    elevation: 4,
  },
  conceptBtnText: {
    color: '#d7dbe1',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  conceptBtnTextActive: { color: '#eafff4' },
  conceptBtnSub: {
    marginTop: 2,
    color: 'rgba(197,204,216,0.82)',
    fontSize: 8,
    fontWeight: '600',
    textAlign: 'center',
  },
  conceptBtnSubActive: { color: 'rgba(216,255,233,0.86)' },
  centerZone: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  micDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtn: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(69,82,102,0.32)',
    borderWidth: 1,
    borderColor: 'rgba(196,208,224,0.3)',
  },
  captureControlBar: {
    width: '86%',
    minHeight: 78,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(161,177,197,0.34)',
    backgroundColor: 'rgba(24,32,45,0.94)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 8,
  },
  captureCtrlBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  captureCtrlDanger: {
    borderColor: 'rgba(244,160,160,0.34)',
    backgroundColor: 'rgba(128,42,48,0.35)',
  },
  captureCtrlCenter: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderColor: 'rgba(135,236,245,0.42)',
    backgroundColor: 'rgba(8,144,156,0.36)',
  },
  captureCtrlSend: {
    borderColor: 'rgba(135,236,245,0.42)',
    backgroundColor: 'rgba(8,144,156,0.36)',
  },
  decisionBar: {
    width: '92%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(154,168,190,0.25)',
    backgroundColor: 'rgba(30,38,52,0.92)',
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 8,
    gap: 8,
  },
  decisionBtn: {
    flexGrow: 1,
    flexBasis: '48%',
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: 8,
  },
  decisionBtnNeutral: {
    backgroundColor: 'rgba(245, 247, 246, 0.72)',
    borderColor: 'rgba(161, 178, 175, 0.38)',
  },
  decisionBtnActive: {
    backgroundColor: 'rgba(34, 126, 128, 0.82)',
    borderColor: 'rgba(202, 245, 239, 0.42)',
  },
  decisionNeutralText: {
    color: '#2C3E50',
    fontWeight: '700',
    fontSize: 12,
  },
  decisionActiveText: {
    color: '#f2fefd',
    fontWeight: '800',
    fontSize: 12,
    textAlign: 'center',
  },
});
