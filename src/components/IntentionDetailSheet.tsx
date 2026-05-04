import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MD3Theme } from 'react-native-paper';
import { Button, IconButton, Switch } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import type { TrankilV2TimelineItemRow } from '../api';
import {
  updateTrankilV2IntentionLocationAddress,
  updateTrankilV2IntentionTemporal,
  updateTrankilV2IntentionMetadataJson,
  updateTrankilV2IntentionTransportMode,
} from '../api/trankilV2Db';
import { addDaysYmd, formatYmdLocal } from '../services/TimeSorter';
import { GooglePlacesAutocompleteField } from './traffic/GooglePlacesAutocompleteField';
import { getLocationFavoriteByAlias } from '../services/traffic/locationFavorites';

type Props = {
  visible: boolean;
  row: TrankilV2TimelineItemRow | null;
  theme: MD3Theme;
  onClose: () => void;
  onPatchRow?: (id: string, patch: Partial<TrankilV2TimelineItemRow>) => void;
};

type ChecklistItem = { uid: string; text: string; checked: boolean };

type LazyPickerProps = {
  value: Date;
  mode: 'date' | 'time' | 'datetime';
  display?: 'default' | 'spinner' | 'calendar' | 'clock' | 'inline' | 'compact';
  onChange: (event: { type?: string }, date?: Date) => void;
};

function DateTimePickerLazy(props: LazyPickerProps) {
  const [Picker, setPicker] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    void import('@react-native-community/datetimepicker').then((m) => {
      if (!cancelled) setPicker(() => (m as any).default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Picker) return null;
  return <Picker {...props} />;
}

function safeParseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  } catch {
    return null;
  }
}

function str(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function parseHm(raw: string | null): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (!/^\d{1,2}:\d{2}$/.test(s)) return null;
  const [hh, mm] = s.split(':').map((n) => Number(n));
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function parseDueDate(due_date: string | null): { date: Date; hasTime: boolean } | null {
  const raw = String(due_date ?? '').trim();
  if (!raw) return null;
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]) - 1;
    const day = Number(ymd[3]);
    const d = new Date(year, month, day, 0, 0, 0, 0);
    if (!Number.isFinite(d.getTime())) return null;
    return { date: d, hasTime: false };
  }
  const iso = new Date(raw);
  if (Number.isFinite(iso.getTime())) return { date: iso, hasTime: true };
  return null;
}

function capitalizeFirst(raw: string): string {
  if (!raw) return raw;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

function formatLocalIsoNoZ(d: Date): string {
  const year = d.getFullYear();
  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  return `${year}-${month}-${day}T${hh}:${mm}:00`;
}

function formatYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function detectChecklistFromText(raw: string): ChecklistItem[] | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const lines = s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const items: ChecklistItem[] = [];
  for (const line of lines) {
    const m =
      line.match(/^[-*•]\s+(.*)$/) ||
      line.match(/^\d+\.\s+(.*)$/) ||
      line.match(/^\[\s*[xX ]\s*\]\s+(.*)$/);
    if (!m) continue;
    const text = String(m[1] ?? '').trim();
    if (!text) continue;
    items.push({ uid: `ck_${items.length}`, text, checked: false });
  }
  if (items.length >= 2) return items;
  return null;
}

function parseChecklistFromMetadata(meta: Record<string, unknown> | null): ChecklistItem[] | null {
  if (!meta) return null;
  const block = meta.checklist_v1;
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  const o = block as Record<string, unknown>;
  const rawItems = o.items;
  if (!Array.isArray(rawItems)) return null;
  const items: ChecklistItem[] = rawItems
    .map((it, idx) => {
      const r = it as Record<string, unknown>;
      const uid = String(r.uid ?? `ck_${idx}`).trim() || `ck_${idx}`;
      const text = String(r.text ?? '').trim();
      if (!text) return null;
      return { uid, text, checked: Boolean(r.checked) };
    })
    .filter(Boolean) as ChecklistItem[];
  return items.length ? items : null;
}

function mergeChecklistIntoMetadataJson(existing: string | null | undefined, items: ChecklistItem[]): string {
  const root = safeParseJsonObject(existing) ?? {};
  const next = {
    ...root,
    checklist_v1: {
      items: items.map((it) => ({ uid: it.uid, text: it.text, checked: it.checked })),
    },
  };
  return JSON.stringify(next, null, 2);
}

function getTripMeta(meta: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!meta) return null;
  const t = meta.trip;
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  return t as Record<string, unknown>;
}

function getTransportMode(meta: Record<string, unknown> | null): 'auto' | 'transit' | 'walking' | 'bike' {
  const trip = getTripMeta(meta);
  const raw = String(str(trip, 'transportMode') ?? '').trim().toLowerCase();
  if (raw === 'transit') return 'transit';
  if (raw === 'walking' || raw === 'walk') return 'walking';
  if (raw === 'bike' || raw === 'bicycle') return 'bike';
  return 'auto';
}

function getNewtonEnabled(meta: Record<string, unknown> | null): boolean {
  const trip = getTripMeta(meta);
  return Boolean(trip && trip.newtonEnabled);
}

