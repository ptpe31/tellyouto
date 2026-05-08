import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ActionSheetIOS,
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  LayoutAnimation,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MD3Theme } from 'react-native-paper';
import { Button, IconButton, Switch } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';

import type { TrankilV2TimelineItemRow } from '../api';
import {
  patchMetadata,
  getTrankilV2IntentionById,
  getZoomChildrenStatsForProjectMilestone,
  listZoomChildrenForProjectMilestone,
  toggleIntentionDone,
  updateIntention,
  updateTrankilV2IntentionLocationAddress,
  updateTrankilV2IntentionRemindToLeave,
  updateTrankilV2IntentionTemporal,
  updateTrankilV2IntentionTransportMode,
} from '../api/trankilV2Db';
import { addDaysYmd, formatYmdLocal } from '../services/TimeSorter';
import { GooglePlacesAutocompleteField } from './traffic/GooglePlacesAutocompleteField';
import { reconcileSentinelForIntentionId } from '../services/traffic/sentinelReconciler';
import { getLocationFavoriteByAlias } from '../services/traffic/locationFavorites';
import { buildListMetadataPatch, parseListScalablePayloadFromMetadataJson, type ListScalablePayload } from '../services/listIntentionModel';
import {
  buildProjectMilestonesMetadataPatch,
  parseProjectMilestonesPayloadFromMetadataJson,
  type ProjectMilestonesPayload,
} from '../services/projectMilestonesModel';
import { useOptionalIntentionContext } from '../context/IntentionContext';

