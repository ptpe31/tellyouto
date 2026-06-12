import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  MAP_PROVIDER,
  MAP_SEARCH_MIN_CHARS,
  MAPBOX_SESSION_IDLE_MS,
  isMapSearchConfigured,
} from '../config/mapConfig';
import type { AddressSelection } from '../services/addressResolver';
import {
  getLocalPlaceById,
  searchLocalPlaces,
  touchLocalPlaceLastUsed,
  upsertLocalPlaceFromSelection,
  type LocalPlaceRow,
} from '../services/localPlaces';
import {
  MapSearchError,
  resolveManualPlace,
  resolvePlaceFromPrediction,
  searchPlaces,
  type MapSearchPrediction,
} from '../services/mapSearchService';
import { newUuidV4 } from '../utils/uuid';

export type PlacePrediction = {
  placeId: string;
  description: string;
  source: 'local' | 'mapbox' | 'google';
  lat?: number;
  lng?: number;
  formattedAddress?: string;
};

export type PlaceSearchErrorCode =
  | 'empty'
  | 'missing_key'
  | 'resolve_failed'
  | 'search_unavailable';

const LOCAL_SEARCH_DEBOUNCE_MS = 200;

function localRowToPrediction(row: LocalPlaceRow): PlacePrediction {
  const description =
    row.name && row.formattedAddress && row.name !== row.formattedAddress
      ? `${row.name} — ${row.formattedAddress}`
      : row.formattedAddress || row.name;
  return {
    placeId: row.id,
    description,
    source: 'local',
    lat: row.lat,
    lng: row.lng,
    formattedAddress: row.formattedAddress,
  };
}

function mergePredictions(local: PlacePrediction[], remote: PlacePrediction[]): PlacePrediction[] {
  const seen = new Set(local.map((p) => p.placeId));
  const merged = [...local];
  for (const r of remote) {
    if (seen.has(r.placeId)) continue;
    seen.add(r.placeId);
    merged.push(r);
  }
  return merged;
}

function mapSearchErrorToCode(err: unknown): PlaceSearchErrorCode {
  if (err instanceof MapSearchError) {
    if (err.kind === 'network') return 'search_unavailable';
    if (err.kind === 'missing_key') return 'missing_key';
  }
  return 'resolve_failed';
}

export type UsePlaceSearchParams = {
  value: string;
  onChangeText: (text: string) => void;
  onSelect: (place: AddressSelection) => void;
  language?: string;
  disabled?: boolean;
};

export type UsePlaceSearchResult = {
  value: string;
  onChangeText: (text: string) => void;
  onSubmitManual: () => void;
  onLoupePress: () => void;
  onClearPress: () => void;
  remoteLoading: boolean;
  loading: boolean;
  error: PlaceSearchErrorCode | null;
  predictions: PlacePrediction[];
  onPickPrediction: (prediction: PlacePrediction) => void;
  missingApiKey: boolean;
  isSearchable: boolean;
  isValidated: boolean;
  predictionsVisible: boolean;
  showLoupe: boolean;
};