function isTripValidated(meta: Record<string, unknown> | null): boolean {
  const trip = getTripMeta(meta);
  if (!trip) return true;
  return Boolean(trip.validatedAtMs);
}

function buildGoogleMapsDirectionsUrlWithOrigin(params: {
  origin?: string | null;
  destination: string;
  mode: 'auto' | 'transit' | 'walking' | 'bike';
}): string {
  const travelmode =
    params.mode === 'transit'
      ? 'transit'
      : params.mode === 'walking'
        ? 'walking'
        : params.mode === 'bike'
          ? 'bicycling'
          : 'driving';
  const base = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(params.destination)}&travelmode=${travelmode}`;
  const origin = String(params.origin ?? '').trim();
  if (!origin) return base;
  return `${base}&origin=${encodeURIComponent(origin)}`;
}

function buildGeoUrl(destination: string): string {
  const q = encodeURIComponent(destination);
  return `geo:0,0?q=${q}`;
}

function buildAppleMapsUrl(params: {
  origin?: string | null;
  destination: string;
  mode: 'auto' | 'transit' | 'walking' | 'bike';
}): string {
  const dirflg = params.mode === 'transit' ? 'r' : params.mode === 'walking' ? 'w' : 'd';
  const dest = encodeURIComponent(params.destination);
  const origin = String(params.origin ?? '').trim();
  const base = `maps://?daddr=${dest}&dirflg=${dirflg}`;
  if (!origin) return base;
  return `${base}&saddr=${encodeURIComponent(origin)}`;
}

function buildGoogleMapsUrlNative(params: {
  origin?: string | null;
  destination: string;
  mode: 'auto' | 'transit' | 'walking' | 'bike';
}): string {
  const destination = encodeURIComponent(params.destination);
  const origin = String(params.origin ?? '').trim();
  if (Platform.OS === 'android') {
    const mode =
      params.mode === 'transit' ? 'r' : params.mode === 'walking' ? 'w' : params.mode === 'bike' ? 'b' : 'd';
    return `google.navigation:q=${destination}&mode=${mode}`;
  }
  const directionsmode =
    params.mode === 'transit' ? 'transit' : params.mode === 'walking' ? 'walking' : params.mode === 'bike' ? 'bicycling' : 'driving';
  const base = `comgooglemaps://?daddr=${destination}&directionsmode=${encodeURIComponent(directionsmode)}`;
  if (!origin) return base;
  return `${base}&saddr=${encodeURIComponent(origin)}`;
}

function buildWazeUrl(destination: string): string {
  return `waze://?q=${encodeURIComponent(destination)}&navigate=yes`;
}

async function openNavigationUniversal(params: {
  origin?: string | null;
  destination: string;
  mode: 'auto' | 'transit' | 'walking' | 'bike';
}): Promise<void> {
  const destination = String(params.destination ?? '').trim();
  if (!destination) return;
  const origin = String(params.origin ?? '').trim() || null;

  if (Platform.OS === 'android') {
    const googleUrl = buildGoogleMapsUrlNative({ origin, destination, mode: params.mode });
    const wazeUrl = buildWazeUrl(destination);
    const canGoogle = await Linking.canOpenURL(googleUrl);
    const canWaze = await Linking.canOpenURL(wazeUrl);
    if (canGoogle && !canWaze) {
      await Linking.openURL(googleUrl);
      return;
    }
    if (canWaze && !canGoogle) {
      await Linking.openURL(wazeUrl);
      return;
    }
    await Linking.openURL(buildGeoUrl(destination));
    return;
  }

  if (Platform.OS === 'ios') {
    const apple = { key: 'apple', label: 'Apple Maps', url: buildAppleMapsUrl({ origin, destination, mode: params.mode }) };
    const google = {
      key: 'google',
      label: 'Google Maps',
      url: buildGoogleMapsUrlNative({ origin, destination, mode: params.mode }),
    };
    const waze = { key: 'waze', label: 'Waze', url: buildWazeUrl(destination) };
    const providers = [apple] as Array<{ key: string; label: string; url: string }>;
    if (await Linking.canOpenURL(google.url)) providers.push(google);
    if (await Linking.canOpenURL(waze.url)) providers.push(waze);
    if (providers.length === 1) {
      await Linking.openURL(providers[0].url);
      return;
    }
    await new Promise<void>((resolve) => {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...providers.map((p) => p.label), 'Annuler'],
          cancelButtonIndex: providers.length,
          title: destination,
        },
        (buttonIndex) => {
          const picked = typeof buttonIndex === 'number' ? providers[buttonIndex] : undefined;
          if (!picked) {
            resolve();
            return;
          }
          void Linking.openURL(picked.url).finally(resolve);
        },
      );
    });
    return;
  }

  await Linking.openURL(buildGoogleMapsDirectionsUrlWithOrigin({ origin, destination, mode: params.mode }));
}

