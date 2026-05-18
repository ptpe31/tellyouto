import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export type GooglePlaceSelection = {
  placeId: string;
  formattedAddress: string;
  lat: number;
  lng: number;
};

type Prediction = { placeId: string; description: string };

export function GooglePlacesAutocompleteField(props: {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  language?: string;
  onChangeText: (text: string) => void;
  onSelect: (place: GooglePlaceSelection) => void;
  missingKeyLabel: string;
}) {
  const apiKey = (process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '').trim();
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastQuery, setLastQuery] = useState('');

  const language = useMemo(() => {
    const l = String(props.language ?? '').trim();
    return l ? l : 'fr';
  }, [props.language]);

  useEffect(() => {
    if (!apiKey) return;
    const q = props.value.trim();
    if (q.length < 3) {
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
            encodeURIComponent(language);
          const res = await fetch(url);
          const json = (await res.json()) as {
            status?: string;
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
    }, 260);
    return () => clearTimeout(token);
  }, [apiKey, language, lastQuery, props.value]);

  const onPick = (p: Prediction) => {
    if (!apiKey) return;
    setPredictions([]);
    setLoading(true);
    void (async () => {
      try {
        console.log(`[API-CALL] 💸 GOOGLE PLACES DETAILS | Requesting PlaceID: ${p.placeId}`);
        const url =
          `https://maps.googleapis.com/maps/api/place/details/json?place_id=` +
          encodeURIComponent(p.placeId) +
          `&fields=` +
          encodeURIComponent('formatted_address,geometry') +
          `&key=` +
          encodeURIComponent(apiKey) +
          `&language=` +
          encodeURIComponent(language);
        const res = await fetch(url);
        const json = (await res.json()) as {
          result?: {
            formatted_address?: string;
            geometry?: { location?: { lat?: number; lng?: number } };
          };
        };
        const formattedAddress = String(json.result?.formatted_address || '').trim();
        const lat = Number(json.result?.geometry?.location?.lat);
        const lng = Number(json.result?.geometry?.location?.lng);
        if (!formattedAddress || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
        props.onChangeText(formattedAddress);
        props.onSelect({ placeId: p.placeId, formattedAddress, lat, lng });
      } finally {
        setLoading(false);
      }
    })();
  };

  if (!apiKey) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.missingKey}>{props.missingKeyLabel}</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.inputRow}>
        <TextInput
          value={props.value}
          onChangeText={props.onChangeText}
          placeholder={props.placeholder}
          placeholderTextColor="rgba(100,116,139,0.72)"
          style={[styles.input, props.disabled ? styles.disabledInput : null]}
          editable={!props.disabled}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {loading ? <ActivityIndicator size="small" color="#0f766e" /> : null}
      </View>
      {predictions.length ? (
        <View style={styles.dropdown}>
          {predictions.map((p) => (
            <Pressable key={p.placeId} style={styles.item} onPress={() => onPick(p)}>
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
