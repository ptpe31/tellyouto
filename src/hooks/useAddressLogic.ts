import { useCallback, useMemo, useRef, useState } from 'react';

import { AddressResolver, type AddressSelection } from '../services/addressResolver';

/** Seuil « recherche approfondie » — autocomplete uniquement via la loupe. */
export const LAZY_FETCH_SEARCH_MIN_CHARS = 12;

type Prediction = { placeId: string; description: string };

function createSessionToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function getMapsApiKey(): string {
  return String(process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '').trim();
}

export type UseAddressLogicParams = {
  value: string;
  onChangeText: (text: string) => void;
  onSelect: (place: AddressSelection) => void;
  language?: string;
  disabled?: boolean;
};

export type UseAddressLogicResult = {
  value: string;
  onChangeText: (text: string) => void;
  onSubmitManual: () => void;
  onLoupePress: () => void;
  onClearPress: () => void;
  loading: boolean;
  error: string | null;
  predictions: Prediction[];
  onPickPrediction: (prediction: Prediction) => void;
  missingApiKey: boolean;
  isSearchable: boolean;
  isValidated: boolean;
  predictionsVisible: boolean;
};

export function useAddressLogic(params: UseAddressLogicParams): UseAddressLogicResult {
  const { value, onChangeText, onSelect, language, disabled } = params;
  const apiKey = getMapsApiKey();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [predictionsVisible, setPredictionsVisible] = useState(false);
  const [isValidated, setIsValidated] = useState(false);
  const sessionTokenRef = useRef(createSessionToken());

  const lang = useMemo(() => {
    const l = String(language ?? '').trim();
    return l || 'fr';
  }, [language]);

  const trimmed = value.trim();
  const isSearchable = trimmed.length >= LAZY_FETCH_SEARCH_MIN_CHARS;

  const resetSessionToken = useCallback(() => {
    sessionTokenRef.current = createSessionToken();
  }, []);

  const finishSelection = useCallback(
    (place: AddressSelection) => {
      onChangeText(place.formattedAddress);
      onSelect(place);
      setPredictions([]);
      setPredictionsVisible(false);
      setIsValidated(true);
      setError(null);
      resetSessionToken();
    },
    [onChangeText, onSelect, resetSessionToken],
  );

  const handleChangeText = useCallback(
    (text: string) => {
      if (disabled || isValidated) return;
      onChangeText(text);
      setPredictions([]);
      setPredictionsVisible(false);
      setError(null);
    },
    [disabled, isValidated, onChangeText],
  );

  const onSubmitManual = useCallback(() => {
    if (disabled || loading || isValidated) return;
    const q = trimmed;
    if (!q) {
      setError('empty');
      return;
    }
    if (!apiKey) {
      setError('missing_key');
      return;
    }
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const place = await AddressResolver.resolveManual(q, lang);
        finishSelection(place);
      } catch {
        setError('resolve_failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [apiKey, disabled, finishSelection, isValidated, lang, loading, trimmed]);

  const onLoupePress = useCallback(() => {
    if (disabled || loading || isValidated || !isSearchable || !apiKey) return;
    const q = trimmed;
    if (!q) return;

    setError(null);
    setLoading(true);
    setPredictionsVisible(true);
    void (async () => {
      try {
        const rows = await AddressResolver.fetchAutocompletePredictions(
          q,
          sessionTokenRef.current,
          lang,
        );
        setPredictions(rows);
        if (rows.length === 0) {
          setError('resolve_failed');
        }
      } catch {
        setPredictions([]);
        setError('resolve_failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [apiKey, disabled, isSearchable, isValidated, lang, loading, trimmed]);

  const onClearPress = useCallback(() => {
    if (disabled || loading) return;
    setIsValidated(false);
    onChangeText('');
    setPredictions([]);
    setPredictionsVisible(false);
    setError(null);
    resetSessionToken();
  }, [disabled, loading, onChangeText, resetSessionToken]);

  const onPickPrediction = useCallback(
    (prediction: Prediction) => {
      if (disabled || loading || isValidated || !apiKey) return;
      setPredictions([]);
      setPredictionsVisible(false);
      setLoading(true);
      setError(null);
      void (async () => {
        try {
          const place = await AddressResolver.resolveFromPlaceId(prediction.placeId, lang);
          finishSelection(place);
        } catch {
          setError('resolve_failed');
        } finally {
          setLoading(false);
        }
      })();
    },
    [apiKey, disabled, finishSelection, isValidated, lang, loading],
  );

  return {
    value,
    onChangeText: handleChangeText,
    onSubmitManual,
    onLoupePress,
    onClearPress,
    loading,
    error,
    predictions,
    onPickPrediction,
    missingApiKey: !apiKey,
    isSearchable,
    isValidated,
    predictionsVisible,
  };
}