export function IntentionDetailSheet({ visible, row, theme, onClose, onPatchRow }: Props) {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const translateY = useRef(new Animated.Value(0)).current;
  const sheetOpacity = useRef(new Animated.Value(0)).current;
  const [sheetHeight, setSheetHeight] = useState(0);
  const [closing, setClosing] = useState(false);
  const [entered, setEntered] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const [sourceDraft, setSourceDraft] = useState('');
  const sourceSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const windowHeight = useMemo(() => Math.max(1, Dimensions.get('window').height), []);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [pickerDraft, setPickerDraft] = useState<Date>(new Date());
  const [isAllDay, setIsAllDay] = useState(false);

  const meta = useMemo(() => safeParseJsonObject(row?.metadata_json), [row?.metadata_json]);
  const trip = useMemo(() => getTripMeta(meta), [meta]);
  const isTrip = Boolean(trip);

  const subtitle = useMemo(() => {
    if (!row) return null;
    const loc = i18n.language || Intl.DateTimeFormat().resolvedOptions().locale;
    const now = new Date();
    const todayKey = formatYmdLocal(now);
    const tomorrowKey = addDaysYmd(now, 1);

    const rootDueIso = str(meta, 'dueDateTime');
    const rootYmd = str(meta, 'dueDateYmd');
    const rootHm = parseHm(str(meta, 'dueTimeHm'));
    const tripArrivalIso = str(trip, 'arrivalDue');
    const tripDueIso = str(trip, 'dueDateTime');
    const tripYmd = str(trip, 'dueDateYmd');
    const tripHm = parseHm(str(trip, 'dueTimeHm'));

    const baseParsed = parseDueDate(row.due_date);
    const isoSource = isTrip ? tripArrivalIso || tripDueIso : rootDueIso;
    const parsedIso = isoSource ? parseDueDate(isoSource) : rootDueIso ? parseDueDate(rootDueIso) : null;
    const dateRef =
      parsedIso?.date ??
      (tripYmd ? parseDueDate(tripYmd)?.date : null) ??
      (rootYmd ? parseDueDate(rootYmd)?.date : null) ??
      baseParsed?.date ??
      null;
    if (!dateRef) return null;
    const dueKey = formatYmdLocal(dateRef);
    const dayLabel =
      dueKey === todayKey
        ? t('horizons.today')
        : dueKey === tomorrowKey
          ? t('horizons.tomorrow')
          : capitalizeFirst(new Intl.DateTimeFormat(loc, { weekday: 'long' }).format(dateRef));
    const isoTimeLabel =
      parsedIso?.hasTime && parsedIso.date
        ? new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', hour12: false }).format(parsedIso.date)
        : null;
    const baseTimeLabel =
      baseParsed?.hasTime && baseParsed.date
        ? new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', hour12: false }).format(baseParsed.date)
        : null;
    const timeLabel =
      isTrip
        ? tripHm || isoTimeLabel || rootHm || baseTimeLabel || t('timeline.allDuration')
        : rootHm || baseTimeLabel || t('timeline.allDuration');
    return `${dayLabel} • ${timeLabel}`;
  }, [i18n.language, isTrip, meta, row, t, trip]);

  const transcription = useMemo(() => {
    const raw = String(row?.content_raw ?? '').trim();
    if (raw) return raw;
    const memo = str(meta, 'memo');
    return memo ? memo : null;
  }, [meta, row?.content_raw]);

  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  useEffect(() => {
    if (!visible || !row) return;
    const existing = parseChecklistFromMetadata(meta);
    if (existing) {
      setChecklist(existing);
      return;
    }
    const detected = detectChecklistFromText(transcription ?? '');
    setChecklist(detected);
  }, [meta, row, transcription, visible]);

  const [newtonEnabled, setNewtonEnabled] = useState(false);
  const [transportMode, setTransportMode] = useState<'auto' | 'transit' | 'walking' | 'bike'>('auto');
  const [originText, setOriginText] = useState('');
  const [originEditing, setOriginEditing] = useState(false);
  const [arrivalText, setArrivalText] = useState('');
  const [arrivalEditing, setArrivalEditing] = useState(false);
  const arrivalSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [favoriteArrival, setFavoriteArrival] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setNewtonEnabled(getNewtonEnabled(meta));
    setTransportMode(getTransportMode(meta));
    const tMeta = getTripMeta(meta);
    setOriginText(String(str(tMeta, 'origin_address') ?? '').trim());
    setArrivalText(String(str(tMeta, 'location_address') ?? str(meta, 'location_address') ?? '').trim());
    setOriginEditing(false);
    setArrivalEditing(false);
    setSourceExpanded(false);
    setDatePickerOpen(false);
    const memo = str(meta, 'memo');
    const raw = String(row?.content_raw ?? '').trim();
    setSourceDraft(String(memo ?? raw).trim());
    const parsed = parseDueDate(row?.due_date ?? null);
    const now = new Date();
    const initialDate = parsed?.date ? new Date(parsed.date) : new Date();
    if (!parsed?.hasTime && parsed?.date) initialDate.setHours(now.getHours(), now.getMinutes(), 0, 0);
    setPickerDraft(initialDate);
    const allDayFlag = Boolean((meta as Record<string, unknown> | null)?.is_all_day);
    setIsAllDay(allDayFlag || Boolean(parsed && !parsed.hasTime));
  }, [meta, visible]);

  useEffect(
    () => () => {
      if (arrivalSaveTimer.current) clearTimeout(arrivalSaveTimer.current);
      if (originSaveTimer.current) clearTimeout(originSaveTimer.current);
      if (sourceSaveTimer.current) clearTimeout(sourceSaveTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!visible || !isTrip) return;
    const alias = String(str(trip, 'destination_name') ?? '').trim();
    if (!alias) return;
    void (async () => {
      const fav = await getLocationFavoriteByAlias(alias);
      if (!fav) return;
      setFavoriteArrival(fav.formattedAddress);
      if (arrivalText) return;
      if (!row) return;
      const root = safeParseJsonObject(row.metadata_json) ?? {};
      const tripMeta = getTripMeta(root) ?? {};
      const nextMeta: Record<string, unknown> = await touchValidateTrip({
        ...root,
        trip: {
          ...tripMeta,
          location_address: fav.formattedAddress,
          location_place_id: `favorite:${fav.alias}`,
          location_lat: fav.lat,
          location_lng: fav.lng,
          location_source: 'favorite',
        },
      });
      setArrivalText(fav.formattedAddress);
      await updateTrankilV2IntentionLocationAddress(row.id, {
        location_address: fav.formattedAddress,
        metadata_json: JSON.stringify(nextMeta, null, 2),
      });
    })();
  }, [arrivalText, isTrip, row, trip, visible]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
        onPanResponderMove: (_, g) => {
          if (g.dy <= 0) return;
          translateY.setValue(g.dy);
        },
        onPanResponderRelease: (_, g) => {
          const refH = sheetHeight > 0 ? sheetHeight : windowHeight;
          const shouldClose = g.vy > 0.8 || g.dy > Math.min(220, refH * 0.25);
          if (shouldClose) {
            setClosing(true);
            Animated.timing(translateY, {
              toValue: windowHeight,
              duration: 260,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }).start(() => {
              setClosing(false);
              translateY.setValue(0);
              onClose();
            });
            return;
          }
          Animated.timing(translateY, {
            toValue: 0,
            duration: 260,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }).start();
        },
      }),
    [onClose, sheetHeight, translateY, windowHeight],
  );

  useEffect(() => {
    if (!visible) {
      setEntered(false);
      sheetOpacity.setValue(0);
      translateY.setValue(0);
      return;
    }
    setEntered(false);
    sheetOpacity.setValue(0);
    translateY.setValue(windowHeight);
    Animated.parallel([
      Animated.timing(sheetOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 460,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => setEntered(true));
  }, [sheetOpacity, translateY, visible, windowHeight]);

  const persistMeta = async (nextMeta: Record<string, unknown>) => {
    if (!row) return;
    await updateTrankilV2IntentionMetadataJson(row.id, JSON.stringify(nextMeta, null, 2));
  };

  const touchValidateTrip = async (nextMeta: Record<string, unknown>) => {
    const tMeta = getTripMeta(nextMeta);
    if (!tMeta) return nextMeta;
    if (tMeta.validatedAtMs) return nextMeta;
    return {
      ...nextMeta,
      trip: {
        ...tMeta,
        validatedAtMs: Date.now(),
      },
    };
  };

  const onToggleChecklistItem = async (uid: string) => {
    if (!row || !checklist) return;
    const next = checklist.map((it) => (it.uid === uid ? { ...it, checked: !it.checked } : it));
    setChecklist(next);
    const json = mergeChecklistIntoMetadataJson(row.metadata_json, next);
    const root = safeParseJsonObject(json) ?? {};
    const nextMeta = isTrip ? await touchValidateTrip(root) : root;
    await updateTrankilV2IntentionMetadataJson(row.id, JSON.stringify(nextMeta, null, 2));
  };

  const onToggleNewton = async () => {
    if (!row) return;
    const nextEnabled = !newtonEnabled;
    setNewtonEnabled(nextEnabled);
    const root = safeParseJsonObject(row.metadata_json) ?? {};
    const tripMeta = getTripMeta(root) ?? {};
    let nextMeta: Record<string, unknown> = {
      ...root,
      trip: {
        ...tripMeta,
        newtonEnabled: nextEnabled,
      },
    };
    nextMeta = await touchValidateTrip(nextMeta);
    await persistMeta(nextMeta);
  };

  const onSelectTransportMode = async (mode: 'auto' | 'transit' | 'walking' | 'bike') => {
    if (!row) return;
    setTransportMode(mode);
    onPatchRow?.(row.id, { transport_mode: mode });
    const root = safeParseJsonObject(row.metadata_json) ?? {};
    const tripMeta = getTripMeta(root) ?? {};
    let nextMeta: Record<string, unknown> = {
      ...root,
      trip: {
        ...tripMeta,
        transportMode: mode,
      },
    };
    nextMeta = await touchValidateTrip(nextMeta);
    await updateTrankilV2IntentionTransportMode(
      row.id,
      { transport_mode: mode, metadata_json: JSON.stringify(nextMeta, null, 2) },
    );
  };

  const persistDueDateTime = async (d: Date) => {
    if (!row) return;
    const ymd = formatYmd(d);
    const nextDue = isAllDay ? ymd : formatLocalIsoNoZ(d);
    const root = safeParseJsonObject(row.metadata_json) ?? {};
    const nextTimeHm = isAllDay ? null : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const nextMeta: Record<string, unknown> = {
      ...root,
      is_all_day: isAllDay ? 1 : 0,
      dueDateTime: isAllDay ? null : nextDue,
      dueDateYmd: ymd,
      dueTimeHm: nextTimeHm,
      trip:
        isTrip && trip
          ? {
              ...(trip as Record<string, unknown>),
              dueDateTime: isAllDay ? null : nextDue,
              dueDateYmd: ymd,
              dueTimeHm: nextTimeHm,
              arrivalDue: isAllDay ? null : nextDue,
            }
          : root.trip,
    };
    onPatchRow?.(row.id, { due_date: nextDue, metadata_json: JSON.stringify(nextMeta, null, 2) });
    setDatePickerOpen(false);
    setPickerDraft(d);
    await updateTrankilV2IntentionTemporal(row.id, { due_date: nextDue, metadata_json: JSON.stringify(nextMeta, null, 2) });
  };

  const openTemporalPicker = () => {
    if (!row) return;
    const base = parseDueDate(row.due_date)?.date ?? new Date();
    if (Platform.OS === 'android') {
      void (async () => {
        const m = await import('@react-native-community/datetimepicker');
        const DateTimePickerAndroid = (m as unknown as { DateTimePickerAndroid?: any }).DateTimePickerAndroid;
        if (!DateTimePickerAndroid?.open) return;
        setDatePickerOpen(true);
        await new Promise<void>((resolve) => {
          DateTimePickerAndroid.open({
            value: base,
            mode: 'date',
            is24Hour: true,
            onChange: (event: { type?: string }, date?: Date) => {
              if (String(event?.type ?? '') === 'dismissed') {
                setDatePickerOpen(false);
                resolve();
                return;
              }
              const picked = date ?? base;
              if (isAllDay) {
                void persistDueDateTime(picked).finally(resolve);
                return;
              }
              DateTimePickerAndroid.open({
                value: picked,
                mode: 'time',
                is24Hour: true,
                onChange: (event2: { type?: string }, time?: Date) => {
                  if (String(event2?.type ?? '') === 'dismissed') {
                    setDatePickerOpen(false);
                    resolve();
                    return;
                  }
                  const final = new Date(picked);
                  const t = time ?? picked;
                  final.setHours(t.getHours(), t.getMinutes(), 0, 0);
                  void persistDueDateTime(final).finally(resolve);
                },
              });
            },
          });
        });
      })();
      return;
    }
    setPickerDraft(base);
    setDatePickerOpen((v) => !v);
  };

  const onPickedDateTimeIos = (event: { type?: string }, date?: Date) => {
    const type = String(event?.type ?? '');
    if (type === 'dismissed') {
      setDatePickerOpen(false);
      return;
    }
    if (!date) return;
    void persistDueDateTime(date);
  };

  const showTriangle = false;
  const destinationLabel = useMemo(() => {
    const dest = str(trip, 'destination_name') ?? str(trip, 'destination') ?? str(trip, 'destinationName');
    if (dest) return dest;
    const title = String(row?.display_title ?? '').trim();
    return title || null;
  }, [row?.display_title, trip]);

  const ecoBadge = transportMode === 'walking' || transportMode === 'bike';
  const originDisplay = originText.trim() ? originText.trim() : t('intentionDetail.currentPosition');
  const arrivalDisplay = arrivalText.trim() ? arrivalText.trim() : favoriteArrival ? favoriteArrival : destinationLabel;
  const arrivalIsAddress = Boolean(arrivalText.trim() || favoriteArrival);
  const sheetTargetHeight = useMemo(() => Math.max(240, Math.round(windowHeight * (sourceExpanded ? 0.92 : 0.86))), [sourceExpanded, windowHeight]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} hardwareAccelerated>
      <View style={styles.modalRoot}>
        <Pressable disabled={closing} style={styles.backdrop} onPress={onClose} />
        <Animated.View
          onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
          renderToHardwareTextureAndroid
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              paddingBottom: Math.max(insets.bottom, 12),
              height: sheetTargetHeight,
              opacity: sheetOpacity,
              transform: [{ translateY }],
            },
          ]}
          {...panResponder.panHandlers}
        >
          <View style={[styles.grabber, { backgroundColor: theme.colors.outlineVariant }]} />
          <KeyboardAvoidingView
            enabled={Platform.OS === 'ios'}
            behavior="padding"
            keyboardVerticalOffset={24}
            style={styles.kbRoot}
          >
            <View style={styles.headerRow}>
              <View style={styles.headerTitleRow}>
                <Text style={[styles.headerTitle, { color: theme.colors.onSurface }]} numberOfLines={2}>
                  {String(row?.display_title ?? '').trim() || t('timeline.untitled')}
                </Text>
                <IconButton
                  icon="note-text-outline"
                  size={18}
                  iconColor={theme.colors.onSurfaceVariant}
                  style={styles.noteIcon}
                  onPress={() => setSourceExpanded((v) => !v)}
                />
              </View>
              {showTriangle ? <View style={styles.warningWrap} /> : null}
            </View>

            {sourceExpanded ? (
              <View style={styles.sourceWrap}>
                <TextInput
                  value={sourceDraft}
                  onChangeText={(text) => {
                    setSourceDraft(text);
                    if (!row) return;
                    if (sourceSaveTimer.current) clearTimeout(sourceSaveTimer.current);
                    sourceSaveTimer.current = setTimeout(() => {
                      sourceSaveTimer.current = null;
                      void (async () => {
                        const root = safeParseJsonObject(row.metadata_json) ?? {};
                        const nextMeta: Record<string, unknown> = { ...root, memo: String(text ?? '').trim() };
                        await updateTrankilV2IntentionMetadataJson(row.id, JSON.stringify(nextMeta, null, 2));
                      })();
                    }, 250);
                  }}
                  placeholder={transcription ?? ''}
                  placeholderTextColor="rgba(100,116,139,0.72)"
                  multiline
                  style={[styles.sourceInput, { color: theme.colors.onSurfaceVariant }]}
                />
              </View>
            ) : null}

            <View style={styles.logicBlock}>
              {subtitle ? (
                <Pressable
                  onPress={openTemporalPicker}
                  android_ripple={{ color: 'rgba(15, 23, 42, 0.06)' }}
                  style={({ pressed }) => [styles.subtitlePress, { opacity: pressed ? 0.88 : 1 }]}
                >
                  <View pointerEvents="none" style={styles.addrIconWrap}>
                    <IconButton
                      icon="calendar-month-outline"
                      size={18}
                      iconColor={theme.colors.onSurfaceVariant}
                      style={styles.addrIcon}
                    />
                  </View>
                  <Text style={[styles.subtitleInline, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                    {subtitle}
                  </Text>
                </Pressable>
              ) : null}

              {datePickerOpen && Platform.OS === 'ios' ? (
                <View style={styles.pickerBlock}>
                  <View style={styles.allDayRow}>
                    <Text style={[styles.allDayLabel, { color: theme.colors.onSurfaceVariant }]}>Toute la journée</Text>
                    <Switch
                      value={isAllDay}
                      onValueChange={(v) => {
                        setIsAllDay(v);
                        const now = new Date();
                        const base = new Date(pickerDraft);
                        if (!v) base.setHours(now.getHours(), now.getMinutes(), 0, 0);
                        setPickerDraft(base);
                        void persistDueDateTime(base);
                      }}
                    />
                  </View>
                  <DateTimePickerLazy
                    value={pickerDraft}
                    mode={isAllDay ? 'date' : 'datetime'}
                    display={isAllDay ? 'inline' : 'compact'}
                    onChange={onPickedDateTimeIos}
                  />
                </View>
              ) : null}

              {datePickerOpen && Platform.OS === 'android' ? (
                <View style={styles.pickerBlock}>
                  <View style={styles.allDayRow}>
                    <Text style={[styles.allDayLabel, { color: theme.colors.onSurfaceVariant }]}>Toute la journée</Text>
                    <Switch
                      value={isAllDay}
                      onValueChange={(v) => {
                        setIsAllDay(v);
                        const now = new Date();
                        const base = new Date(pickerDraft);
                        if (!v) base.setHours(now.getHours(), now.getMinutes(), 0, 0);
                        setPickerDraft(base);
                        void persistDueDateTime(base);
                      }}
                    />
                  </View>
                </View>
              ) : null}

              {isTrip ? (
                <View style={styles.addrBlock}>
                  <View style={styles.addrRow}>
                    <View pointerEvents="none" style={styles.addrIconWrap}>
                      <IconButton icon="map-marker-radius" size={18} iconColor={theme.colors.onSurfaceVariant} style={styles.addrIcon} />
                    </View>
                    <View style={styles.addrTextCol}>
                      {originEditing ? (
                        <GooglePlacesAutocompleteField
                          value={originText}
                          onChangeText={(text) => {
                            setOriginText(text);
                            if (!row) return;
                            const raw = text.trim();
                            const root = safeParseJsonObject(row.metadata_json) ?? {};
                            const tripMeta = getTripMeta(root) ?? {};
                            if (originSaveTimer.current) clearTimeout(originSaveTimer.current);
                            originSaveTimer.current = setTimeout(() => {
                              originSaveTimer.current = null;
                              void (async () => {
                                const nextMeta = await touchValidateTrip({
                                  ...root,
                                  trip: { ...tripMeta, origin_address: raw },
                                });
                                await updateTrankilV2IntentionMetadataJson(row.id, JSON.stringify(nextMeta, null, 2));
                              })();
                            }, 250);
                          }}
                          onSelect={(p) => {
                            setOriginText(p.formattedAddress);
                            setOriginEditing(false);
                            if (!row) return;
                            const root = safeParseJsonObject(row.metadata_json) ?? {};
                            const tripMeta = getTripMeta(root) ?? {};
                            void (async () => {
                              const nextMeta = await touchValidateTrip({
                                ...root,
                                trip: {
                                  ...tripMeta,
                                  origin_address: p.formattedAddress,
                                  origin_place_id: p.placeId,
                                  origin_lat: p.lat,
                                  origin_lng: p.lng,
                                },
                              });
                              await updateTrankilV2IntentionMetadataJson(row.id, JSON.stringify(nextMeta, null, 2));
                            })();
                          }}
                          disabled={false}
                          language={i18n.language}
                          placeholder={t('intentionDetail.addressPlaceholder')}
                          missingKeyLabel={t('sentinel.placesMissingKey')}
                        />
                      ) : (
                        <Pressable
                          onPress={() => setOriginEditing(true)}
                          style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1 }]}
                        >
                          <Text style={[styles.addrValue, { color: theme.colors.onSurface }]} numberOfLines={2}>
                            {originDisplay}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>

                  <View style={styles.addrRow}>
                    <View pointerEvents="none" style={styles.addrIconWrap}>
                      <IconButton icon="flag-checkered" size={18} iconColor={theme.colors.onSurfaceVariant} style={styles.addrIcon} />
                    </View>
                    <View style={styles.addrTextCol}>
                      {arrivalEditing ? (
                        <GooglePlacesAutocompleteField
                          value={arrivalText}
                          onChangeText={(text) => {
                            setArrivalText(text);
                            if (!row) return;
                            const raw = text.trim();
                            const root = safeParseJsonObject(row.metadata_json) ?? {};
                            const tripMeta = getTripMeta(root) ?? {};
                            if (arrivalSaveTimer.current) clearTimeout(arrivalSaveTimer.current);
                            arrivalSaveTimer.current = setTimeout(() => {
                              arrivalSaveTimer.current = null;
                              void (async () => {
                                const nextMeta = await touchValidateTrip({
                                  ...root,
                                  trip: {
                                    ...tripMeta,
                                    location_address: raw,
                                    location_place_id: null,
                                    location_lat: null,
                                    location_lng: null,
                                  },
                                });
                                await updateTrankilV2IntentionLocationAddress(row.id, {
                                  location_address: raw || null,
                                  metadata_json: JSON.stringify(nextMeta, null, 2),
                                });
                              })();
                            }, 250);
                          }}
                          onSelect={(p) => {
                            setArrivalText(p.formattedAddress);
                            setArrivalEditing(false);
                            if (!row) return;
                            const root = safeParseJsonObject(row.metadata_json) ?? {};
                            const tripMeta = getTripMeta(root) ?? {};
                            void (async () => {
                              const nextMeta = await touchValidateTrip({
                                ...root,
                                trip: {
                                  ...tripMeta,
                                  location_address: p.formattedAddress,
                                  location_place_id: p.placeId,
                                  location_lat: p.lat,
                                  location_lng: p.lng,
                                  location_source: 'places',
                                },
                              });
                              await updateTrankilV2IntentionLocationAddress(row.id, {
                                location_address: p.formattedAddress,
                                metadata_json: JSON.stringify(nextMeta, null, 2),
                              });
                            })();
                          }}
                          disabled={false}
                          language={i18n.language}
                          placeholder={t('intentionDetail.addressPlaceholder')}
                          missingKeyLabel={t('sentinel.placesMissingKey')}
                        />
                      ) : (
                        <Pressable
                          onPress={() => setArrivalEditing(true)}
                          style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1 }]}
                        >
                          <Text
                            style={[styles.addrValue, { color: arrivalIsAddress ? theme.colors.onSurfaceVariant : theme.colors.onSurface }]}
                            numberOfLines={2}
                          >
                            {arrivalDisplay || '—'}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                </View>
              ) : null}
            </View>

            <ScrollView
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {!entered ? <View style={styles.enterPlaceholder} /> : null}
              {entered ? (
                <>
                  {checklist ? (
                    <View style={styles.section}>
                      <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>{t('intentionDetail.checklist')}</Text>
                      <View style={styles.checklist}>
                        {checklist.map((it) => (
                          <Pressable
                            key={it.uid}
                            onPress={() => void onToggleChecklistItem(it.uid)}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: it.checked }}
                            style={({ pressed }) => [styles.checkRow, { opacity: pressed ? 0.9 : 1 }]}
                          >
                            <View
                              style={[
                                styles.checkbox,
                                {
                                  borderColor: it.checked ? theme.colors.primary : theme.colors.outline,
                                  backgroundColor: it.checked ? theme.colors.primaryContainer : 'transparent',
                                },
                              ]}
                            >
                              {it.checked ? <Text style={{ color: theme.colors.primary, fontWeight: '900' }}>✓</Text> : null}
                            </View>
                            <Text
                              style={[
                                styles.checkText,
                                {
                                  color: it.checked ? theme.colors.onSurfaceVariant : theme.colors.onSurface,
                                  textDecorationLine: it.checked ? 'line-through' : 'none',
                                },
                              ]}
                            >
                              {it.text}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ) : null}

                  {isTrip ? (
                    <View style={styles.section}>
                      <View style={styles.transportRow}>
                        {(
                          [
                            { key: 'auto', icon: 'car', label: t('intentionDetail.transportAuto') },
                            { key: 'transit', icon: 'bus', label: t('intentionDetail.transportTransit') },
                            { key: 'walking', icon: 'walk', label: t('intentionDetail.transportWalking') },
                            { key: 'bike', icon: 'bike', label: t('intentionDetail.transportBike') },
                          ] as const
                        ).map((m) => {
                          const active = transportMode === m.key;
                          return (
                            <Pressable
                              key={m.key}
                              onPress={() => void onSelectTransportMode(m.key)}
                              style={({ pressed }) => [
                                styles.transportBtn,
                                {
                                  borderColor: active ? theme.colors.primary : theme.colors.outlineVariant,
                                  backgroundColor: active ? theme.colors.primaryContainer : theme.colors.surfaceVariant,
                                  opacity: pressed ? 0.88 : 1,
                                },
                              ]}
                              accessibilityRole="button"
                              accessibilityLabel={m.label}
                            >
                              <IconButton icon={m.icon} size={22} iconColor={theme.colors.onSurface} style={styles.transportIcon} />
                            </Pressable>
                          );
                        })}
                      </View>

                      <View style={styles.impactSlot}>
                        {ecoBadge ? (
                          <View style={[styles.badge, { backgroundColor: theme.colors.tertiaryContainer }]}>
                            <Text style={[styles.badgeText, { color: theme.colors.onTertiaryContainer }]}>
                              {t('intentionDetail.ecoFriendly')}
                            </Text>
                          </View>
                        ) : (
                          <Text style={[styles.co2Text, { color: theme.colors.onSurfaceVariant }]}>
                            {t('intentionDetail.co2Standard')}
                          </Text>
                        )}
                      </View>

                      <View style={styles.newtonRow}>
                        <Text style={[styles.switchLabel, { color: theme.colors.onSurfaceVariant }]}>{t('intentionDetail.newton')}</Text>
                        <Switch value={newtonEnabled} onValueChange={() => void onToggleNewton()} />
                      </View>
                    </View>
                  ) : null}
                </>
              ) : null}
            </ScrollView>

            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <Button
                mode="contained"
                onPress={() =>
                  void openNavigationUniversal({
                    origin: originText.trim() ? originText.trim() : null,
                    destination: arrivalDisplay ?? '',
                    mode: transportMode,
                  })
                }
                disabled={!arrivalDisplay}
                style={styles.footerBtn}
              >
                {t('intentionDetail.launchRoute')}
              </Button>
            </View>
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    overflow: 'hidden',
  },
  kbRoot: { flex: 1 },
  grabber: { alignSelf: 'center', width: 56, height: 5, borderRadius: 5, marginBottom: 12 },
  headerRow: { paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  headerTitleRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: '900', lineHeight: 22 },
  noteIcon: { margin: 0, padding: 0, marginTop: -2 },
  warningWrap: { marginTop: -6 },
  sourceWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  sourceInput: {
    minHeight: 90,
    maxHeight: 160,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  logicBlock: { paddingHorizontal: 16, paddingBottom: 6, gap: 16 },
  subtitlePress: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, paddingVertical: 2 },
  subtitleInline: { fontSize: 13, fontWeight: '800', opacity: 0.88 },
  pickerBlock: { marginTop: -6 },
  allDayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  allDayLabel: { fontSize: 13, fontWeight: '800' },
  addrBlock: { gap: 10 },
  addrRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  addrIconWrap: { marginTop: -6 },
  addrIcon: { margin: 0, padding: 0 },
  addrTextCol: { flex: 1, minWidth: 0, justifyContent: 'center' },
  addrValue: { fontSize: 14, fontWeight: '800', lineHeight: 18 },
  content: { paddingHorizontal: 16, paddingBottom: 140 },
  section: { marginTop: 12, gap: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '900' },
  checklist: { gap: 10 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  checkText: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '700' },
  switchLabel: { fontSize: 13, fontWeight: '800' },
  transportRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 18, marginTop: 4 },
  transportBtn: { width: 52, height: 52, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  transportIcon: { margin: 0, padding: 0 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  badgeText: { fontSize: 12, fontWeight: '900' },
  co2Text: { fontSize: 12, fontWeight: '700' },
  impactSlot: { height: 32, justifyContent: 'center' },
  newtonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footer: { paddingHorizontal: 16, paddingTop: 10 },
  footerBtn: { borderRadius: 16 },
  enterPlaceholder: { height: 240 },
});