type Props = {
  visible: boolean;
  row: TrankilV2TimelineItemRow | null;
  theme: MD3Theme;
  onClose: () => void;
  onPatchRow?: (id: string, patch: Partial<TrankilV2TimelineItemRow>) => void;
  initialPosition?: 'peek' | 'full';
  peekHeightPx?: number;
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

function categoryLabelKey(raw: string | null | undefined): string | null {
  const up = String(raw || '').trim().toUpperCase();
  if (!up) return null;
  if (up === 'FAMILLE') return 'category.HOME';
  if (up === 'PRO') return 'category.WORK';
  if (['HOME', 'WORK', 'PERSO', 'HEALTH', 'FINANCE', 'TRAVEL', 'SOCIAL', 'SHOP', 'LEARN', 'OTHER'].includes(up)) {
    return `category.${up}`;
  }
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

function dateNoonFromYmd(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split('-').map((x) => Number(x));
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function durationMs(unit: string, value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (unit === 'hours') return n * 60 * 60 * 1000;
  if (unit === 'weeks') return n * 7 * 24 * 60 * 60 * 1000;
  return n * 24 * 60 * 60 * 1000;
}

function formatDurationLabel(value: number, unit: string, lng: string): string {
  const n = Number(value);
  const count = Number.isFinite(n) ? n : 0;
  const isFr = String(lng || '').toLowerCase().startsWith('fr');
  if (isFr) {
    if (unit === 'hours') return `${count} heure${count > 1 ? 's' : ''}`;
    if (unit === 'weeks') return `${count} semaine${count > 1 ? 's' : ''}`;
    return `${count} jour${count > 1 ? 's' : ''}`;
  }
  if (unit === 'hours') return `${count} hour${count > 1 ? 's' : ''}`;
  if (unit === 'weeks') return `${count} week${count > 1 ? 's' : ''}`;
  return `${count} day${count > 1 ? 's' : ''}`;
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

export function IntentionDetailSheet({ visible, row, theme, onClose, onPatchRow, initialPosition, peekHeightPx }: Props) {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const peekHeight = Math.max(40, Math.round(Number(peekHeightPx ?? 40) || 40));
  const translateY = useRef(new Animated.Value(0)).current;
  const sheetOpacity = useRef(new Animated.Value(0)).current;
  const tripControlsOpacity = useRef(new Animated.Value(0)).current;
  const [sheetHeight, setSheetHeight] = useState(0);
  const [closing, setClosing] = useState(false);
  const [entered, setEntered] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const [sourceDraft, setSourceDraft] = useState('');
  const sourceSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const windowHeight = useMemo(() => Math.max(1, Dimensions.get('window').height), []);
  const sheetTargetHeight = useMemo(
    () => Math.max(240, Math.round(windowHeight * (sourceExpanded ? 0.92 : 0.86))),
    [sourceExpanded, windowHeight],
  );
  const peekTranslateY = useMemo(() => Math.max(0, sheetTargetHeight - peekHeight), [peekHeight, sheetTargetHeight]);
  const [sheetPosition, setSheetPosition] = useState<'peek' | 'full'>('full');
  const peekAutoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [pickerDraft, setPickerDraft] = useState<Date>(new Date());
  const [isAllDay, setIsAllDay] = useState(false);
  const [remindToLeaveEnabled, setRemindToLeaveEnabled] = useState(false);
  const [showTripControls, setShowTripControls] = useState(false);
  const [originLat, setOriginLat] = useState<number | null>(null);
  const [originLng, setOriginLng] = useState<number | null>(null);
  const [arrivalLat, setArrivalLat] = useState<number | null>(null);
  const [arrivalLng, setArrivalLng] = useState<number | null>(null);
  const [listPayload, setListPayload] = useState<ListScalablePayload | null>(null);
  const [projectPayload, setProjectPayload] = useState<ProjectMilestonesPayload | null>(null);
  const [projectStartPickerOpen, setProjectStartPickerOpen] = useState(false);
  const [projectStartDraft, setProjectStartDraft] = useState<Date>(new Date());
  const [projectStartDraftYmd, setProjectStartDraftYmd] = useState<string | null>(null);
  const [projectPivotDraftByUid, setProjectPivotDraftByUid] = useState<Record<string, string | null>>({});
  const [projectDatesDirty, setProjectDatesDirty] = useState(false);
  const [pivotPickerUid, setPivotPickerUid] = useState<string | null>(null);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteUid, setNoteUid] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const skeletonPulse = useRef(new Animated.Value(0.55)).current;
  const titleInputRef = useRef<TextInput | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleEditing, setTitleEditing] = useState(false);
  const lastTitleRef = useRef('');
  const intentionFlow = useOptionalIntentionContext();
  const [zoomModalUid, setZoomModalUid] = useState<string | null>(null);
  const [zoomModalPhase, setZoomModalPhase] = useState<'confirm' | 'generating' | 'success'>('confirm');
  const [zoomModalSuccessCount, setZoomModalSuccessCount] = useState(0);
  const [zoomDots, setZoomDots] = useState('');
  const [zoomProcessingUid, setZoomProcessingUid] = useState<string | null>(null);
  const [zoomChildrenByUid, setZoomChildrenByUid] = useState<
    Record<string, { id: string; title: string; status: 'TODO' | 'DONE' | 'ARCHIVED' }[]>
  >({});
  const [zoomCountByUid, setZoomCountByUid] = useState<Record<string, number>>({});
  const [zoomDoneByUid, setZoomDoneByUid] = useState<Record<string, number>>({});
  const [zoomExpandedByUid, setZoomExpandedByUid] = useState<Record<string, boolean>>({});
  const [zoomLoadingByUid, setZoomLoadingByUid] = useState<Record<string, boolean>>({});
  const zoomModalUidRef = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const milestoneYRef = useRef<Record<string, number>>({});
  const restoredZoomRef = useRef(false);

  const meta = useMemo(() => safeParseJsonObject(row?.metadata_json), [row?.metadata_json]);
  const trip = useMemo(() => getTripMeta(meta), [meta]);
  const isTrip = Boolean(trip);
  const isProject = Boolean(row && row.type === 'PROJECT');
  const isList = Boolean(row && row.type === 'LIST');
  const isGenerating = Boolean(meta && (meta as Record<string, unknown>).is_generating);
  const categoryTabLabel = useMemo(() => {
    const key = categoryLabelKey(row?.category_id);
    if (key) return t(key);
    const raw = String(row?.category_id ?? '').trim();
    return raw ? raw : t('category.OTHER');
  }, [row?.category_id, t]);
  const multiIntents = useMemo(() => {
    const raw = (meta as any)?.intents;
    return Array.isArray(raw) ? raw : [];
  }, [meta]);
  const slot2Label = useMemo(() => {
    const it = multiIntents[1] as any;
    const v = typeof it?.type === 'string' ? it.type : '';
    return v ? v : '2';
  }, [multiIntents]);
  const slot3Label = useMemo(() => {
    const it = multiIntents[2] as any;
    const v = typeof it?.type === 'string' ? it.type : '';
    return v ? v : '3';
  }, [multiIntents]);
  const showSlot2 = multiIntents.length > 1;
  const showSlot3 = multiIntents.length > 2;

  useEffect(() => {
    if (!visible || !row || !isTrip) return;
    let cancelled = false;
    const id = row.id;
    void (async () => {
      const full = await getTrankilV2IntentionById(id);
      if (cancelled) return;
      setRemindToLeaveEnabled(Boolean(full?.remind_to_leave));
    })();
    return () => {
      cancelled = true;
    };
  }, [isTrip, row?.id, visible]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      const fn = (UIManager as unknown as { setLayoutAnimationEnabledExperimental?: (enabled: boolean) => void })
        .setLayoutAnimationEnabledExperimental;
      fn?.(true);
    }
  }, []);

  useEffect(() => {
    const next = String(row?.display_title ?? '').trim();
    setTitleDraft(next);
    lastTitleRef.current = next;
    setTitleEditing(false);
  }, [row?.id, row?.display_title]);

  useEffect(() => {
    restoredZoomRef.current = false;
  }, [row?.id]);

  const persistTitleIfNeeded = async () => {
    if (!row) return;
    const prev = String(lastTitleRef.current || '').trim();
    const next = String(titleDraft || '').trim();
    if (!next) {
      setTitleDraft(prev);
      setTitleEditing(false);
      return;
    }
    if (next === prev) {
      setTitleEditing(false);
      return;
    }
    await updateIntention(row.id, { content: next });
    lastTitleRef.current = next;
    setTitleDraft(next);
    setTitleEditing(false);
    onPatchRow?.(row.id, { display_title: next });
  };

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
    const oLat = Number((tMeta as any)?.origin_lat);
    const oLng = Number((tMeta as any)?.origin_lng);
    setOriginLat(Number.isFinite(oLat) ? oLat : null);
    setOriginLng(Number.isFinite(oLng) ? oLng : null);
    const aLat = Number((tMeta as any)?.location_lat);
    const aLng = Number((tMeta as any)?.location_lng);
    setArrivalLat(Number.isFinite(aLat) ? aLat : null);
    setArrivalLng(Number.isFinite(aLng) ? aLng : null);
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
    setListPayload(parseListScalablePayloadFromMetadataJson(row?.metadata_json));
    const nextProjectPayload = parseProjectMilestonesPayloadFromMetadataJson(row?.metadata_json);
    setProjectPayload(nextProjectPayload);
    const startYmd = (() => {
      const p = meta?.project;
      if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
      const ymd = String((p as Record<string, unknown>).start_date ?? '').trim();
      return ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
    })();
    setProjectStartDraftYmd(startYmd);
    setProjectStartDraft(dateNoonFromYmd(startYmd ?? '') ?? new Date());
    const pivots: Record<string, string | null> = {};
    for (const m of nextProjectPayload?.milestones ?? []) {
      pivots[m.uid] = m.pivot_date ?? null;
    }
    setProjectPivotDraftByUid(pivots);
    setProjectDatesDirty(false);
    setProjectStartPickerOpen(false);
    setPivotPickerUid(null);
    setNoteModalOpen(false);
    setNoteUid(null);
    setNoteDraft('');
    if (row?.type === 'PROJECT' && nextProjectPayload) {
      const rawObj = safeParseJsonObject(row.metadata_json) ?? {};
      const block = rawObj.project_milestones_v1 as any;
      const rawMs = block && typeof block === 'object' && Array.isArray(block.milestones) ? (block.milestones as any[]) : [];
      const missingUid = rawMs.some((x) => !x || typeof x !== 'object' || !String((x as any).uid ?? '').trim());
      if (missingUid) {
        void patchMetadata(row.id, buildProjectMilestonesMetadataPatch(nextProjectPayload), { silent: true });
      }
    }
  }, [meta, visible]);

  const comfortReady = useMemo(() => {
    if (!isTrip) return false;
    return Number.isFinite(Number(arrivalLat)) && Number.isFinite(Number(arrivalLng));
  }, [arrivalLat, arrivalLng, isTrip]);

  const showMission = isTrip && showTripControls;
  const isNewtonSurveillable = useMemo(() => {
    if (!showMission) return false;
    if (isAllDay) return false;
    const placeId = String(str(trip as any, 'location_place_id') ?? '').trim();
    const address = String(str(trip as any, 'location_address') ?? str(meta as any, 'location_address') ?? '').trim();
    const lat = Number((trip as any)?.location_lat);
    const lng = Number((trip as any)?.location_lng);
    const arrivalIso = String(
      str(trip as any, 'arrivalDue') ?? str(trip as any, 'dueDateTime') ?? str(meta as any, 'dueDateTime') ?? '',
    ).trim();
    const arrivalOk = arrivalIso ? Number.isFinite(Date.parse(arrivalIso)) : false;
    return Boolean(placeId && address && Number.isFinite(lat) && Number.isFinite(lng) && arrivalOk);
  }, [isAllDay, meta, showMission, trip]);
  const showSurveillanceMissing = showMission && !isNewtonSurveillable;

  const routeReady = useMemo(() => {
    if (!isTrip) return false;
    return (
      Number.isFinite(Number(originLat)) &&
      Number.isFinite(Number(originLng)) &&
      Number.isFinite(Number(arrivalLat)) &&
      Number.isFinite(Number(arrivalLng))
    );
  }, [arrivalLat, arrivalLng, isTrip, originLat, originLng]);

  useEffect(() => {
    if (remindToLeaveEnabled) {
      setShowTripControls(true);
      tripControlsOpacity.stopAnimation();
      Animated.timing(tripControlsOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      return;
    }
    tripControlsOpacity.stopAnimation();
    Animated.timing(tripControlsOpacity, { toValue: 0, duration: 140, useNativeDriver: true }).start(() => {
      setShowTripControls(false);
    });
  }, [remindToLeaveEnabled, tripControlsOpacity]);

  useEffect(
    () => () => {
      if (arrivalSaveTimer.current) clearTimeout(arrivalSaveTimer.current);
      if (originSaveTimer.current) clearTimeout(originSaveTimer.current);
      if (sourceSaveTimer.current) clearTimeout(sourceSaveTimer.current);
    },
    [],
  );

  const persistListPayload = async (next: ListScalablePayload) => {
    if (!row) return;
    await patchMetadata(row.id, buildListMetadataPatch(next), { silent: true });
  };

  const setProjectStartDraftFromDate = (date: Date) => {
    const ymd = formatYmd(date);
    setProjectStartDraft(date);
    setProjectStartDraftYmd(ymd);
    setProjectDatesDirty(true);
  };

  const openProjectStartPicker = () => {
    if (!row) return;
    if (Platform.OS === 'android') {
      void (async () => {
        const m = await import('@react-native-community/datetimepicker');
        const DateTimePickerAndroid = (m as unknown as { DateTimePickerAndroid?: any }).DateTimePickerAndroid;
        if (!DateTimePickerAndroid?.open) return;
        setProjectStartPickerOpen(true);
        await new Promise<void>((resolve) => {
          DateTimePickerAndroid.open({
            value: projectStartDraft,
            mode: 'date',
            is24Hour: true,
            onChange: (event: { type?: string }, date?: Date) => {
              if (String(event?.type ?? '') === 'dismissed') {
                setProjectStartPickerOpen(false);
                resolve();
                return;
              }
              if (date) {
                setProjectStartDraftFromDate(date);
              }
              setProjectStartPickerOpen(false);
              resolve();
            },
          });
        });
      })();
      return;
    }
    setProjectStartPickerOpen((v) => !v);
  };

  useEffect(() => {
    if (!visible || !isGenerating) return;
    skeletonPulse.setValue(0.55);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(skeletonPulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(skeletonPulse, { toValue: 0.55, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [isGenerating, skeletonPulse, visible]);

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
      const tripPatch: Record<string, unknown> = {
        location_address: fav.formattedAddress,
        location_place_id: `favorite:${fav.alias}`,
        location_lat: fav.lat,
        location_lng: fav.lng,
        location_source: 'favorite',
      };
      if (!tripMeta.validatedAtMs) tripPatch.validatedAtMs = Date.now();
      setArrivalText(fav.formattedAddress);
      await updateTrankilV2IntentionLocationAddress(row.id, { location_address: fav.formattedAddress }, { silent: true });
      await patchMetadata(row.id, { trip: tripPatch });
    })();
  }, [arrivalText, isTrip, row, trip, visible]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
        onPanResponderMove: (_, g) => {
          if (peekAutoCloseTimer.current) {
            clearTimeout(peekAutoCloseTimer.current);
            peekAutoCloseTimer.current = null;
          }
          if (sheetPosition === 'full') {
            if (g.dy <= 0) return;
            translateY.setValue(g.dy);
            return;
          }
          const next = Math.max(0, Math.min(windowHeight, peekTranslateY + g.dy));
          translateY.setValue(next);
        },
        onPanResponderRelease: (_, g) => {
          const closeWithSpring = () => {
            setClosing(true);
            Animated.spring(translateY, {
              toValue: windowHeight,
              damping: 30,
              stiffness: 220,
              mass: 0.9,
              useNativeDriver: true,
            }).start(() => {
              setClosing(false);
              translateY.setValue(0);
              onClose();
            });
          };
          const snapPeek = () => {
            setSheetPosition('peek');
            Animated.spring(translateY, {
              toValue: peekTranslateY,
              damping: 28,
              stiffness: 220,
              mass: 0.9,
              useNativeDriver: true,
            }).start();
            if (peekAutoCloseTimer.current) clearTimeout(peekAutoCloseTimer.current);
            peekAutoCloseTimer.current = setTimeout(closeWithSpring, 4000);
          };
          const openFull = () => {
            setSheetPosition('full');
            Animated.spring(translateY, {
              toValue: 0,
              damping: 28,
              stiffness: 220,
              mass: 0.9,
              useNativeDriver: true,
            }).start();
          };

          if (sheetPosition === 'peek') {
            if (g.vy > 0.85 && g.dy > 40) {
              closeWithSpring();
              return;
            }
            if (g.dy < -60) {
              openFull();
              return;
            }
            snapPeek();
            return;
          }

          const refH = sheetHeight > 0 ? sheetHeight : windowHeight;
          const shouldClose = g.vy > 0.8 || g.dy > Math.min(220, refH * 0.25);
          if (shouldClose) {
            closeWithSpring();
            return;
          }
          openFull();
        },
      }),
    [onClose, peekTranslateY, sheetHeight, sheetPosition, translateY, windowHeight],
  );

  useEffect(() => {
    if (!visible) {
      setEntered(false);
      sheetOpacity.setValue(0);
      translateY.setValue(0);
      setSheetPosition('full');
      if (peekAutoCloseTimer.current) {
        clearTimeout(peekAutoCloseTimer.current);
        peekAutoCloseTimer.current = null;
      }
      return;
    }
    setEntered(false);
    sheetOpacity.setValue(0);
    translateY.setValue(windowHeight);
    const startPos: 'peek' | 'full' = initialPosition === 'peek' ? 'peek' : 'full';
    setSheetPosition(startPos);
    const targetY = startPos === 'peek' ? peekTranslateY : 0;
    Animated.parallel([
      Animated.timing(sheetOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(translateY, {
        toValue: targetY,
        damping: 28,
        stiffness: 220,
        mass: 0.9,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setEntered(true);
      if (startPos === 'peek') {
        if (peekAutoCloseTimer.current) clearTimeout(peekAutoCloseTimer.current);
        peekAutoCloseTimer.current = setTimeout(() => {
          setClosing(true);
          Animated.spring(translateY, {
            toValue: windowHeight,
            damping: 30,
            stiffness: 220,
            mass: 0.9,
            useNativeDriver: true,
          }).start(() => {
            setClosing(false);
            translateY.setValue(0);
            onClose();
          });
        }, 4000);
      }
    });
  }, [initialPosition, onClose, peekTranslateY, sheetOpacity, translateY, visible, windowHeight]);

  const touchValidateTrip = async (root: Record<string, unknown>, patchTrip: Record<string, unknown>) => {
    const tMeta = getTripMeta(root);
    if (tMeta && tMeta.validatedAtMs) return patchTrip;
    return { ...patchTrip, validatedAtMs: Date.now() };
  };

  const onToggleRemindToLeave = async () => {
    if (!row) return;
    const next = !remindToLeaveEnabled;
    setRemindToLeaveEnabled(next);
    await updateTrankilV2IntentionRemindToLeave(row.id, next);
    if (!next && newtonEnabled) {
      setNewtonEnabled(false);
      const root = safeParseJsonObject(row.metadata_json) ?? {};
      const tripPatch = await touchValidateTrip(root, { newtonEnabled: false });
      await patchMetadata(row.id, { trip: tripPatch }, { silent: true });
    }
    await reconcileSentinelForIntentionId(row.id);
  };

  const onToggleChecklistItem = async (uid: string) => {
    if (!row || !checklist) return;
    const next = checklist.map((it) => (it.uid === uid ? { ...it, checked: !it.checked } : it));
    setChecklist(next);
    const root = safeParseJsonObject(row.metadata_json) ?? {};
    const patch: Record<string, unknown> = {
      checklist_v1: { items: next.map((it) => ({ uid: it.uid, text: it.text, checked: it.checked })) },
    };
    if (isTrip && !getTripMeta(root)?.validatedAtMs) {
      patch.trip = { validatedAtMs: Date.now() };
    }
    await patchMetadata(row.id, patch);
  };

  const onToggleNewton = async () => {
    if (!row) return;
    const nextEnabled = !newtonEnabled;
    setNewtonEnabled(nextEnabled);
    const root = safeParseJsonObject(row.metadata_json) ?? {};
    const tripPatch = await touchValidateTrip(root, { newtonEnabled: nextEnabled });
    await patchMetadata(row.id, { trip: tripPatch });
    await reconcileSentinelForIntentionId(row.id);
  };

  const onSelectTransportMode = async (mode: 'auto' | 'transit' | 'walking' | 'bike') => {
    if (!row) return;
    setTransportMode(mode);
    onPatchRow?.(row.id, { transport_mode: mode });
    const root = safeParseJsonObject(row.metadata_json) ?? {};
    await updateTrankilV2IntentionTransportMode(row.id, { transport_mode: mode }, { silent: true });
    const tripPatch = await touchValidateTrip(root, { transportMode: mode });
    await patchMetadata(row.id, { trip: tripPatch });
    await reconcileSentinelForIntentionId(row.id);
  };

  const persistDueDateTime = async (d: Date, opts?: { closePicker?: boolean; allDay?: boolean }) => {
    if (!row) return;
    const effectiveAllDay = opts?.allDay ?? isAllDay;
    const ymd = formatYmd(d);
    const nextDue = effectiveAllDay ? ymd : formatLocalIsoNoZ(d);
    const root = safeParseJsonObject(row.metadata_json) ?? {};
    const nextTimeHm = effectiveAllDay ? null : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const tripBase = isTrip && trip ? (trip as Record<string, unknown>) : null;
    const nextMeta: Record<string, unknown> = {
      is_all_day: effectiveAllDay ? 1 : 0,
      dueDateTime: effectiveAllDay ? null : nextDue,
      dueDateYmd: ymd,
      dueTimeHm: nextTimeHm,
      trip:
        tripBase
          ? {
              ...tripBase,
              ...(effectiveAllDay ? { newtonEnabled: false } : null),
              dueDateTime: effectiveAllDay ? null : nextDue,
              dueDateYmd: ymd,
              dueTimeHm: nextTimeHm,
              arrivalDue: effectiveAllDay ? null : nextDue,
            }
          : root.trip,
    };
    onPatchRow?.(row.id, { due_date: nextDue });
    if (opts?.closePicker ?? true) setDatePickerOpen(false);
    setPickerDraft(d);
    await patchMetadata(row.id, nextMeta, { silent: true });
    await updateTrankilV2IntentionTemporal(row.id, { due_date: nextDue });
    await reconcileSentinelForIntentionId(row.id);
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
                void persistDueDateTime(picked, { closePicker: false }).finally(resolve);
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
                  void persistDueDateTime(final, { closePicker: false }).finally(resolve);
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
    void persistDueDateTime(date, { closePicker: false });
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
  const projectCalendarMode = useMemo(() => {
    if (!isProject || !projectPayload) return false;
    if (projectStartDraftYmd) return true;
    return Object.values(projectPivotDraftByUid).some((v) => Boolean(v));
  }, [isProject, projectPayload, projectPivotDraftByUid, projectStartDraftYmd]);
  const projectSchedule = useMemo(() => {
    if (!isProject || !projectPayload) return { items: [], endYmd: null };
    const ms = projectPayload.milestones;
    const pivotMsByUid = new Map<string, number>();
    for (const m of ms) {
      const ymd = projectPivotDraftByUid[m.uid] ?? m.pivot_date ?? null;
      const dt = ymd ? dateNoonFromYmd(ymd) : null;
      if (dt) pivotMsByUid.set(m.uid, dt.getTime());
    }
    if (!projectCalendarMode) {
      const toShort = (unit: string) => (unit === 'hours' ? 'h' : unit === 'weeks' ? 'sem' : 'j');
      const items = ms.map((m) => ({
        uid: m.uid,
        title: m.title,
        checked: Boolean(m.checked),
        note: m.note ?? null,
        pivot_date: projectPivotDraftByUid[m.uid] ?? m.pivot_date ?? null,
        label: `+${m.estimated_duration}${toShort(m.unit)}`,
      }));
      return { items, endYmd: null };
    }
    const endDates: Array<number | null> = ms.map(() => null);
    const startMs = projectStartDraftYmd ? dateNoonFromYmd(projectStartDraftYmd)?.getTime() ?? null : null;
    if (startMs) {
      let cur = startMs;
      for (let i = 0; i < ms.length; i++) {
        cur += durationMs(ms[i].unit, ms[i].estimated_duration);
        const pivot = pivotMsByUid.get(ms[i].uid);
        if (pivot) cur = pivot;
        endDates[i] = cur;
      }
    }
    for (let i = 0; i < ms.length; i++) {
      const pivot = pivotMsByUid.get(ms[i].uid);
      if (!pivot) continue;
      let cur = pivot;
      endDates[i] = pivot;
      for (let j = i - 1; j >= 0; j--) {
        const prevPivot = pivotMsByUid.get(ms[j].uid);
        if (prevPivot) {
          cur = prevPivot;
          endDates[j] = cur;
          continue;
        }
        cur -= durationMs(ms[j + 1].unit, ms[j + 1].estimated_duration);
        endDates[j] = cur;
      }
    }
    let cur = endDates.find((x): x is number => x !== null) ?? null;
    if (cur !== null) {
      for (let i = 0; i < ms.length; i++) {
        const pivot = pivotMsByUid.get(ms[i].uid);
        if (pivot) {
          cur = pivot;
          endDates[i] = pivot;
          continue;
        }
        if (endDates[i] !== null) {
          cur = endDates[i] as number;
          continue;
        }
        if (cur === null) break;
        cur += durationMs(ms[i].unit, ms[i].estimated_duration);
        endDates[i] = cur;
      }
    }
    const items = ms.map((m, i) => {
      const dt = endDates[i] !== null ? new Date(Number(endDates[i])) : null;
      const ymd = dt ? formatYmdLocal(dt) : null;
      const pivotYmd = projectPivotDraftByUid[m.uid] ?? m.pivot_date ?? null;
      return {
        uid: m.uid,
        title: m.title,
        checked: Boolean(m.checked),
        note: m.note ?? null,
        pivot_date: pivotYmd,
        label: ymd ?? '—',
      };
    });
    const last = endDates.length ? endDates[endDates.length - 1] : null;
    const endYmd = last !== null ? formatYmdLocal(new Date(Number(last))) : null;
    return { items, endYmd };
  }, [isProject, projectCalendarMode, projectPayload, projectPivotDraftByUid, projectStartDraftYmd]);
  const zoomModalItem = useMemo(() => {
    if (!zoomModalUid) return null;
    return projectSchedule.items.find((x) => x.uid === zoomModalUid) ?? null;
  }, [projectSchedule.items, zoomModalUid]);

  useEffect(() => {
    zoomModalUidRef.current = zoomModalUid;
  }, [zoomModalUid]);

  useEffect(() => {
    if (zoomModalPhase !== 'generating' || !zoomModalUid) {
      setZoomDots('');
      return;
    }
    let tick = 0;
    const timer = setInterval(() => {
      tick = (tick + 1) % 3;
      setZoomDots('.'.repeat(tick + 1));
    }, 450);
    return () => clearInterval(timer);
  }, [zoomModalPhase, zoomModalUid]);

  useEffect(() => {
    if (!row || !isProject || !projectSchedule.items.length) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, number> = {};
      const nextDone: Record<string, number> = {};
      for (const m of projectSchedule.items) {
        const stats = await getZoomChildrenStatsForProjectMilestone({ projectId: row.id, parentJalonUid: m.uid });
        next[m.uid] = stats.total;
        nextDone[m.uid] = stats.done;
      }
      if (cancelled) return;
      setZoomCountByUid(next);
      setZoomDoneByUid(nextDone);
    })();
    return () => {
      cancelled = true;
    };
  }, [isProject, projectSchedule.items, row]);

  const openZoomAccordion = async (uid: string): Promise<number> => {
    if (!row) return 0;
    setZoomLoadingByUid((prev) => ({ ...prev, [uid]: true }));
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setZoomExpandedByUid((prev) => {
      const out: Record<string, boolean> = {};
      for (const k of Object.keys(prev)) out[k] = false;
      out[uid] = true;
      return out;
    });
    void patchMetadata(row.id, { project: { last_open_milestone_uid: uid } }, { silent: true });
    requestAnimationFrame(() => {
      const y = milestoneYRef.current[uid];
      if (typeof y !== 'number') return;
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 6), animated: true });
    });
    let total = 0;
    try {
      const children = await listZoomChildrenForProjectMilestone({ projectId: row.id, parentJalonUid: uid });
      const stats = await getZoomChildrenStatsForProjectMilestone({ projectId: row.id, parentJalonUid: uid });
      total = stats.total;
      setZoomChildrenByUid((prev) => ({ ...prev, [uid]: children }));
      setZoomCountByUid((prev) => ({ ...prev, [uid]: stats.total }));
      setZoomDoneByUid((prev) => ({ ...prev, [uid]: stats.done }));
    } finally {
      setZoomLoadingByUid((prev) => ({ ...prev, [uid]: false }));
    }
    return total;
  };

  const closeZoomAccordion = (uid: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setZoomExpandedByUid((prev) => ({ ...prev, [uid]: false }));
    setZoomLoadingByUid((prev) => ({ ...prev, [uid]: false }));
    if (row) void patchMetadata(row.id, { project: { last_open_milestone_uid: null } }, { silent: true });
  };

  useEffect(() => {
    if (!row || !isProject) return;
    if (restoredZoomRef.current) return;
    const project = meta && typeof meta === 'object' ? (meta as Record<string, unknown>).project : null;
    const lastUidRaw =
      project && typeof project === 'object' ? (project as Record<string, unknown>).last_open_milestone_uid : null;
    const lastUid = typeof lastUidRaw === 'string' ? lastUidRaw.trim() : '';
    if (!lastUid) {
      restoredZoomRef.current = true;
      return;
    }
    const exists = projectSchedule.items.some((x) => x.uid === lastUid);
    if (!exists) {
      restoredZoomRef.current = true;
      return;
    }
    restoredZoomRef.current = true;
    void openZoomAccordion(lastUid);
  }, [isProject, meta, projectSchedule.items, row]);

  const confirmProjectReplan = async () => {
    if (!row || !projectPayload) return;
    const start_date = projectStartDraftYmd ?? null;
    const next: ProjectMilestonesPayload = {
      ...projectPayload,
      milestones: projectPayload.milestones.map((m) => ({
        ...m,
        pivot_date: projectPivotDraftByUid[m.uid] ?? null,
      })),
    };
    setProjectPayload(next);
    await patchMetadata(
      row.id,
      { project: { start_date }, ...buildProjectMilestonesMetadataPatch(next) },
      { silent: true },
    );
    setProjectDatesDirty(false);
    setProjectStartPickerOpen(false);
    setPivotPickerUid(null);
  };

  const toggleProjectMilestoneDone = async (uid: string) => {
    if (!row || !projectPayload) return;
    const next: ProjectMilestonesPayload = {
      ...projectPayload,
      milestones: projectPayload.milestones.map((m) => (m.uid === uid ? { ...m, checked: !Boolean(m.checked) } : m)),
    };
    setProjectPayload(next);
    await patchMetadata(row.id, buildProjectMilestonesMetadataPatch(next), { silent: true });
  };

  const deleteProjectMilestone = async (uid: string) => {
    if (!row || !projectPayload) return;
    const next: ProjectMilestonesPayload = {
      ...projectPayload,
      milestones: projectPayload.milestones.filter((m) => m.uid !== uid),
    };
    setProjectPayload(next);
    setProjectPivotDraftByUid((prev) => {
      const out = { ...prev };
      delete out[uid];
      return out;
    });
    await patchMetadata(row.id, buildProjectMilestonesMetadataPatch(next), { silent: true });
  };

  const openProjectPivotPicker = (uid: string) => {
    if (!row) return;
    const initialYmd = projectPivotDraftByUid[uid] ?? projectPayload?.milestones.find((m) => m.uid === uid)?.pivot_date ?? null;
    const initial = dateNoonFromYmd(initialYmd ?? '') ?? projectStartDraft ?? new Date();
    if (Platform.OS === 'android') {
      void (async () => {
        const m = await import('@react-native-community/datetimepicker');
        const DateTimePickerAndroid = (m as unknown as { DateTimePickerAndroid?: any }).DateTimePickerAndroid;
        if (!DateTimePickerAndroid?.open) return;
        setPivotPickerUid(uid);
        await new Promise<void>((resolve) => {
          DateTimePickerAndroid.open({
            value: initial,
            mode: 'date',
            is24Hour: true,
            onChange: (event: { type?: string }, date?: Date) => {
              if (String(event?.type ?? '') === 'dismissed') {
                setPivotPickerUid(null);
                resolve();
                return;
              }
              if (date) {
                const ymd = formatYmd(date);
                setProjectPivotDraftByUid((prev) => ({ ...prev, [uid]: ymd }));
                setProjectDatesDirty(true);
              }
              setPivotPickerUid(null);
              resolve();
            },
          });
        });
      })();
      return;
    }
    setPivotPickerUid(uid);
  };

  const openProjectMilestoneMenu = (uid: string) => {
    const title = t('intentionDetail.projectMilestoneMenuTitle');
    const labels = [
      t('intentionDetail.projectMilestoneMenuPivot'),
      t('intentionDetail.projectMilestoneMenuNote'),
      t('intentionDetail.projectMilestoneMenuDelete'),
      t('intentionDetail.cancel'),
    ];
    const onPick = (idx: number) => {
      if (idx === 0) openProjectPivotPicker(uid);
      if (idx === 1) {
        const cur = projectPayload?.milestones.find((m) => m.uid === uid)?.note ?? '';
        setNoteUid(uid);
        setNoteDraft(cur || '');
        setNoteModalOpen(true);
      }
      if (idx === 2) void deleteProjectMilestone(uid);
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title, options: labels, cancelButtonIndex: 3, destructiveButtonIndex: 2 },
        (buttonIndex) => {
          if (typeof buttonIndex !== 'number' || buttonIndex === 3) return;
          onPick(buttonIndex);
        },
      );
      return;
    }
    Alert.alert(title, '', [
      { text: labels[0], onPress: () => onPick(0) },
      { text: labels[1], onPress: () => onPick(1) },
      { text: labels[2], style: 'destructive', onPress: () => onPick(2) },
      { text: labels[3], style: 'cancel' },
    ]);
  };

  const saveProjectNote = async () => {
    if (!row || !projectPayload || !noteUid) {
      setNoteModalOpen(false);
      return;
    }
    const raw = String(noteDraft ?? '').trim();
    const next: ProjectMilestonesPayload = {
      ...projectPayload,
      milestones: projectPayload.milestones.map((m) =>
        m.uid === noteUid ? { ...m, note: raw ? raw : null } : m,
      ),
    };
    setProjectPayload(next);
    setNoteModalOpen(false);
    setNoteUid(null);
    setNoteDraft('');
    await patchMetadata(row.id, buildProjectMilestonesMetadataPatch(next), { silent: true });
  };

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
          <Pressable
            disabled={closing}
            onPress={() => {
              if (peekAutoCloseTimer.current) {
                clearTimeout(peekAutoCloseTimer.current);
                peekAutoCloseTimer.current = null;
              }
              if (sheetPosition !== 'peek') return;
              setSheetPosition('full');
              Animated.spring(translateY, {
                toValue: 0,
                damping: 28,
                stiffness: 220,
                mass: 0.9,
                useNativeDriver: true,
              }).start();
            }}
            style={({ pressed }) => [
              styles.peekHeader,
              { borderTopColor: theme.colors.outlineVariant, opacity: pressed ? 0.92 : 1 },
            ]}
          >
            <View style={styles.tabRow}>
              <View style={[styles.tabSlot, { backgroundColor: '#D6E9FF' }]}>
                <Text style={[styles.tabText, { color: theme.colors.onSurface }]} numberOfLines={1}>
                  {categoryTabLabel}
                </Text>
              </View>
              {showSlot2 ? (
                <View style={[styles.tabSlot, { backgroundColor: '#D7F5E8' }]}>
                  <Text style={[styles.tabText, { color: theme.colors.onSurface }]} numberOfLines={1}>
                    {slot2Label}
                  </Text>
                </View>
              ) : null}
              {showSlot3 ? (
                <View style={[styles.tabSlot, { backgroundColor: '#E8DCFF' }]}>
                  <Text style={[styles.tabText, { color: theme.colors.onSurface }]} numberOfLines={1}>
                    {slot3Label}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
          <KeyboardAvoidingView
            enabled={Platform.OS === 'ios'}
            behavior="padding"
            keyboardVerticalOffset={24}
            style={styles.kbRoot}
          >
            <View style={styles.fixedBlock}>
              <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>{t('intentionDetail.labelIntention')}</Text>
              <View style={styles.intentionRow}>
                {isProject ? (
                  titleEditing ? (
                    <TextInput
                      ref={(r) => {
                        titleInputRef.current = r;
                      }}
                      value={titleDraft}
                      onChangeText={setTitleDraft}
                      onBlur={() => void persistTitleIfNeeded()}
                      onSubmitEditing={() => void persistTitleIfNeeded()}
                      placeholder={t('project.title_placeholder')}
                      placeholderTextColor="rgba(100,116,139,0.72)"
                      returnKeyType="done"
                      blurOnSubmit
                      style={[
                        styles.intentionTitleInput,
                        { color: theme.colors.onSurface, borderBottomColor: theme.colors.outlineVariant },
                      ]}
                    />
                  ) : (
                    <Pressable
                      onPress={() => {
                        setTitleEditing(true);
                        requestAnimationFrame(() => titleInputRef.current?.focus());
                      }}
                      style={({ pressed }) => [{ flex: 1, minWidth: 0, opacity: pressed ? 0.9 : 1 }]}
                    >
                      <Text style={[styles.intentionTitle, { color: theme.colors.onSurface }]} numberOfLines={2}>
                        {String(titleDraft ?? '').trim() || t('timeline.untitled')}
                      </Text>
                    </Pressable>
                  )
                ) : (
                  <Text style={[styles.intentionTitle, { color: theme.colors.onSurface }]} numberOfLines={2}>
                    {String(row?.display_title ?? '').trim() || t('timeline.untitled')}
                  </Text>
                )}
                <IconButton
                  icon="note-text-outline"
                  size={18}
                  iconColor={theme.colors.onSurfaceVariant}
                  style={styles.noteIcon}
                  onPress={() => setSourceExpanded((v) => !v)}
                />
              </View>

              {sourceExpanded ? (
                <View style={styles.sourceWrap}>
                  <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>{t('intentionDetail.source')}</Text>
                  <TextInput
                    value={sourceDraft}
                    onChangeText={(text) => {
                      setSourceDraft(text);
                      if (!row) return;
                      if (sourceSaveTimer.current) clearTimeout(sourceSaveTimer.current);
                      sourceSaveTimer.current = setTimeout(() => {
                        sourceSaveTimer.current = null;
                        void (async () => {
                          await patchMetadata(row.id, { memo: String(text ?? '').trim() }, { silent: true });
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

              {!isProject ? (
                <>
                  <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />

                  <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>{t('intentionDetail.labelTiming')}</Text>
                  {subtitle ? (
                    <Pressable
                      onPress={openTemporalPicker}
                      android_ripple={{ color: 'rgba(15, 23, 42, 0.06)' }}
                      style={({ pressed }) => [styles.subtitlePress, { opacity: pressed ? 0.88 : 1 }]}
                    >
                      <View pointerEvents="none" style={styles.addrIconWrap}>
                        <IconButton icon="calendar-month-outline" size={18} iconColor={theme.colors.onSurfaceVariant} style={styles.addrIcon} />
                      </View>
                      <Text style={[styles.subtitleInline, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                        {subtitle}
                      </Text>
                    </Pressable>
                  ) : null}

                  {datePickerOpen ? (
                    <View style={styles.pickerBlock}>
                      <View style={styles.allDayRow}>
                        <Text style={[styles.allDayLabel, { color: theme.colors.onSurfaceVariant }]}>{t('intentionDetail.allDay')}</Text>
                        <Switch
                          value={isAllDay}
                          onValueChange={(v) => {
                            setIsAllDay(v);
                            if (v) setNewtonEnabled(false);
                            const now = new Date();
                            const base = new Date(pickerDraft);
                            if (!v) base.setHours(now.getHours(), now.getMinutes(), 0, 0);
                            setPickerDraft(base);
                            void persistDueDateTime(base, { closePicker: false, allDay: v });
                          }}
                        />
                      </View>
                      {Platform.OS === 'ios' ? (
                        <DateTimePickerLazy
                          value={pickerDraft}
                          mode={isAllDay ? 'date' : 'datetime'}
                          display={isAllDay ? 'inline' : 'compact'}
                          onChange={onPickedDateTimeIos}
                        />
                      ) : null}
                    </View>
                  ) : null}
                </>
              ) : null}

              {isTrip && showTripControls ? (
                <>
                  <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />
                  <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>{t('intentionDetail.labelItinerary')}</Text>
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
                            setOriginLat(null);
                            setOriginLng(null);
                            if (!row) return;
                            const raw = text.trim();
                            const root = safeParseJsonObject(row.metadata_json) ?? {};
                            const tripMeta = getTripMeta(root) ?? {};
                            if (originSaveTimer.current) clearTimeout(originSaveTimer.current);
                            originSaveTimer.current = setTimeout(() => {
                              originSaveTimer.current = null;
                              void (async () => {
                                const tripPatch = await touchValidateTrip(root, { origin_address: raw });
                                await patchMetadata(row.id, { trip: tripPatch }, { silent: true });
                              })();
                            }, 250);
                          }}
                          onSelect={(p) => {
                            setOriginText(p.formattedAddress);
                            setOriginEditing(false);
                            setOriginLat(p.lat);
                            setOriginLng(p.lng);
                            if (!row) return;
                            const root = safeParseJsonObject(row.metadata_json) ?? {};
                            const tripMeta = getTripMeta(root) ?? {};
                            void (async () => {
                              void tripMeta;
                              const tripPatch = await touchValidateTrip(root, {
                                origin_address: p.formattedAddress,
                                origin_place_id: p.placeId,
                                origin_lat: p.lat,
                                origin_lng: p.lng,
                              });
                              await patchMetadata(row.id, { trip: tripPatch }, { silent: true });
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
                            setArrivalLat(null);
                            setArrivalLng(null);
                            if (!row) return;
                            const raw = text.trim();
                            const root = safeParseJsonObject(row.metadata_json) ?? {};
                            const tripMeta = getTripMeta(root) ?? {};
                            if (arrivalSaveTimer.current) clearTimeout(arrivalSaveTimer.current);
                            arrivalSaveTimer.current = setTimeout(() => {
                              arrivalSaveTimer.current = null;
                              void (async () => {
                                void tripMeta;
                                const tripPatch = await touchValidateTrip(root, {
                                  location_address: raw,
                                  location_place_id: null,
                                  location_lat: null,
                                  location_lng: null,
                                });
                                await updateTrankilV2IntentionLocationAddress(row.id, { location_address: raw || null }, { silent: true });
                                await patchMetadata(row.id, { trip: tripPatch }, { silent: true });
                                await reconcileSentinelForIntentionId(row.id);
                              })();
                            }, 250);
                          }}
                          onSelect={(p) => {
                            setArrivalText(p.formattedAddress);
                            setArrivalEditing(false);
                            setArrivalLat(p.lat);
                            setArrivalLng(p.lng);
                            if (!row) return;
                            const root = safeParseJsonObject(row.metadata_json) ?? {};
                            const tripMeta = getTripMeta(root) ?? {};
                            void (async () => {
                              void tripMeta;
                              const tripPatch = await touchValidateTrip(root, {
                                location_address: p.formattedAddress,
                                location_place_id: p.placeId,
                                location_lat: p.lat,
                                location_lng: p.lng,
                                location_source: 'places',
                              });
                              await updateTrankilV2IntentionLocationAddress(row.id, { location_address: p.formattedAddress }, { silent: true });
                              await patchMetadata(row.id, { trip: tripPatch }, { silent: true });
                              await reconcileSentinelForIntentionId(row.id);
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
                </>
              ) : null}
            </View>

            <ScrollView
              ref={(r) => {
                scrollRef.current = r;
              }}
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {!entered ? <View style={styles.enterPlaceholder} /> : null}
              {entered ? (
                <>
                  {isTrip ? (
                    <>
                      <View style={styles.section}>
                        <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>
                          {t('intentionDetail.trip')}
                        </Text>
                        <View style={styles.newtonRow}>
                          <Text style={[styles.switchLabel, { color: theme.colors.onSurfaceVariant }]}>
                            {t('intentionDetail.remindToLeave')}
                          </Text>
                          <Switch value={remindToLeaveEnabled} onValueChange={() => void onToggleRemindToLeave()} />
                        </View>
                      </View>

                      {showTripControls ? (
                        <Animated.View style={[styles.section, { opacity: tripControlsOpacity }]}>
                          <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>
                            {t('intentionDetail.labelTransport')}
                          </Text>
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

                          <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />

                          <View style={styles.newtonRow}>
                            <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>
                              {t('intentionDetail.comfortTitle')}
                            </Text>
                            {showSurveillanceMissing ? (
                              <IconButton icon="alert" size={18} iconColor="#eab308" style={styles.addrIcon} />
                            ) : null}
                          </View>

                          {showSurveillanceMissing ? (
                            <Text style={[styles.comfortLine, { color: theme.colors.onSurfaceVariant }]}>
                              {t('intentionDetail.surveillanceMissingInfo')}
                            </Text>
                          ) : null}

                          {isNewtonSurveillable ? (
                            <View style={styles.newtonRow}>
                              <Text style={[styles.switchLabel, { color: theme.colors.onSurfaceVariant }]}>
                                {t('intentionDetail.newton')}
                              </Text>
                              <Switch value={newtonEnabled} onValueChange={() => void onToggleNewton()} />
                            </View>
                          ) : null}

                          <Text style={[styles.comfortLine, { color: theme.colors.onSurfaceVariant }]}>
                            {t('intentionDetail.comfortFixed', { time: `${pad2(pickerDraft.getHours())}:${pad2(pickerDraft.getMinutes())}` })}
                          </Text>
                          <Text style={[styles.comfortLine, { color: theme.colors.onSurfaceVariant }]}>
                            {t('intentionDetail.comfortOptimized')}
                          </Text>

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
                        </Animated.View>
                      ) : null}
                    </>
                  ) : null}

                  {isProject ? (
                    <View style={styles.section}>
                      <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />
                      <View style={styles.temporalitasCardFlat}>
                        <Text style={styles.temporalitasTitle} numberOfLines={2}>
                          {row?.display_title ?? t('timeline.untitled')}
                        </Text>
                        <View style={styles.temporalitasDividerFlat} />
                        <View style={styles.temporalitasDatesRow}>
                          <Pressable
                            onPress={openProjectStartPicker}
                            android_ripple={{ color: 'rgba(15, 23, 42, 0.06)' }}
                            style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1 }]}
                          >
                            <Text style={styles.temporalitasStartLink} numberOfLines={1}>
                              {projectStartDraftYmd ? projectStartDraftYmd : t('intentionDetail.projectStartDateEmpty')}
                            </Text>
                          </Pressable>
                          <Text style={styles.temporalitasEndText} numberOfLines={1}>
                            {projectSchedule.endYmd ? projectSchedule.endYmd : '—'}
                          </Text>
                        </View>
                        {projectStartPickerOpen && Platform.OS === 'ios' ? (
                          <View style={styles.pickerBlock}>
                            <DateTimePickerLazy
                              value={projectStartDraft}
                              mode="date"
                              display="inline"
                              onChange={(_, date) => date && setProjectStartDraftFromDate(date)}
                            />
                          </View>
                        ) : null}
                        {pivotPickerUid && Platform.OS === 'ios' ? (
                          <View style={styles.pickerBlock}>
                            <DateTimePickerLazy
                              value={dateNoonFromYmd(projectPivotDraftByUid[pivotPickerUid] ?? '') ?? new Date()}
                              mode="date"
                              display="inline"
                              onChange={(_, date) => {
                                if (!date) return;
                                const ymd = formatYmd(date);
                                setProjectPivotDraftByUid((prev) => ({ ...prev, [pivotPickerUid]: ymd }));
                                setProjectDatesDirty(true);
                                setPivotPickerUid(null);
                              }}
                            />
                          </View>
                        ) : null}
                        {projectDatesDirty ? (
                          <Button mode="contained" onPress={() => void confirmProjectReplan()} style={styles.temporalitasCtaFlat}>
                            {t('intentionDetail.confirmReplan')}
                          </Button>
                        ) : null}
                      </View>

                      <View style={styles.milestonesWrap}>
                        {isGenerating ? (
                          <View style={styles.milestonesList}>
                            {[0, 1, 2].map((k) => (
                              <View key={`sk-${k}`} style={[styles.milestoneRow, k < 2 ? styles.milestoneRowBorder : null]}>
                                <View style={styles.milestoneCircle} />
                                <View style={styles.milestoneTextColFlat}>
                                  <Animated.View style={[styles.skeletonBarTitle, { opacity: skeletonPulse }]} />
                                  <Animated.View style={[styles.skeletonBarMeta, { opacity: skeletonPulse }]} />
                                </View>
                                <View style={styles.milestoneMenuBtnFlat} />
                              </View>
                            ))}
                          </View>
                        ) : projectPayload ? (
                          <View style={styles.milestonesList}>
                            {projectSchedule.items.map((m, idx) => {
                              const checked = Boolean(m.checked);
                              const isLast = idx === projectSchedule.items.length - 1;
                              const zoomChildren = zoomChildrenByUid[m.uid] ?? [];
                              const zoomCountKnown = Object.prototype.hasOwnProperty.call(zoomCountByUid, m.uid);
                              const zoomCount = zoomCountKnown ? Number(zoomCountByUid[m.uid] ?? 0) : 0;
                              const zoomDone = Number(zoomDoneByUid[m.uid] ?? 0);
                              const zoomExpanded = zoomExpandedByUid[m.uid] ?? false;
                              const zoomBusy = zoomProcessingUid === m.uid;
                              const zoomLoading = zoomLoadingByUid[m.uid] ?? false;
                              const zoomLocked = zoomBusy;
                              const zoomPct = zoomCount > 0 ? Math.max(0, Math.min(1, zoomDone / zoomCount)) : 0;
                              const zoomBadgeLabel = zoomCount > 0 ? t('project.step_count', { count: zoomCount }) : t('project.add_steps');
                              return (
                                <React.Fragment key={m.uid}>
                                  <Pressable
                                    onLongPress={() => {
                                      if (zoomLocked) return;
                                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                      setZoomModalUid(m.uid);
                                      setZoomModalPhase('confirm');
                                      setZoomModalSuccessCount(0);
                                    }}
                                    delayLongPress={260}
                                    disabled={zoomLocked}
                                    onLayout={(e) => {
                                      milestoneYRef.current[m.uid] = e.nativeEvent.layout.y;
                                    }}
                                    style={[styles.milestoneRow, !isLast ? styles.milestoneRowBorder : null]}
                                  >
                                    <Pressable
                                      onPress={() => void toggleProjectMilestoneDone(m.uid)}
                                      disabled={zoomLocked}
                                      style={({ pressed }) => [
                                        styles.milestoneCircle,
                                        checked ? styles.milestoneCircleChecked : null,
                                        pressed ? { opacity: 0.85 } : null,
                                      ]}
                                      accessibilityRole="checkbox"
                                      accessibilityState={{ checked }}
                                    >
                                      <Text style={[styles.milestoneCheck, checked ? styles.milestoneCheckOn : null]}>{checked ? '✓' : ''}</Text>
                                    </Pressable>
                                    <Pressable
                                      onPress={() => {
                                        if (zoomLocked) return;
                                        if (!zoomCountKnown) {
                                          void (async () => {
                                            const total = await openZoomAccordion(m.uid);
                                            if (total > 0) return;
                                            closeZoomAccordion(m.uid);
                                            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                            setZoomModalUid(m.uid);
                                            setZoomModalPhase('confirm');
                                            setZoomModalSuccessCount(0);
                                          })();
                                          return;
                                        }
                                        if (zoomCount <= 0) {
                                          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                          setZoomModalUid(m.uid);
                                          setZoomModalPhase('confirm');
                                          setZoomModalSuccessCount(0);
                                          return;
                                        }
                                        if (zoomExpanded) {
                                          closeZoomAccordion(m.uid);
                                        } else {
                                          void openZoomAccordion(m.uid);
                                        }
                                      }}
                                      disabled={zoomLocked}
                                      style={({ pressed }) => [styles.milestoneTextColFlat, pressed ? { opacity: 0.9 } : null]}
                                    >
                                      <Text
                                        style={[
                                          styles.milestoneTitleFlat,
                                          zoomExpanded ? styles.milestoneTitleExpanded : null,
                                          checked ? styles.milestoneTitleDoneFlat : null,
                                        ]}
                                        numberOfLines={2}
                                      >
                                        {m.title}
                                      </Text>
                                      {zoomExpanded && zoomCount > 0 ? (
                                        <View style={styles.zoomProgressTrack}>
                                          <View style={[styles.zoomProgressFill, { width: `${Math.round(zoomPct * 100)}%` }]} />
                                        </View>
                                      ) : null}
                                      <Text style={styles.milestoneMetaFlat} numberOfLines={1}>
                                        {zoomBusy ? t('project.status_processing') : m.label}
                                      </Text>
                                    </Pressable>
                                    <Pressable
                                      onPress={() => {
                                        if (zoomLocked) return;
                                        if (!zoomCountKnown) {
                                          void (async () => {
                                            const total = await openZoomAccordion(m.uid);
                                            if (total > 0) return;
                                            closeZoomAccordion(m.uid);
                                            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                            setZoomModalUid(m.uid);
                                            setZoomModalPhase('confirm');
                                            setZoomModalSuccessCount(0);
                                          })();
                                          return;
                                        }
                                        if (zoomCount <= 0) {
                                          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                          setZoomModalUid(m.uid);
                                          setZoomModalPhase('confirm');
                                          setZoomModalSuccessCount(0);
                                          return;
                                        }
                                        if (zoomExpanded) {
                                          closeZoomAccordion(m.uid);
                                        } else {
                                          void openZoomAccordion(m.uid);
                                        }
                                      }}
                                      disabled={zoomLocked}
                                      style={({ pressed }) => [styles.zoomBadge, pressed ? { opacity: 0.7 } : null]}
                                    >
                                      <Text style={styles.zoomBadgeText}>{zoomBadgeLabel}</Text>
                                    </Pressable>
                                    <Pressable
                                      onPress={() => console.log('Open Modal')}
                                      disabled={zoomLocked}
                                      style={({ pressed }) => [styles.milestoneMenuBtnFlat, pressed ? { opacity: 0.7 } : null]}
                                      accessibilityRole="button"
                                      accessibilityLabel={t('intentionDetail.projectMilestoneMenuTitle')}
                                    >
                                      <IconButton
                                        icon="dots-vertical"
                                        size={18}
                                        iconColor="#64748b"
                                        style={styles.milestoneMenuIconFlat}
                                      />
                                    </Pressable>
                                  </Pressable>
                                  {zoomBusy || zoomExpanded ? (
                                    <View style={styles.zoomPanel}>
                                      {zoomBusy || zoomLoading ? (
                                        <>
                                          {[0, 1].map((k) => (
                                            <View key={`zsk-${m.uid}-${k}`} style={styles.zoomChildRowV34}>
                                              <View style={styles.zoomConnectorColV34}>
                                                <View style={styles.zoomConnectorV} />
                                                <View style={styles.zoomConnectorH} />
                                              </View>
                                              <View style={styles.zoomChildTextColV34}>
                                                <Animated.View style={[styles.skeletonBarTitle, { opacity: skeletonPulse }]} />
                                                <Animated.View style={[styles.skeletonBarMeta, { opacity: skeletonPulse }]} />
                                              </View>
                                            </View>
                                          ))}
                                        </>
                                      ) : zoomCount > 0 ? (
                                        <>
                                          {zoomChildren.map((c) => {
                                            const cDone = c.status === 'DONE';
                                            return (
                                              <View key={c.id} style={styles.zoomChildRowV34}>
                                                <Pressable
                                                  onPress={() => {
                                                    if (zoomLocked) return;
                                                    void (async () => {
                                                      await toggleIntentionDone(c.id);
                                                      const children = await listZoomChildrenForProjectMilestone({
                                                        projectId: row?.id ?? '',
                                                        parentJalonUid: m.uid,
                                                      });
                                                      const stats = await getZoomChildrenStatsForProjectMilestone({
                                                        projectId: row?.id ?? '',
                                                        parentJalonUid: m.uid,
                                                      });
                                                      setZoomChildrenByUid((prev) => ({ ...prev, [m.uid]: children }));
                                                      setZoomCountByUid((prev) => ({ ...prev, [m.uid]: stats.total }));
                                                      setZoomDoneByUid((prev) => ({ ...prev, [m.uid]: stats.done }));
                                                    })();
                                                  }}
                                                  style={({ pressed }) => [
                                                    styles.zoomChildCircle,
                                                    cDone ? styles.zoomChildCircleChecked : null,
                                                    pressed ? { opacity: 0.85 } : null,
                                                  ]}
                                                  accessibilityRole="checkbox"
                                                  accessibilityState={{ checked: cDone }}
                                                >
                                                  <Text style={[styles.zoomChildCheck, cDone ? styles.zoomChildCheckOn : null]}>{cDone ? '✓' : ''}</Text>
                                                </Pressable>
                                                <View style={styles.zoomConnectorColV34}>
                                                  <View style={styles.zoomConnectorV} />
                                                  <View style={styles.zoomConnectorH} />
                                                </View>
                                                <View style={styles.zoomChildTextColV34}>
                                                  <Text style={styles.zoomChildTitleV34} numberOfLines={2}>
                                                    {c.title}
                                                  </Text>
                                                </View>
                                              </View>
                                            );
                                          })}
                                        </>
                                      ) : null}
                                    </View>
                                  ) : null}
                                </React.Fragment>
                              );
                            })}
                          </View>
                        ) : null}
                      </View>
                    </View>
                  ) : null}

                  {(isList || (isProject && !projectPayload && listPayload)) ? (
                    <View style={styles.section}>
                      <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />
                      <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>{t('intentionDetail.listItems')}</Text>
                      {isList && listPayload ? (
                        <View style={styles.multiplierRow}>
                          <Pressable
                            onPress={() => {
                              const nextMult = Math.max(1, listPayload.multiplier - 1);
                              const next = { ...listPayload, multiplier: nextMult };
                              setListPayload(next);
                              void persistListPayload(next);
                            }}
                            style={({ pressed }) => [
                              styles.multBtn,
                              { borderColor: theme.colors.outlineVariant, opacity: pressed ? 0.86 : 1 },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="-"
                          >
                            <Text style={[styles.multBtnText, { color: theme.colors.onSurface }]}>−</Text>
                          </Pressable>
                          <Text style={[styles.multText, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                            × {listPayload.multiplier}
                          </Text>
                          <Pressable
                            onPress={() => {
                              const nextMult = Math.max(1, listPayload.multiplier + 1);
                              const next = { ...listPayload, multiplier: nextMult };
                              setListPayload(next);
                              void persistListPayload(next);
                            }}
                            style={({ pressed }) => [
                              styles.multBtn,
                              { borderColor: theme.colors.outlineVariant, opacity: pressed ? 0.86 : 1 },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="+"
                          >
                            <Text style={[styles.multBtnText, { color: theme.colors.onSurface }]}>+</Text>
                          </Pressable>
                        </View>
                      ) : null}
                      {isGenerating ? (
                        <View style={styles.lifeStack}>
                          {[0, 1, 2].map((k) => (
                            <Animated.View
                              key={`sk-list-${k}`}
                              style={[
                                styles.skeletonRow,
                                {
                                  backgroundColor: '#e5e7eb',
                                  opacity: skeletonPulse,
                                },
                              ]}
                            />
                          ))}
                        </View>
                      ) : listPayload ? (
                        <View style={styles.checklist}>
                          {listPayload.categories.flatMap((cat) =>
                            cat.items.map((it) => {
                              const mult = isList ? listPayload.multiplier : 1;
                              const qty = it.scalable ? it.qty * mult : it.qty;
                              const label = isList ? `${Math.round(qty * 1000) / 1000} ${it.unit}` : '';
                              return (
                                <Pressable
                                  key={it.uid}
                                  onPress={() => {
                                    const next: ListScalablePayload = {
                                      ...listPayload,
                                      categories: listPayload.categories.map((c) => ({
                                        ...c,
                                        items: c.items.map((x) => (x.uid === it.uid ? { ...x, checked: !x.checked } : x)),
                                      })),
                                    };
                                    setListPayload(next);
                                    void persistListPayload(next);
                                  }}
                                  accessibilityRole="checkbox"
                                  accessibilityState={{ checked: Boolean(it.checked) }}
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
                                    numberOfLines={2}
                                  >
                                    {it.name}{label ? ` · ${label}` : ''}
                                  </Text>
                                </Pressable>
                              );
                            }),
                          )}
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  {checklist ? (
                    <View style={styles.section}>
                      <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />
                      <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>{t('intentionDetail.checklist')}</Text>
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
                </>
              ) : null}
            </ScrollView>

            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <View style={styles.footerRow}>
                {isTrip && routeReady ? (
                  <Button
                    mode="contained"
                    onPress={() =>
                      void openNavigationUniversal({
                        origin: originText.trim() ? originText.trim() : null,
                        destination: arrivalDisplay ?? '',
                        mode: transportMode,
                      })
                    }
                    disabled={!routeReady}
                    style={styles.footerBtn}
                  >
                    GO
                  </Button>
                ) : null}
                <Button mode="outlined" onPress={onClose} style={[styles.footerCloseBtn, !routeReady ? { flex: 1 } : null]}>
                  {t('intentionDetail.close')}
                </Button>
              </View>
            </View>

            <Modal visible={noteModalOpen} transparent animationType="fade" onRequestClose={() => setNoteModalOpen(false)}>
              <View style={styles.noteModalRoot}>
                <Pressable style={styles.backdrop} onPress={() => setNoteModalOpen(false)} />
                <View
                  style={[
                    styles.noteModalCard,
                    { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant, borderWidth: 1 },
                  ]}
                >
                  <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>
                    {t('intentionDetail.projectMilestoneMenuNote')}
                  </Text>
                  <TextInput
                    value={noteDraft}
                    onChangeText={setNoteDraft}
                    placeholder={t('intentionDetail.notePlaceholder')}
                    placeholderTextColor="rgba(100,116,139,0.72)"
                    multiline
                    style={[styles.noteInput, { color: theme.colors.onSurface }]}
                  />
                  <View style={styles.noteModalActions}>
                    <Button mode="outlined" onPress={() => setNoteModalOpen(false)} style={styles.noteModalBtn}>
                      {t('intentionDetail.cancel')}
                    </Button>
                    <Button mode="contained" onPress={() => void saveProjectNote()} style={styles.noteModalBtn}>
                      {t('intentionDetail.save')}
                    </Button>
                  </View>
                </View>
              </View>
            </Modal>

            <Modal
              visible={Boolean(zoomModalUid)}
              transparent
              animationType="fade"
              onRequestClose={() => {
                if (zoomModalPhase === 'generating') return;
                setZoomModalUid(null);
              }}
            >
              <View style={styles.zoomModalRoot}>
                <Pressable
                  style={styles.backdrop}
                  onPress={() => {
                    if (zoomModalPhase === 'generating') return;
                    setZoomModalUid(null);
                  }}
                />
                <View style={styles.zoomModalCard}>
                  <Text style={styles.zoomModalText} numberOfLines={3}>
                    {zoomModalPhase === 'confirm'
                      ? t('project.zoom_confirm_title')
                      : zoomModalPhase === 'generating'
                        ? `${t('project.zoom_generating_status')}${zoomDots}`
                        : t('project.zoom_success_count', { count: zoomModalSuccessCount })}
                  </Text>
                  <Text style={styles.zoomModalMeta} numberOfLines={2}>
                    {zoomModalItem?.title ?? ''}
                  </Text>
                  <View style={styles.zoomModalActions}>
                    {zoomModalPhase === 'confirm' ? (
                      <>
                        <Button mode="outlined" onPress={() => setZoomModalUid(null)} style={styles.zoomModalBtn}>
                          {t('common.cancel')}
                        </Button>
                        <Button
                          mode="contained"
                          onPress={() => {
                            if (!row || !zoomModalUid) return;
                            if (!intentionFlow) return;
                            if (zoomProcessingUid) return;
                            const uid = zoomModalUid;
                            setZoomModalPhase('generating');
                            setZoomProcessingUid(uid);
                            void (async () => {
                              try {
                                const res = await intentionFlow.triggerJalonZoom({
                                  projectIntentionId: row.id,
                                  parentJalonUid: uid,
                                });
                                if (res.ok) {
                                  const children = await listZoomChildrenForProjectMilestone({ projectId: row.id, parentJalonUid: uid });
                                  const stats = await getZoomChildrenStatsForProjectMilestone({ projectId: row.id, parentJalonUid: uid });
                                  setZoomChildrenByUid((prev) => ({ ...prev, [uid]: children }));
                                  setZoomCountByUid((prev) => ({ ...prev, [uid]: stats.total }));
                                  setZoomDoneByUid((prev) => ({ ...prev, [uid]: stats.done }));
                                  if (zoomModalUidRef.current === uid) {
                                    setZoomModalSuccessCount(stats.total);
                                    setZoomModalPhase('success');
                                  }
                                } else {
                                  setZoomModalUid(null);
                                  setZoomModalPhase('confirm');
                                }
                              } finally {
                                setZoomProcessingUid(null);
                              }
                            })();
                          }}
                          disabled={!intentionFlow || Boolean(zoomProcessingUid)}
                          style={styles.zoomModalBtn}
                        >
                          {t('project.zoom_action_start')}
                        </Button>
                      </>
                    ) : zoomModalPhase === 'generating' ? (
                      <Button mode="contained" onPress={() => setZoomModalUid(null)} style={styles.zoomModalBtn}>
                        {t('project.zoom_background_action')}
                      </Button>
                    ) : (
                      <Button
                        mode="contained"
                        onPress={() => {
                          if (!row || !zoomModalUid) return;
                          const uid = zoomModalUid;
                          setZoomModalUid(null);
                          setZoomModalPhase('confirm');
                          setZoomModalSuccessCount(0);
                          void openZoomAccordion(uid);
                        }}
                        style={styles.zoomModalBtn}
                      >
                        {t('project.zoom_view_steps')}
                      </Button>
                    )}
                  </View>
                </View>
              </View>
            </Modal>
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
    paddingTop: 0,
    overflow: 'hidden',
  },
  kbRoot: { flex: 1 },
  grabber: { alignSelf: 'center', width: 56, height: 5, borderRadius: 5, marginBottom: 12 },
  peekHeader: {
    height: 40,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  tabRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tabSlot: {
    flex: 1,
    minWidth: 0,
    height: 26,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  tabText: { fontSize: 12, fontWeight: '800' },
  fixedBlock: { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  divider: { height: StyleSheet.hairlineWidth, width: '100%', opacity: 0.65 },
  sectionLabel: { fontSize: 12, fontWeight: '700', opacity: 0.7 },
  intentionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  intentionTitle: { flex: 1, minWidth: 0, fontSize: 18, fontWeight: '900', lineHeight: 22 },
  intentionTitleInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 22,
    borderBottomWidth: 1,
    paddingBottom: 2,
  },
  noteIcon: { margin: 0, padding: 0, marginTop: -2 },
  warningWrap: { marginTop: -6 },
  sourceWrap: { gap: 6 },
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
  subtitlePress: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, paddingVertical: 2 },
  subtitleInline: { fontSize: 13, fontWeight: '800', opacity: 0.88 },
  pickerBlock: { marginTop: -6 },
  allDayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  allDayLabel: { fontSize: 13, fontWeight: '800' },
  addrBlock: { gap: 10 },
  addrRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  addrIconWrap: { marginTop: -6 },
  addrIcon: { margin: 0, padding: 0 },
  addrTextCol: { flex: 1, minWidth: 0, justifyContent: 'center' },
  addrValue: { fontSize: 14, fontWeight: '800', lineHeight: 18 },
  content: { paddingHorizontal: 16, paddingBottom: 140 },
  section: { marginTop: 12, gap: 10 },
  checklist: { gap: 10 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  checkText: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '700' },
  temporalitasCardFlat: { borderRadius: 16, padding: 14, gap: 10, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb' },
  temporalitasTitle: { fontSize: 15, fontWeight: '600', color: '#000000' },
  temporalitasDividerFlat: { height: StyleSheet.hairlineWidth, backgroundColor: '#e5e7eb' },
  temporalitasDatesRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  temporalitasStartLink: { fontSize: 13, fontWeight: '600', color: '#0f766e', textDecorationLine: 'underline' },
  temporalitasEndText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  temporalitasCtaFlat: { borderRadius: 12, alignSelf: 'stretch' },
  milestonesWrap: { marginTop: 6 },
  milestonesList: { borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#ffffff' },
  milestoneRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  milestoneRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e7eb' },
  milestoneCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center' },
  milestoneCircleChecked: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  milestoneCheck: { fontSize: 12, fontWeight: '800', color: 'transparent' },
  milestoneCheckOn: { color: '#ffffff' },
  milestoneTextColFlat: { flex: 1, minWidth: 0, gap: 4 },
  milestoneTitleFlat: { fontSize: 14, fontWeight: '500', color: '#000000' },
  milestoneTitleExpanded: { fontWeight: '600' },
  milestoneTitleDoneFlat: { color: '#64748b', textDecorationLine: 'line-through' },
  milestoneMetaFlat: { fontSize: 12, fontWeight: '600', color: '#94a3b8' },
  milestoneMenuBtnFlat: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  milestoneMenuIconFlat: { margin: 0, padding: 0 },
  zoomBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#f1f5f9' },
  zoomBadgeText: { fontSize: 12, fontWeight: '800', color: '#0f172a' },
  zoomProgressTrack: { height: 2, borderRadius: 2, backgroundColor: '#e5e7eb', overflow: 'hidden' },
  zoomProgressFill: { height: 2, borderRadius: 2, backgroundColor: '#0f766e' },
  zoomPanel: { marginLeft: 20, marginRight: 14, marginBottom: 8, marginTop: -2, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.03)' },
  zoomChildRowV34: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 12, paddingVertical: 10 },
  zoomChildCircle: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center' },
  zoomChildCircleChecked: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  zoomChildCheck: { fontSize: 10, fontWeight: '800', color: 'transparent' },
  zoomChildCheckOn: { color: '#ffffff' },
  zoomConnectorColV34: { width: 16, height: 18, position: 'relative' },
  zoomChildTextColV34: { flex: 1, minWidth: 0 },
  zoomChildTitleV34: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  zoomChildrenWrap: { paddingLeft: 16, paddingBottom: 6 },
  zoomChildRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingLeft: 14, paddingRight: 14, paddingTop: 10 },
  zoomConnectorCol: { width: 22, height: 22, position: 'relative' },
  zoomConnectorV: { position: 'absolute', left: 7, top: -6, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: '#cbd5e1' },
  zoomConnectorH: { position: 'absolute', left: 7, top: 9, width: 9, height: StyleSheet.hairlineWidth, backgroundColor: '#cbd5e1' },
  zoomChildTextCol: { flex: 1, minWidth: 0, gap: 4, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e7eb' },
  zoomChildTitle: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  zoomChildMeta: { fontSize: 12, fontWeight: '600', color: '#94a3b8' },
  zoomModalRoot: { flex: 1, justifyContent: 'center', paddingHorizontal: 18 },
  zoomModalCard: { borderRadius: 18, padding: 14, gap: 10, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb' },
  zoomModalText: { fontSize: 14, fontWeight: '700', color: '#0f172a', lineHeight: 20 },
  zoomModalMeta: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  zoomModalActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  zoomModalBtn: { borderRadius: 14 },
  skeletonBarTitle: { height: 14, borderRadius: 7, backgroundColor: '#e5e7eb', width: '78%' },
  skeletonBarMeta: { height: 11, borderRadius: 6, backgroundColor: '#e5e7eb', width: '42%', marginTop: 6 },
  temporalitasCard: { borderRadius: 18, padding: 12, gap: 10 },
  temporalitasRow: { flexDirection: 'row', alignItems: 'center' },
  temporalitasSide: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  temporalitasSideRight: { flex: 1, minWidth: 0, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 6 },
  temporalitasDividerV: { width: StyleSheet.hairlineWidth, height: 34, opacity: 0.75 },
  temporalitasIcon: { margin: 0, padding: 0 },
  temporalitasText: { fontSize: 13, fontWeight: '900' },
  temporalitasCta: { borderRadius: 14, alignSelf: 'stretch' },
  lifeWrap: { marginTop: 6, position: 'relative', paddingLeft: 22 },
  lifeLine: { position: 'absolute', left: 8, top: 8, bottom: 8, width: 6, borderRadius: 6, opacity: 0.95 },
  lifeStack: { gap: 12 },
  lifeRow: { minHeight: 56 },
  skeletonPill: { height: 64, borderRadius: 22 },
  skeletonRow: { height: 22, borderRadius: 12 },
  milePill: { minHeight: 64, borderRadius: 24, paddingVertical: 10, paddingLeft: 10, paddingRight: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  mileDoneBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  mileTextCol: { flex: 1, minWidth: 0, gap: 6 },
  mileTitle: { fontSize: 14, fontWeight: '900' },
  mileMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mileDateChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  mileDateText: { fontSize: 12, fontWeight: '900' },
  mileNoteIcon: { margin: 0, padding: 0 },
  mileHubBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  mileHubIcon: { margin: 0, padding: 0 },
  noteModalRoot: { flex: 1, justifyContent: 'center', paddingHorizontal: 18 },
  noteModalCard: { borderRadius: 18, padding: 14, gap: 10 },
  noteInput: { minHeight: 90, maxHeight: 220, borderRadius: 14, borderWidth: 1, borderColor: '#cbd5e1', paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, lineHeight: 18 },
  noteModalActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  noteModalBtn: { borderRadius: 14 },
  multiplierRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  multBtn: { width: 44, height: 36, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  multBtnText: { fontSize: 18, fontWeight: '900' },
  multText: { fontSize: 14, fontWeight: '900' },
  switchLabel: { fontSize: 13, fontWeight: '800' },
  transportRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 18, marginTop: 4 },
  transportBtn: { width: 52, height: 52, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  transportIcon: { margin: 0, padding: 0 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  badgeText: { fontSize: 12, fontWeight: '900' },
  co2Text: { fontSize: 12, fontWeight: '700' },
  impactSlot: { height: 32, justifyContent: 'center' },
  comfortLine: { fontSize: 12, fontWeight: '700' },
  newtonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footer: { paddingHorizontal: 16, paddingTop: 10 },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  footerBtn: { borderRadius: 16, flex: 1 },
  footerCloseBtn: { borderRadius: 16 },
  enterPlaceholder: { height: 240 },
});