export function usePlaceSearch(params: UsePlaceSearchParams): UsePlaceSearchResult {
  const { value, onChangeText, onSelect, language, disabled } = params;
  const apiConfigured = isMapSearchConfigured(MAP_PROVIDER);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [error, setError] = useState<PlaceSearchErrorCode | null>(null);
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [predictionsVisible, setPredictionsVisible] = useState(false);
  const [showLoupe, setShowLoupe] = useState(false);
  const [isValidated, setIsValidated] = useState(false);

  const sessionTokenRef = useRef(newUuidV4());
  const searchGenRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localCacheRef = useRef<PlacePrediction[]>([]);

  const lang = useMemo(() => {
    const l = String(language ?? '').trim();
    return l || 'fr';
  }, [language]);

  const trimmed = value.trim();
  const isSearchable = trimmed.length >= MAP_SEARCH_MIN_CHARS;

  const resetSessionToken = useCallback(() => {
    sessionTokenRef.current = newUuidV4();
  }, []);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const scheduleIdleSessionReset = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      resetSessionToken();
    }, MAPBOX_SESSION_IDLE_MS);
  }, [clearIdleTimer, resetSessionToken]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      clearIdleTimer();
    };
  }, [clearIdleTimer]);

  const finishSelection = useCallback(
    (place: AddressSelection) => {
      onChangeText(place.formattedAddress);
      onSelect(place);
      setPredictions([]);
      setPredictionsVisible(false);
      setShowLoupe(false);
      setIsValidated(true);
      setError(null);
      localCacheRef.current = [];
      resetSessionToken();
      clearIdleTimer();
    },
    [clearIdleTimer, onChangeText, onSelect, resetSessionToken],
  );

  const fetchRemotePredictions = useCallback(
    async (query: string, gen: number): Promise<PlacePrediction[]> => {
      if (!apiConfigured) {
        setError('missing_key');
        return [];
      }
      setRemoteLoading(true);
      setError(null);
      try {
        const rows = await searchPlaces(query, {
          language: lang,
          sessionToken: sessionTokenRef.current,
        });
        if (gen !== searchGenRef.current) return [];
        return rows.map((r) => ({ ...r, source: r.source }));
      } catch (err) {
        if (gen !== searchGenRef.current) return [];
        setError(mapSearchErrorToCode(err));
        return [];
      } finally {
        if (gen === searchGenRef.current) setRemoteLoading(false);
      }
    },
    [apiConfigured, lang],
  );

  const runSearch = useCallback(
    async (query: string) => {
      const gen = ++searchGenRef.current;
      const q = query.trim();
      if (!q) {
        setPredictions([]);
        setPredictionsVisible(false);
        setShowLoupe(false);
        localCacheRef.current = [];
        return;
      }

      setError(null);
      try {
        const localRows = await searchLocalPlaces(q);
        if (gen !== searchGenRef.current) return;

        const localPreds = localRows.map(localRowToPrediction);
        localCacheRef.current = localPreds;

        if (localPreds.length > 0) {
          setPredictions(localPreds);
          setPredictionsVisible(true);
          setShowLoupe(q.length >= MAP_SEARCH_MIN_CHARS);
          return;
        }

        if (q.length >= MAP_SEARCH_MIN_CHARS) {
          const remotePreds = await fetchRemotePredictions(q, gen);
          if (gen !== searchGenRef.current) return;
          setPredictions(remotePreds);
          setPredictionsVisible(remotePreds.length > 0);
          setShowLoupe(false);
          if (remotePreds.length === 0) {
            setError((prev) => prev ?? 'resolve_failed');
          }
          return;
        }

        setPredictions([]);
        setPredictionsVisible(false);
        setShowLoupe(false);
      } catch {
        if (gen !== searchGenRef.current) return;
        setPredictions([]);
        setPredictionsVisible(false);
        setShowLoupe(false);
      }
    },
    [fetchRemotePredictions],
  );

  const handleChangeText = useCallback(
    (text: string) => {
      if (disabled || isValidated) return;
      onChangeText(text);
      setError(null);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      const t = text.trim();
      if (!t) {
        scheduleIdleSessionReset();
        setPredictions([]);
        setPredictionsVisible(false);
        setShowLoupe(false);
        localCacheRef.current = [];
        return;
      }

      clearIdleTimer();
      debounceRef.current = setTimeout(() => {
        void runSearch(text);
      }, LOCAL_SEARCH_DEBOUNCE_MS);
    },
    [clearIdleTimer, disabled, isValidated, onChangeText, runSearch, scheduleIdleSessionReset],
  );

  const onLoupePress = useCallback(() => {
    if (disabled || remoteLoading || isValidated || !isSearchable || !apiConfigured) return;
    const q = trimmed;
    if (!q) return;

    const gen = ++searchGenRef.current;
    const localPreds = localCacheRef.current.length
      ? localCacheRef.current
      : predictions.filter((p) => p.source === 'local');

    setError(null);
    setPredictionsVisible(true);
    void (async () => {
      const remotePreds = await fetchRemotePredictions(q, gen);
      if (gen !== searchGenRef.current) return;
      const merged = mergePredictions(localPreds, remotePreds);
      setPredictions(merged);
      setPredictionsVisible(merged.length > 0);
      if (merged.length === 0) setError('resolve_failed');
    })();
  }, [
    apiConfigured,
    disabled,
    fetchRemotePredictions,
    isSearchable,
    isValidated,
    predictions,
    remoteLoading,
    trimmed,
  ]);

  const onClearPress = useCallback(() => {
    if (disabled || remoteLoading) return;
    searchGenRef.current += 1;
    setIsValidated(false);
    onChangeText('');
    setPredictions([]);
    setPredictionsVisible(false);
    setShowLoupe(false);
    setError(null);
    localCacheRef.current = [];
    resetSessionToken();
    scheduleIdleSessionReset();
  }, [disabled, onChangeText, remoteLoading, resetSessionToken, scheduleIdleSessionReset]);

  const resolveLocalPrediction = useCallback(async (prediction: PlacePrediction): Promise<AddressSelection> => {
    if (prediction.lat != null && prediction.lng != null && prediction.formattedAddress) {
      await touchLocalPlaceLastUsed(prediction.placeId);
      return {
        placeId: prediction.placeId,
        formattedAddress: prediction.formattedAddress,
        lat: prediction.lat,
        lng: prediction.lng,
      };
    }
    const row = await getLocalPlaceById(prediction.placeId);
    if (!row) throw new Error('local place not found');
    await touchLocalPlaceLastUsed(row.id);
    return {
      placeId: row.placeId ?? row.id,
      formattedAddress: row.formattedAddress,
      lat: row.lat,
      lng: row.lng,
    };
  }, []);

  const onSubmitManual = useCallback(() => {
    if (disabled || remoteLoading || isValidated) return;
    const q = trimmed;
    if (!q) {
      setError('empty');
      return;
    }

    const gen = ++searchGenRef.current;
    setError(null);
    setRemoteLoading(true);
    void (async () => {
      try {
        const localRows = await searchLocalPlaces(q, 5);
        if (gen !== searchGenRef.current) return;

        const exact = localRows.find(
          (r) =>
            r.name.toLowerCase() === q.toLowerCase() ||
            r.formattedAddress.toLowerCase() === q.toLowerCase(),
        );
        const pick = exact ?? (localRows.length === 1 ? localRows[0] : null);

        if (pick) {
          await touchLocalPlaceLastUsed(pick.id);
          finishSelection({
            placeId: pick.placeId ?? pick.id,
            formattedAddress: pick.formattedAddress,
            lat: pick.lat,
            lng: pick.lng,
          });
          return;
        }

        if (q.length < MAP_SEARCH_MIN_CHARS) {
          setError('resolve_failed');
          return;
        }

        if (!apiConfigured) {
          setError('missing_key');
          return;
        }

        const place = await resolveManualPlace(q, lang, MAP_PROVIDER);
        if (gen !== searchGenRef.current) return;
        await upsertLocalPlaceFromSelection(place, q);
        finishSelection(place);
      } catch (err) {
        if (gen !== searchGenRef.current) return;
        setError(mapSearchErrorToCode(err));
      } finally {
        if (gen === searchGenRef.current) setRemoteLoading(false);
      }
    })();
  }, [apiConfigured, disabled, finishSelection, isValidated, lang, remoteLoading, trimmed]);

  const onPickPrediction = useCallback(
    (prediction: PlacePrediction) => {
      if (disabled || remoteLoading || isValidated) return;

      const gen = ++searchGenRef.current;
      setPredictions([]);
      setPredictionsVisible(false);
      setRemoteLoading(true);
      setError(null);

      void (async () => {
        try {
          let place: AddressSelection;
          if (prediction.source === 'local') {
            place = await resolveLocalPrediction(prediction);
          } else {
            if (!apiConfigured) {
              setError('missing_key');
              return;
            }
            place = await resolvePlaceFromPrediction(
              prediction as MapSearchPrediction,
              { language: lang, sessionToken: sessionTokenRef.current },
              MAP_PROVIDER,
            );
            if (gen !== searchGenRef.current) return;
            await upsertLocalPlaceFromSelection(place, prediction.description);
          }
          if (gen !== searchGenRef.current) return;
          finishSelection(place);
        } catch (err) {
          if (gen !== searchGenRef.current) return;
          setError(mapSearchErrorToCode(err));
        } finally {
          if (gen === searchGenRef.current) setRemoteLoading(false);
        }
      })();
    },
    [
      apiConfigured,
      disabled,
      finishSelection,
      isValidated,
      lang,
      remoteLoading,
      resolveLocalPrediction,
    ],
  );

  return {
    value,
    onChangeText: handleChangeText,
    onSubmitManual,
    onLoupePress,
    onClearPress,
    remoteLoading,
    loading: remoteLoading,
    error,
    predictions,
    onPickPrediction,
    missingApiKey: !apiConfigured,
    isSearchable,
    isValidated,
    predictionsVisible,
    showLoupe,
  };
}
