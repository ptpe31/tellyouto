import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

export type AddressInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSubmitManual: () => void;
  loading?: boolean;
  error?: string | null;
  predictions?: Array<{ placeId: string; description: string }>;
  onPickPrediction?: (prediction: { placeId: string; description: string }) => void;
  showAutocomplete?: boolean;
  submitLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  missingKeyLabel?: string;
  missingApiKey?: boolean;
  errorResolveFailedLabel?: string;
};

export function AddressInput(props: AddressInputProps) {
  const {
    value,
    onChangeText,
    onSubmitManual,
    loading = false,
    error = null,
    predictions = [],
    onPickPrediction,
    showAutocomplete = false,
    submitLabel = 'OK',
    placeholder,
    disabled = false,
    autoFocus,
    missingKeyLabel,
    missingApiKey = false,
    errorResolveFailedLabel,
  } = props;

  if (missingApiKey && missingKeyLabel) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.missingKey}>{missingKeyLabel}</Text>
      </View>
    );
  }

  const inputProps: TextInputProps = {
    value,
    onChangeText,
    placeholder,
    placeholderTextColor: 'rgba(100,116,139,0.72)',
    style: [styles.input, disabled ? styles.disabledInput : null],
    editable: !disabled && !loading,
    autoCorrect: false,
    autoCapitalize: 'none',
    autoFocus,
    onSubmitEditing: showAutocomplete ? undefined : onSubmitManual,
    returnKeyType: showAutocomplete ? 'default' : 'done',
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.inputRow}>
        <TextInput {...inputProps} />
        {!showAutocomplete ? (
          <Pressable
            style={[styles.okBtn, disabled || loading ? styles.okBtnDisabled : null]}
            onPress={onSubmitManual}
            disabled={disabled || loading}
          >
            <Text style={styles.okBtnText}>{submitLabel}</Text>
          </Pressable>
        ) : null}
        {loading ? <ActivityIndicator size="small" color="#0f766e" /> : null}
      </View>
      {error === 'resolve_failed' && errorResolveFailedLabel ? (
        <Text style={styles.errorText}>{errorResolveFailedLabel}</Text>
      ) : null}
      {showAutocomplete && predictions.length && onPickPrediction ? (
        <View style={styles.dropdown}>
          {predictions.map((p) => (
            <Pressable key={p.placeId} style={styles.item} onPress={() => onPickPrediction(p)}>
              <Text style={styles.itemText}>{p.description}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    color: '#0f172a',
    fontSize: 14,
  },
  disabledInput: { opacity: 0.6 },
  okBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#0f766e',
  },
  okBtnDisabled: { opacity: 0.5 },
  okBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  errorText: { color: '#b91c1c', fontSize: 12, fontWeight: '600' },
  dropdown: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  item: { paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  itemText: { color: '#0f172a', fontSize: 13, fontWeight: '600' },
  missingKey: { color: '#b91c1c', fontSize: 13, fontWeight: '700' },
});
