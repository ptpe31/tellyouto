import React from 'react';
import { useTranslation } from 'react-i18next';

import { useAddressLogic } from '../../hooks/useAddressLogic';
import type { AddressSelection } from '../../services/addressResolver';
import { AddressInput } from './AddressInput';

/** Drop-in Sentinel / trip address field — hook + UI séparés, autocomplete dormant si ENABLE_AUTOCOMPLETE=false. */
export function AddressInputField(props: {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  language?: string;
  onChangeText: (text: string) => void;
  onSelect: (place: AddressSelection) => void;
  missingKeyLabel: string;
}) {
  const { t } = useTranslation();
  const logic = useAddressLogic({
    value: props.value,
    onChangeText: props.onChangeText,
    onSelect: props.onSelect,
    language: props.language,
    disabled: props.disabled,
  });

  return (
    <AddressInput
      value={logic.value}
      onChangeText={logic.onChangeText}
      onSubmitManual={logic.onSubmitManual}
      loading={logic.loading}
      error={logic.error}
      predictions={logic.predictions}
      onPickPrediction={logic.onPickPrediction}
      showAutocomplete={logic.showAutocomplete}
      submitLabel={logic.submitLabel}
      placeholder={props.placeholder}
      disabled={props.disabled}
      autoFocus={props.autoFocus}
      missingKeyLabel={props.missingKeyLabel}
      missingApiKey={logic.missingApiKey}
      errorResolveFailedLabel={t('sentinel.addressResolveFailed')}
    />
  );
}
