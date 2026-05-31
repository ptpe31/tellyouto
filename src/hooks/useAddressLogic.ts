import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ENABLE_AUTOCOMPLETE } from '../config/features';
import { AddressResolver, type AddressSelection } from '../services/addressResolver';

const AUTOCOMPLETE_DEBOUNCE_MS = 500;
const AUTOCOMPLETE_MIN_CHARS = 4;

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
  loading: boolean;
  error: string | null;
  predictions: Prediction[];
  onPickPrediction: (prediction: Prediction) => void;
  missingApiKey: boolean;
  showAutocomplete: boolean;
  submitLabel: string;
};

export function useAddressLogic(params: UseAddressLogicParams): UseAddressLogicResult {
  const { value, onChangeText, onSelect, language, disabled } = params;
  const apiKey = getMapsApiKey();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [lastQuery, setLastQuery] = useState('');
  const sessionTokenRef = useRef(createSessionToken());

  const lang = useMemo(() => {
    const l = String(language ?? '').trim();
    return l || 'fr';
  }, [language]);

  const resetSessionToken = useCallback(() => {
    sessionTokenRef.current = createSessionToken();
  }, []);

  const onSubmitManual = useCallback(() => {
    if (disabled || loading) return;
    const q = value.trim();
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
        onChangeText(place.formattedAddress);
        onSelect(place);
        setPredictions([]);
        resetSessionToken();
      } catch {
        setError('resolve_failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [apiKey, disabled, lang, loading, onChangeText, onSelect, resetSessionToken, value]);

  const onPickPrediction = useCallback(
    (prediction: Prediction) => {
      if (disabled || loading || !apiKey) return;
      setPredictions([]);
      setLoading(true);
      setError(null);
      void (async () => {
        try {
          const place = await AddressResolver.resolveFromPlaceId(prediction.placeId, lang);
          onChangeText(place.formattedAddress);
          onSelect(place);
          resetSessionToken();
        } catch {
          setError('resolve_failed');
        } finally {
          setLoading(false);
        }
      })();
    },
    [apiKey, disabled, lang, loading, onChangeText, onSelect, resetSessionToken],
  );

  useEffect(() => {
    if (!ENABLE_AUTOCOMPLETE || !apiKey || disabled) {
      setPredictions([]);
      return;
    }

    const q = value.trim();
    if (q.length < AUTOCOMPLETE_MIN_CHARS) {
      setPredictions([]);
      setLoading(false);
      return;
    }

    const token = setTimeout(() => {
      void (async () => {
        if (q === lastQuery) return;
        setLastQuery(q);
        setLoading(true);
        try {
          console.log(`[API-CALL] 💸 GOOGLE PLACES AUTOCOMPLETE | Input: "${q}"`);
          const url =
            `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=` +
            encodeURIComponent(q) +
            `&key=` +
            encodeURIComponent(apiKey) +
            `&language=` +
            encodeURIComponent(lang) +
            `&sessiontoken=` +
            encodeURIComponent(sessionTokenRef.current);
          const res = await fetch(url);
          const json = (await res.json()) as {
            predictions?: Array<{ description?: string; place_id?: string }>;
          };
          const rows = Array.isArray(json.predictions) ? json.predictions : [];
          const next: Prediction[] = rows
            .map((p) => ({
              placeId: String(p.place_id || ''),
              description: String(p.description || '').trim(),
            }))
            .filter((p) => p.placeId && p.description)
            .slice(0, 6);
          setPredictions(next);
        } catch {
          setPredictions([]);
        } finally {
          setLoading(false);
        }
      })();
    }, AUTOCOMPLETE_DEBOUNCE_MS);

    return () => clearTimeout(token);
  }, [apiKey, disabled, lang, lastQuery, value]);

  return {
    value,
    onChangeText,
    onSubmitManual,
    loading,
    error,
    predictions,
    onPickPrediction,
    missingApiKey: !apiKey,
    showAutocomplete: ENABLE_AUTOCOMPLETE,
    submitLabel: 'OK',
  };
}
