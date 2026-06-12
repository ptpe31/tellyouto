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
import { IconButton } from 'react-native-paper';

import type { PlacePrediction } from '../../hooks/usePlaceSearch';

export type AddressInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSubmitManual: () => void;
  onLoupePress: () => void;
  onClearPress: () => void;
  loading?: boolean;
  error?: string | null;
  predictions?: PlacePrediction[];
  onPickPrediction?: (prediction: PlacePrediction) => void;
  isSearchable?: boolean;
  isValidated?: boolean;
  predictionsVisible?: boolean;
  showLoupe?: boolean;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  missingKeyLabel?: string;
  missingApiKey?: boolean;
  errorResolveFailedLabel?: string;
  errorSearchUnavailableLabel?: string;
};

export function AddressInput(props: AddressInputProps) {
  const {
    value,
    onChangeText,
    onSubmitManual,
    onLoupePress,
    onClearPress,
    loading = false,
    error = null,
    predictions = [],
    onPickPrediction,
    isSearchable = false,
    isValidated = false,
    predictionsVisible = false,
    showLoupe = false,
    placeholder,
    disabled = false,
    autoFocus,
    missingKeyLabel,
    missingApiKey = false,
    errorResolveFailedLabel,
    errorSearchUnavailableLabel,
  } = props;

  if (missingApiKey && missingKeyLabel) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.missingKey}>{missingKeyLabel}</Text>
      </View>
    );
  }

  const fieldLocked = disabled || loading || isValidated;
  const showPredictions = predictionsVisible && predictions.length > 0 && onPickPrediction;

  const inputProps: TextInputProps = {
    value,
    onChangeText,
    placeholder,
    placeholderTextColor: 'rgba(100,116,139,0.72)',
    style: [
      styles.input,
      fieldLocked ? styles.disabledInput : null,
      isValidated ? styles.inputValidated : null,
    ],
    editable: !fieldLocked,
    autoCorrect: false,
    autoCapitalize: 'none',
    autoFocus: autoFocus && !isValidated,
    onSubmitEditing: isValidated ? undefined : onSubmitManual,
    returnKeyType: isValidated ? 'default' : 'done',
  };

  const renderTrailingAction = () => {
    if (loading) {
      return <ActivityIndicator size="small" color="#0f766e" style={styles.trailingSpinner} />;
    }
    if (isValidated) {
      return (
        <View style={styles.trailingGroup}>
          <IconButton
            icon="check-circle"
            size={22}
            iconColor="#16a34a"
            style={styles.trailingIcon}
            disabled
          />
          <IconButton
            icon="close"
            size={20}
            iconColor="#64748b"
            style={styles.trailingIcon}
            onPress={onClearPress}
            accessibilityLabel="Reset address"
          />
        </View>
      );
    }
    if (showLoupe && isSearchable) {
      return (
        <IconButton
          icon="magnify"
          size={22}
          iconColor="#0f766e"
          style={styles.trailingIcon}
          onPress={onLoupePress}
          disabled={disabled}
          accessibilityLabel="Search address"
        />
      );
    }
    if (value.length > 0) {
      return (
        <IconButton
          icon="close"
          size={20}
          iconColor="#64748b"
          style={styles.trailingIcon}
          onPress={onClearPress}
          disabled={disabled}
          accessibilityLabel="Clear address"
        />
      );
    }
    return null;
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.inputRow}>
        <TextInput {...inputProps} />
        {renderTrailingAction()}
      </View>
      {error === 'resolve_failed' && errorResolveFailedLabel ? (
        <Text style={styles.errorText}>{errorResolveFailedLabel}</Text>
      ) : null}
      {error === 'search_unavailable' && errorSearchUnavailableLabel ? (
        <Text style={styles.errorText}>{errorSearchUnavailableLabel}</Text>
      ) : null}
      {showPredictions ? (
        <View style={styles.resultsList}>
          {predictions.map((p, index) => (
            <Pressable
              key={p.placeId}
              style={[styles.item, index === 0 ? styles.itemFirst : null]}
              onPress={() => onPickPrediction(p)}
            >
              <Text style={styles.itemText}>
                {p.source === 'local' ? '📍 ' : ''}
                {p.description}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
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
  inputValidated: {
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
  },
  disabledInput: { opacity: 0.92 },
  trailingGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trailingIcon: {
    margin: 0,
    width: 40,
    height: 40,
  },
  trailingSpinner: {
    marginRight: 8,
  },
  errorText: { color: '#b91c1c', fontSize: 12, fontWeight: '600' },
  resultsList: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  item: { paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  itemFirst: { borderTopWidth: 0 },
  itemText: { color: '#0f172a', fontSize: 14, fontWeight: '600', lineHeight: 20 },
  missingKey: { color: '#b91c1c', fontSize: 13, fontWeight: '700' },
});
