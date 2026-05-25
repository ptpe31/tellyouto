# PROJECT_STATUS — Dev-trankil-v34 (TalknDone)

> Objectif de ce document : reconstruire la “mémoire” du projet après migration, en cartographiant **/src** et en recollant au contrat **SPEC.md** (one‑tap capture + offline‑first + SQLite Trankil‑v2).

## TL;DR

- Stack : **Expo / React Native**, React Navigation, React Context, **SQLite (expo-sqlite)** comme source de vérité locale (`talkndone.db`).
- Cœur produit : pipeline **OneTap Dual‑Path** (Path A heuristiques locales → Path B Gemini via proxy) puis **Douane** (parsing/normalisation) et **persistance**.
- Offline-first (**urbanisation SPEC v34 : 100 % terminée**) : en cas d’échec réseau/IA, la capture (texte/audio) est **mise en file** via `offline_audio_queue` + insertion d’une NOTE `is_pending_ai=1` (métadonnées `persistence_label` / `tag` = `NOTE_FALLBACK` + `source: offline_audio_queue`), puis rejouée ultérieurement. **NetInfo** : « en ligne » si `isConnected === true` **et** `isInternetReachable !== false` (`isNetInfoConsideredOnline`) ; log `[OFFLINE-STABILITY] netinfo_online_null_reachable` si tentative en ligne avec reachability `null`. **En ligne**, une coupure **pendant** Path B / persistance d’un chunk peut déclencher un **enqueue auto** (heuristique réseau/serveur, logs `[OFFLINE-STABILITY]`) sans Alert obligatoire. **Parité peek** : `INTENTION_PEEK_SNAPSHOT` (Path A) est émis **avant** `NetInfo` et la file, pour le même feedback visuel hors ligne qu’en ligne.
- **Feuille de Route (Pass 3)** : depuis la Timeline, icône imprimante → sas SQL (retards + orphelines) → synthèse Gemini HTML (RC `prompt_pass3_synth_v1`) → `daily_summaries` + WebView / PDF ; overlay progression réutilise `useAIProgressInertia` + `AIUniversalProgressOverlay` ; lien sous le groupe « Aujourd’hui ».
- **Cluster tactique (Tirelire)** : [`getBestOrphanCluster`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/clusterEngine.ts) sur `TimelineScreen` (seuil d’affichage `count >= 2`, contexte ALL + TODO) ; carte neumorphique + ouverture [`IdeaBankModal`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IdeaBankModal.tsx) filtrée par `category_id` ; log `[CLUSTER-ENGINE]`. **Projets orphelins** : bouton `cluster.planProjectStart` → `project.start_date` + replan jalons (`replanProjectMilestonesFromStartDate`) + `due_date` pour sortir du cluster.
- **TRIP — Contrat de Départ (mai 2026)** : **marge adaptative** `Deadline = T_arr − (T_pred × D)` ; `T_ideal` statique API ou distance/50 km/h ; relax fixe 15 min ; ancres `min()` ; hystérésis 5 min ; PROBE3 skip ; `departure_time ≥ now+2min` ; dispatcher PROBE1/2/3 ([`elasticSlotEngine.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/elasticSlotEngine.ts), [`trafficSchedulerElasticTick.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/trafficSchedulerElasticTick.ts)) ; zéro polling ; UI **ElasticDepartureCapsule** sheet + Timeline compacte ; **notifications locales** [`NotificationService.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/NotificationService.ts) (sticky silencieuse + Signal A sonore time-sensitive + Signal B rappel sans son) ; [`dossier_de_soumission.md`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/dossier_de_soumission.md) ; [`sentinelTripMission.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/sentinelTripMission.ts).
- **Pass 1 — Few-Shot JSON universel (mai 2026)** : `buildOneTapPass1SystemInstruction(now)` + `buildOneTapPass1UserContent(..., now)` — SI proxy (règles LIST/TASK différenciées + **6** few-shots multilingues FR/EN/ES) + user (`NOW` / `TZ` / `SEED` / `INPUT`) ; `maxOutputTokens: 2048` ; modèle RC **`gemini_pass1_model_id`**. Détail complet : **SPEC.md § 2**.
- **Pass 2 LIST/PROJECT (mai 2026)** : `geminiEnrichGenericList` — prompt inline `PASS2_*_INLINE_PROMPT` + `Transcription:` · **sans** `systemInstruction` · `temperature: 0.18` · `maxOutputTokens: 2048` · modèle RC **`gemini-pro-latest`** (défaut compilé) · chaîne fallback proxy `[override, …shortlist]`. Unités naturelles préservées (`sachets`, `pincées`, `g`…) ; `unités` → affichage quantité seule. Détail : **SPEC.md § Prompt Pass 2**.
- **Pass 3 / Expert** : même steering `gemini_pass2_model_id` ; warmup proxy cible **Pass 1** uniquement ; RC `[GEMINI-RC]` (mobile : défauts compilés, fetch réseau ignoré — Option A) ; re-fetch avant Pass 2 si source ≠ `remote` (**web**).
- **Thèmes dynamiques (mai 2026)** : **TalkThemeRegistry** + showroom AsyncStorage (`@trankil_debug_theme_variant`) — 6 variantes interchangeables à la volée depuis **Debug** (🎨 EXPLORATION GRAPHIQUE) ; `useDesignTokens()` réactif ; rollback = **Actuel (TellYouTo)**. Migrés : Timeline, TalkDebug, Debug, micro, `IntentionCard`, `IdeaBankModal`, `IntentionDetailSheet`. Détail : **SPEC.md § Architecture UI — 0)**.
- Alignement SPEC : le flux “**Micro as Bulk(1)**” est **unifié** : micro/texte unitaire passent par le **séquenceur bulk** avec persistance **ventilée** (une seule “source de vérité”), et un `traceId` est propagé pour des logs cohérents. **Calque global capture (mai 2026)** : [`GlobalCaptureOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/GlobalCaptureOverlay.tsx) monte **une fois** le micro + l’overlay pipeline ([`useCapturePipelineOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useCapturePipelineOverlay.ts) + [`useAIProgressInertia`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useAIProgressInertia.ts) + [`AIUniversalProgressOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/AIUniversalProgressOverlay.tsx)) au-dessus de toute la navigation ; présentation par écran via [`CapturePresentationContext`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/context/CapturePresentationContext.tsx). Sur **TalkDebug** (`dashboardPipelineHost`), l’overlay couvre l’attente Pass 1 (micro « échap » sans annuler le pipeline). **Correction STT optionnelle** : crayon → barre validation **Poubelle / Check** au-dessus du clavier (`translateY` + listeners clavier) → `transcript` final vers Gemini ; logs `transcript_manual_edit` / `[MIC] ✏️`.

---

## 1) Architecture globale

### 1.1 Entrypoints & bootstrap

- `index.ts` : charge i18n (`./src/locales/i18n`) puis enregistre `App`.
- `App.tsx` :
  - bootstrap services : `initializeGeminiEngine()` (steering RC Gemini), `configureCaptureBackgroundTask()`, `requestBackgroundExecutionPermissions()`
  - **Foreground RC** : `AppState` → `scheduleGeminiForegroundRemoteConfigRefresh()` (refresh silencieux modèle Gemini)
  - bootstrap DB : `bootstrapTrankilV2Database()` (avec fallback timer 1.2s pour ne pas bloquer l’UI)
  - injecte des Providers (ordre important car ils fournissent thème, i18n, profil, etc.)
  - monte `NavigationContainer` (avec deep linking + `rootNavigationRef`).
  - **`IntentionProvider` → `CapturePresentationProvider` → `AppNavigation` + `GlobalCaptureOverlay`** (micro + overlay pipeline persistants au-dessus des tabs/stack).

### 1.2 Navigation (React Navigation)

Fichiers : `src/navigation/*`

- `RootNavigator.tsx` : **Native Stack** racine
  - `App` → `MainStack`
  - `ProjectList` (screen dédiée)
  - `ProSubscription` (modal)
- `MainStack.tsx` : stack minimal qui expose `Tabs` → `AppNavigator`.
- `AppNavigator.tsx` : **Bottom Tabs**
  - `TalkDebug` (capture / debug / entry-point “one‑tap”)
  - `Timeline` (projection SQLite → UI + BottomSheet)
  - `Debug` (outils, reset, health checks, etc.)
- `linking.ts` : mapping des routes `tellyouto://` / `expo-linking` :
  - `/home` → `TalkDebug`, `/timeline` → `Timeline`, `/debug` → `Debug`.

### 1.3 Contextes (React Context)

Fichiers : `src/context/*` ; assemblés dans `App.tsx`.

- `ThemeContext` : thèmes Paper / couleurs + **variantes design** (`TalkThemeRegistry`, `applyDesignVariantToPaperTheme`).
- `LanguageContext` : i18n / locale.
- `DebugUnlockContext` : gating d’options debug.
- `AllyContext` : couche “assistant/ally” (UX).
- `PowerContext` : état “power” / capacités.
- `UserSpectrumContext` : **profil runtime** (ex. `locale`, `isProUser`) utilisé partout pour quotas, i18n, etc.
- `CalendarIntegrationContext` : intégration calendrier.
- `SaturationContext` : animation multiplier / “mode saturation” (overlay Blur).
- `FocusProtectionContext` : protections UX (focus / distraction).
- `IntentionContext` (**le cœur**) : orchestration de capture, OneTap (A/B), offline queue, bulk séquentiel, zoom projet.
- `CapturePresentationContext` : config micro global par écran focalisé (`variant`, `dashboardPipelineHost`, `compact`, `micHidden`, `disabled`) + état partagé overlay (`isPipelineOverlayVisible`, `captureRecordingActive`) + hooks lifecycle (`onPipelineSprintComplete`, etc.).

### 1.4 Thème & design tokens (`src/theme/`)

Architecture **Thèmes Découplés** — permet de tester 5 directions visuelles sans toucher à la logique métier.

| Fichier | Rôle |
|---------|------|
| [`TalkThemeRegistry.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/theme/TalkThemeRegistry.ts) | Palettes par variante, `getDesignTokens`, AsyncStorage `readPersistedDesignVariant` / `persistDesignVariant` |
| [`DebugScreen.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/DebugScreen.tsx) | Showroom **🎨 EXPLORATION GRAPHIQUE** — sélecteur 6 variantes (persistant) |
| [`colors.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/theme/colors.ts) | Palette TellYouTo (Teal `#008080`, Orange `#FF8C00`, Off-white `#F5F5F0`) |
| [`paperTheme.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/theme/paperTheme.ts) | `createTellYouToLightTheme` / `createTellYouToDarkTheme` (MD3) |
| [`neumorphism.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/theme/neumorphism.ts) | `neumorphicRaised` / `neumorphicInset` — composants **non encore migrés** |
| [`index.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/theme/index.ts) | Ré-exports publics |
| [`useDesignTokens.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useDesignTokens.ts) | Hook : `useDesignTokens()` → `DesignTokens` selon variante + schéma clair/sombre |

**Variantes disponibles** (`DesignVariant`) :

| Clé | Label | Notes |
|-----|-------|-------|
| `CURRENT` | Actuel (TellYouTo) | Défaut — calqué sur `palette` + `paperTheme` ; **rollback sûr** |
| `ZEN_NEUMORPHIC` | Zen Neumorphique | Sable / gris perle, ombres soft |
| `CYBER_MINIMALIST` | Cyber-Minimaliste | Noir `#000`, accent néon `#00FFD5`, radius 12 |
| `BENTO_MODERN` | Bento / Apple Style | Cards blanches, radius 24, accent `#0071E3` |
| `NORDIC_FOREST` | Nordic Forest | Sauge / sapin / crème |
| `SUNSET_PASTEL` | Sunset Pastel | Violet / pêche / corail pastel |

**Comment basculer un design** :

1. Onglet **Debug** → section **🎨 EXPLORATION GRAPHIQUE (TEST THÈMES)** (sous « Vider la base »).
2. Taper une variante — changement **immédiat** sur toute l’app (persisté AsyncStorage).

**Rollback** : retaper **Actuel (TellYouTo)** → zéro régression visuelle.

**Tokens consommables** (structure identique pour chaque variante) :

- `backgroundColor`, `cardBackground`, `textPrimary`, `textSecondary`, `accentColor`, `borderRadius`
- `shadowStyle` (relief raised), `cardShadowStyle` (relief inset)

**Intégration ThemeContext** : si variante ≠ `CURRENT`, `ThemeContext` fusionne les tokens dans `paperTheme.colors` (`primary`, `background`, `surface`, `onSurface`, etc.) — les composants Paper héritent du nouveau look sans migration.

**Composants déjà migrés** (mai 2026) :

- [`TimelineScreen.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TimelineScreen.tsx) — fond racine.
- [`TalkDebugScreen.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TalkDebugScreen.tsx) — fond + Phoenix + bouton Envoyer (micro **global**, plus local).
- [`DebugScreen.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/DebugScreen.tsx) — fond, titres, panneau showroom.
- [`GlobalCaptureOverlay.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/GlobalCaptureOverlay.tsx) — micro unique + overlay pipeline + quota lock.
- [`TalkCaptureMicButton.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TalkCaptureMicButton.tsx) — STT / enregistrement (monté par `GlobalCaptureOverlay` uniquement).
- [`IntentionCard.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionCard.tsx) — cartes Timeline.
- [`IdeaBankModal.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IdeaBankModal.tsx) — Tirelire / modale.
- [`IntentionDetailSheet.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionDetailSheet.tsx) — sheet + CTA principaux.

**Migration progressive recommandée** pour les autres composants :

```typescript
import { useDesignTokens } from '../hooks/useDesignTokens';

const designTokens = useDesignTokens();
// style={{ backgroundColor: designTokens.backgroundColor }}
// style={[designTokens.shadowStyle, styles.carte]}
```

Contrat SPEC complet : **SPEC.md § Architecture UI — 0) Architecture de Thèmes Découplés**.

### 1.5 Services (domain)

Repères dans `src/services/*` :

#### OneTap / Capture (cœur)

- `oneTapUniversalCapture.ts` : Path A (heuristique) + Path B (Gemini) + parsing & fusion (douane “avant DB”).
- `oneTapPersist.ts` : Douane “DB” (mapping type → schéma Trankil‑v2) + Pass 2 LIST/PROJECT + NOTE_FALLBACK.
- `services/captureStrategies/*` : stratégies “classiques” (task/habit/note/list/project) — utilisées ailleurs (ex. Timeline) ; **TalkDebug** ne déclenche plus le flux projet offline-first / deadline (`generateProjectPlanFromDeadline`) supprimé de l’écran au profit du pipeline OneTap unifié.
- `CaptureProcessingService.ts` : BackgroundFetch/TaskManager + queue AsyncStorage (jobs “analyse locale”).
- `services/intention/offlineAudioQueue.ts` : file offline texte/audio **en SQLite**, notifications, purge.
- `WhisperAdapter.ts` : transcription locale “best effort” via `whisper.rn` (si module dispo).

#### Données & persistance

- `api/trankilV2Db.ts` : **repository SQLite** (schema, writes sérialisées, queries Timeline, patchMetadata, quotas, Pass 3 cleanup `listIntentionsForPass3Cleanup`, `daily_summaries`, etc.).
- `api/localDb.ts` : petit KV local (table `app_prefs`), lui aussi sérialisé.

#### Firebase (Option A — web JS SDK, mai 2026)

Point d’entrée : [`src/config/firebase.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/config/firebase.ts) → `FirebaseProvider` :

| Fichier | Rôle |
|---------|------|
| [`firebaseWebProvider.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/config/firebaseWebProvider.ts) | Backend actif : App, Auth (AsyncStorage), Firestore (`memoryLocalCache()`) |
| [`firebaseNativeProvider.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/config/firebaseNativeProvider.ts) | Option B — `@react-native-firebase/*` (stub) |
| [`firebaseTypes.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/config/firebaseTypes.ts) | Interface + `EXPO_PUBLIC_FIREBASE_BACKEND` |
| [`src/api/firebase.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/api/firebase.ts) | Façade deprecated → `config/firebase` |

**Nettoyage** : `firebaseIndexedDbGuard.ts` supprimé (patch IndexedDB retiré).

**RC mobile (Option A)** : `fetchAndActivateRemoteConfig()` ignore le fetch réseau sur iOS/Android ; log `[GEMINI-RC] Mobile détecté : fetch réseau ignoré, utilisation des défauts compilés` ; pas de stacktrace `indexedDB` au boot.

**TODO (Option B)** : `@react-native-firebase/remote-config` dans `firebaseNativeProvider.ts` pour réactiver le pilotage console Firebase sur mobile.

#### IA Gemini

| Fichier | Rôle |
|---------|------|
| [`firebaseRemoteConfig.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/firebaseRemoteConfig.ts) | Singleton RC : skip fetch mobile (Option A), `fetchAndActivate` web, `getRemoteConfigEntry` + `source`, logs `[GEMINI-RC]` |
| [`initializeGeminiEngine.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/initializeGeminiEngine.ts) | Boot steering + shortlist Pass 2 si pas de `gemini_model_fallbacks` RC |
| [`geminiRemoteModelSteering.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiRemoteModelSteering.ts) | **`getActivePass1ModelId()`** / **`getActivePass2ModelId()`** ; override Debug Pass 2 ; blacklist 404/503 ; foreground refresh ; **`logPass2ModelSteeringDiagnostics`** ; **`ensureFreshPassModelsFromRemoteConfig`** |
| [`geminiModelCatalog.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiModelCatalog.ts) | Shortlist compilée ; défaut `gemini-3.1-flash-lite` |
| [`geminiSemanticLab.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts) | Appels proxy (SSE), verrou steering 2 s, retry candidats, exclusion session |
| [`GeminiExpert.js`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/GeminiExpert.js) | Idem verrou + self-healing pour flux Expert / atomize |
| [`dailyRoadmapPass3.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/dailyRoadmapPass3.ts) | Pass 3 Feuille de route HTML |
| [`geminiResponseGuards.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiResponseGuards.ts) | Parsing / guards |

**Remote Config (console Firebase)**

- `gemini_pass1_model_id` — extraction One-Tap + warmup proxy (défaut compilé `gemini-3.1-flash-lite`)
- `gemini_pass2_model_id` — raisonnement Pass 2 / Pass 3 / Expert / lab (défaut compilé `gemini-pro-latest` ; **mobile** : toujours défauts compilés jusqu’à Option B — pas de fetch réseau Hermes)
- `gemini_model_fallbacks` — CSV candidats de secours Pass 2 (optionnel)
- `prompt_pass3_synth_v1` — template Pass 3

**AsyncStorage**

- `debug_override_model` (24 h, override Pass 2 prioritaire en Debug)

**Logs boot** : `[GEMINI-RC]` (init / skip mobile / fetch web OK|ÉCHEC), `[GEMINI-BOOT]`.

#### Sentinel / Trafic — Contrat de Départ (TRIP PRO)

Fichiers clés sous `src/services/traffic/` :

| Fichier | Rôle |
|---------|------|
| [`elasticSlotEngine.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/elasticSlotEngine.ts) | Moteur pur : `D = T_pred/T_ideal`, deadline `T_arr−T×D`, relax 15 min, `resolveContractRatioD`, ancrage `min()` |
| [`DistanceMatrixMapsService.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/DistanceMatrixMapsService.ts) | `fetchTrafficSample(task, { departureTimeUnix? })` + cache par bucket départ |
| [`sentinelElasticTripMetadata.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/sentinelElasticTripMetadata.ts) | `buildContractTripPatch`, champs `elastic_anchor_*`, `elastic_degradation_ratio`, `probe3_skipped` |
| [`tripTripReadiness.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripTripReadiness.ts) | Blocages mission (`destination`, `arrival_time`) |
| [`tripProbeScheduleDisplay.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripProbeScheduleDisplay.ts) | Badge scan C1/C2 : `scanTrafficScheduled` / `scanTrafficInProgress` |
| [`useProbeScheduleClock.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useProbeScheduleClock.ts) | Tick 30 s pour bascule badge futur → en cours |
| [`tripSurveillanceButton.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripSurveillanceButton.ts) | États Big Button Sheet (`Surveiller le trajet` / active / locked) |
| [`sentinelDbRetry.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/sentinelDbRetry.ts) | Retry sync metadata SQLite + recovery kick |
| [`sentinelElasticProbes.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/sentinelElasticProbes.ts) | Planification sondes, `resolveTrafficDeltaMin`, retry échec API |
| [`trafficSchedulerElasticTick.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/trafficSchedulerElasticTick.ts) | Dispatcher : `executeProbe1Contract` / `executeProbe2Contract` / `executeProbe3Contract` / `finalizeProbe3Silent` |
| [`tripMathLogger.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripMathLogger.ts) | Logs `[TRIP-MATH]` avec `[Ratio_D]`, `[UI_UPDATE]`, `[PROBE3_SKIPPED]` |
| [`TrafficSchedulerV4.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/TrafficSchedulerV4.ts) | 1 `setTimeout`/TRIP sur `next_real_scan_at_ms` |
| [`SentinelBackgroundService.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/SentinelBackgroundService.ts) | Filet OS : tick **si sonde due** (pas de polling global) |
| [`sentinelTripMission.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/sentinelTripMission.ts) | `cancelTripMission`, `clearTripElasticProbeMetadata`, **`suspendTripMissionForAllDay`** |
| [`sentinelReconciler.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/sentinelReconciler.ts) | Activation + reset + debounce 500 ms + mutex ; reconcile **onSelect only** |
| [`tripElasticDisplay.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripElasticDisplay.ts) | Affichage UI depuis `metadata_json.trip` ; **`isTripAllDay`** |
| [`ElasticDepartureCapsule.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/ElasticDepartureCapsule.tsx) | Capsule Apple-like du contrat : piste D, bille animée, deadline, GPS, état retard |
| [`TripNeumorphicOrb.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TripNeumorphicOrb.tsx) | Orbe partagé TRIP (`card` 54 px / `compact` 26 px) pour transport, scan/GPS, retard |
| [`tripElasticCapsuleModel.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripElasticCapsuleModel.ts) | Éligibilité Timeline + mapping `elastic_anchor_*` / `ratioD` vers capsule |
| [`tripNavigation.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripNavigation.ts) | Lancement Apple/Google Maps/Waze réutilisable depuis sheet + Timeline ; `clearAllDepartureNotifications` au GPS |
| [`NotificationService.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/NotificationService.ts) | Contrat de départ : sticky silencieuse, Signal A (départ + son), Signal B (rappel), sync V4 |
| [`formatDepartureCapsule.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/formatDepartureCapsule.ts) | `formatCapsule(trip)` → chaîne Unicode `[🟢 HH:mm ———◉———— HH:mm]` |
| [`dossier_de_soumission.md`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/dossier_de_soumission.md) | Textes copier-coller Apple/Google (localisation, time-sensitive, confidentialité) |
| [`nettoyage-code-mort.md`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/nettoyage-code-mort.md) | **Registre de code mort** : modules retirés ou stubés, procédure de réactivation, checklist suppression définitive (voir § Annexe — registre code mort) |

**Legacy conservé** : `TrafficScheduler.ts` / `TrafficEngine.ts` (DebugScreen simulateur) ; colonnes SQLite `displayed_t_*`, `newtonEnabled` en metadata (nettoyage UI fait).

**Supprimé du chemin produit** : switch Newton, polling confort 5 s, tick interne 60 s, badge Timeline « Circulation : X min ».

---

## 2) Pipeline de capture (texte/audio → SQLite)

> Vue “reverse-engineered” depuis les points d’entrée UI (TalkDebug/Timeline) et `IntentionContext`/`oneTap*`.

### 2.1 Entrée (UI) : texte et/ou audio

- `TalkDebugScreen.tsx` : écran principal de capture (debug-friendly) :
  - **Phoenix** (champ texte) passe par `IntentionContext.submitCapturePayload` (Bulk(1) / OneTap). Le **micro** est global (`GlobalCaptureOverlay`) ; TalkDebug configure `variant: talkDebug` + `dashboardPipelineHost: true` via `CapturePresentationContext`.
  - **Micro — correction STT (optionnelle)** : **Crayon** → mode édition (`CaptureTranscriptEditor`, STT gelé, `LayoutAnimation`). Barre réduite **Poubelle · Check** (Pause/Crayon masqués) ; le bloc capture remonte avec le clavier (`keyboardWill*` / `keyboardDid*`, `translateY` animé, offset safe area + 20 px). **Check** : dismiss clavier + `stopRecording` (texte corrigé) ; **Poubelle** : dismiss + annulation capture. Comportement identique Timeline / Talk (même composant global). Logs `[CAPTURE_FLOW]` `transcript_edit_start` / `transcript_manual_edit` + `[MIC] ✏️`.
  - **Overlay progression** : orchestré par [`GlobalCaptureOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/GlobalCaptureOverlay.tsx) + [`useCapturePipelineOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useCapturePipelineOverlay.ts) (ex-logique TalkDebug) ; [`AIUniversalProgressOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/AIUniversalProgressOverlay.tsx) en `Modal` plein écran ; titre i18n `talkDebug.stepTransport` / `stepTranscription` / `stepAnalysis`, barre 0–100 % lissée, mode **orange** + `talkDebug.errorNetwork` si file NetInfo ; succès → fade puis reveal **DealerBoard** ; résilience → **2 s** puis navigation **Timeline**. Micro global visible : tap en **`pipeline_wait`** ferme l’overlay via `exitPipelineWaitToIdle` **sans** annuler `submitCapturePayload`. `IntentionSuggestionsBanner` masqué via `captureRecordingActive` / `isPipelineOverlayVisible`.
  - **Fin de salve ballet** : sprint **200 ms** jusqu’à **100 %** (événements `gemini_one_tap_call_success` / `persist_callback`, géré dans `useAIProgressInertia`), **hold 150 ms** puis fermeture de l’overlay ; logs `[BALLET-PROFILER]` (`T5_BOOST_START`, `T5_100_REACHED`, `T6_HIDE_START`) ; libellé final i18n `talkDebug.stepComplete`.
  - **Mixeur d’intentions (Talk)** : `peekDetailRows` aligné sur `DealerBoard` / `dealerBulkItems` ; `selectedIntentionIndex` + surbrillance carte ; `IntentionDetailSheet` reçoit la même sélection + `intentionMixAccentColor` via `getIntentionColor(title)` (`src/utils/intentionColorHash.ts`) ; morph du corps de fiche quand plusieurs lignes peek.
  - Ancien CTA « projet structuré (échéance) », modale deadline, prévisualisation plan Gemini et persistance `PROJECT_ATOMIZE` **retirés** de cet écran (Pass 2 projet à la demande vit dans `oneTapPersist` / contexte).
- `IntentionContext.tsx` expose une API interne :
  - `startCapture()` / `cancelCapture()` : réinitialise les refs capture (sans funnel UI « streaming »).
  - `submitCapturePayload({ transcript, transcriptOriginal?, audioUri, lang, traceId? }) → Promise<boolean>` : **soumission** (post-dictée) ; `transcript` = texte final (STT ou corrigé manuellement) ; peek Path A **avant** NetInfo ; hors ligne → file SQLite ; en ligne → `await runGeminiBulkSequence` (Bulk(1)). Le booléen indique si la donnée est sûre (persistée ou file offline, y compris auto-queue réseau).

### 2.2 Path A : squelette local immédiat (synchrones, sans réseau)

Fichier : `src/services/oneTapUniversalCapture.ts`

Fonction clé : `inferOneTapSkeletonFromTranscript(transcript, { uiLocale, titleHint? })`

Étapes (résumé) :

1. Nettoyage : `cleanTranscriptText()` (depuis `smartTitle.ts`).
2. Classification heuristique : type grossier `LIST / ANNIVERSARY / HABIT / RECURRING_TASK / TASK / NOTE` (+ TRIP forcé si signaux de déplacement).
3. Catégorisation : mapping `HOME/WORK/.../PERSO` par regex.
4. Titre : `generateSmartTitle()` (fallback heuristique) ou `titleHint`.
5. Temporalité : extraction chrono-node (dueDateYmd/dueTimeHm) selon locale.
6. Données initiales “par type” : ex. `memo`, `destination_name`, `preferredTimeHm`, etc.

Objectif : fournir un **brouillon UI** instantané (pas de dépendance réseau).

### 2.3 Path B : affinage Gemini (cloud) + Douane “parsing”

Fichier : `src/services/oneTapUniversalCapture.ts`

Fonction clé : `refineOneTapWithGeminiCompressed(transcript, skeleton, options)`

Points importants (voir **SPEC.md § 2** pour le texte intégral) :

- **Transport Pass 1** : `body.systemInstruction` = règles + 6 few-shots multilingues + schéma ; `request.contents` = `NOW:` / `TZ:` / `SEED:` (`wireLineFromSkeleton` : `P:type|K:category|T:title|…`) / `INPUT:"""…"""`.
- Prompt : `buildOneTapPass1SystemInstruction(now)` + `buildOneTapPass1UserContent(transcript, seed, now)` — `now` unique par capture ; legacy Bullet-Pipe en `*Legacy()`.
- **SI** : ligne `NOW` locale autoritaire · bloc `RULES` (CATEGORY `HOME WORK … OTHER`, TRIP triggers injectés, **LIST** = inventaire multi-items / recette / fournitures, **TASK** = achat ponctuel ou énumération simple) · 6 exemples FR/EN/ES (zero translation) · clôture JSON pur.
- **`generationConfig`** : `maxOutputTokens: 2048` · `temperature: 0` (stream) · pas de `responseMimeType`.
- **Modèle** : `getActivePass1ModelId()` → RC `gemini_pass1_model_id` ; ops `oneTap.wire.stream` / `oneTap.wire.nonstream`.
- Appel Gemini : `geminiSemanticLab` (stream ou non‑stream).
- Parsing modèle :
  - **priorité JSON** : `parseJsonIntentsFromBuffer` (trailing garbage coupé en mode final `!partial`)
  - **repli Bullet-Pipe** uniquement si le buffer ne contient **aucun `{`** (évite faux positifs sur excuses markdown)
  - type intermédiaire **ExtractionResult** ; intents portent `category` + `context`
- Fusion : `mergeIntentArrayIntoOneTapSkeleton(...)` puis normalisation
  - **`clearPass1MergedIntentFields`** : isolation par intention en bulk (reset list/trip/due à chaque itération ; dernière intention → preview top-level) — corrige la fuite TRIP→LIST en logs streaming
  - `categoryTag` + **`contextTag`** sur le brouillon fusionné
  - normalisation des catégories inconnues → `PERSO` (`normalizeOneTapCategoryCode`)
  - normalisation contexte → token uppercase (`normalizeOneTapContextTag`)
  - normalisation temporelle via [`parsePass1DueDateTime`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/pass1DueDateParse.ts) / `applyPass1DueFields` (`timeMarker` ALL_DAY/EXACT_TIME)
- Observabilité : `[DOUANE]` (parsing), `[CAPTURE_FLOW] pass1_bullet_pipe_resolved`, `[OneTap] 📍 CONTEXT_TAG`, `[GeminiAPI] Context:`

Sortie : un `OneTapUniversalResult` enrichi (`categoryTag`, `contextTag`) + métadonnées HTTP (tokens, latence, coût).

### 2.4 Persistance (SQLite Trankil‑v2) : Douane “DB”

Fichiers principaux :

- `src/services/oneTapPersist.ts`
- `src/api/trankilV2Db.ts`

Idée : convertir le `OneTapUniversalResult` (universel) en lignes SQLite **compatibles Trankil‑v2**.

Points notables :

- `materializeOneTapIntentionRow(...)` : mapping vers `TrankilV2IntentionInsert`
  - mapping `draft.data.ai_cost_usd` → colonne SQLite `intentions.cost` (SPEC)
  - mapping tokens → `tokens_prompt/completion/total`
  - `category_id` : normalisé via `normalizeDomainCategoryId()` (fallback PERSO, éviter NULL)
  - **`context_tag`** : depuis `draft.contextTag` (`normalizeOneTapContextTag`)
- ventilation multi-intentions : `resolveVentilatedIntentTags` propage `category` + `context` par intent avant `persistAndDualWrite`
- insertion : `insertTrankilV2Intention(...)` — écrit `category_id` + `context_tag` ; log `[DATABASE] ✅ Intention sauvée avec succès | Category: … | Context: …`
- mutations `metadata_json` : via `patchMetadata(...)` (merge sécurisé, attendu par SPEC)

#### Pass 2 (LIST / PROJECT)

SPEC (v34) : **aucun** enrichissement Pass 2 automatique après Pass 1 ; uniquement après action PRO + **`pass2_unlocked: 1`** (compteur binaire — CTA masqué définitivement).

État actuel :

- **`oneTapPersist.ts`** : insertion `LIST` / `PROJECT` avec placeholders minimaux (`list_enrich_status: 'idle'`, `is_generating: false`) — **pas** d’appel `geminiEnrichGenericList` dans la Douane.
- **`IntentionDetailSheet.tsx`** : footer CTA TRIP/LIST/PROJECT ; `pass2_unlocked: 1` au clic PRO ; TRIP → `intentionDetail.actionSetupAlert` (*Me prévenir quand partir ?*) ; surveillance **Big Button uniquement** (`remind_to_leave` lu en DB pour `syncSentinelAfterDestinationChange`) ; sheet vierge (`remindToLeaveEnabled=false`) à chaque `row.id`.
- **TRIP logistique (sheet)** : pill **créneau élastique** PRO ; switch `remind_to_leave` (FREE → paywall) ; **All Day** → `suspendTripMissionForAllDay` (remind OFF, clear metadata, stop sondes) ; retour horaire → `wakeTripMissionAfterTimedRestore` ; bouton **Lancer l’itinéraire** si coords arrivée.
- **`TalkDebugScreen.tsx`** : `onPatchRow={patchPeekDetailRow}` sur `IntentionDetailSheet` (sync `peekDetailRows` après Pass 2 — évite CTA fantôme post-génération).
- **Pass 2 modèle** : `getActivePass2ModelId()` → RC `gemini_pass2_model_id` (défaut compilé `gemini-pro-latest`) ; proxy fallback `[override, …shortlist]` ; `[GEMINI-RC] Pass2 steering` + re-fetch si source ≠ `remote` (**web**).
- **Pass 2 prompt (`geminiEnrichGenericList`)** — voir **SPEC.md § Prompt Pass 2** :
  - **LIST** : expert logistique · miroir linguistique · domaine (recette→ingrédients, examen→chapitres…) · `scalable:true` · JSON `list_scalable_v1` avec `baseQuantity` par personne.
  - **PROJECT** : jalons sans dates · `expert_persona` obligatoire · JSON `project_milestones_v1`.
  - Transport : **tout inline** dans `contents[0].text` (pas de `systemInstruction`) · `Transcription:"""…"""` · `lab.list_enrich_generic` · `temperature: 0.18` · `maxOutputTokens: 2048`.
- **Post-parse LIST** : `parseGeminiListInventoryJson` + **`normalizeUnit`** — conserve `g/kg/ml/cl/l` et unités libres (`sachets`, `pincées`, …) ; `unités`/`units` → `""` (UI « 20 Œufs ») ; `IntentionDetailSheet` / `ListIntentionCard` affichent quantité seule si unité vide.
- **Pass 1 dates** : [`pass1DueDateParse.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/pass1DueDateParse.ts) — Hermes-safe.
- **Pré-warming** : [`warmGeminiProxySession`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts) appelé depuis [`TalkCaptureMicButton`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TalkCaptureMicButton.tsx) après `setIsRecording(true)` si réseau disponible.

#### NOTE_FALLBACK (résilience)

Si aucune intention persistable n’est extraite/persistée, `oneTapPersist.ts` peut créer une NOTE de fallback (label `NOTE_FALLBACK`) pour ne pas “perdre” la capture.

### 2.5 Offline-first : file locale + rejouage (**SPEC v34 — terminé**)

**Parité peek** : `submitCapturePayload` émet **`INTENTION_PEEK_SNAPSHOT`** (Path A) **avant** `NetInfo` et avant toute mise en file, pour que l’utilisateur voie le même bandeau que en ligne.

**NetInfo** : `isNetInfoConsideredOnline` dans `src/utils/offlineStability.ts` — en ligne si `isConnected === true` **et** `isInternetReachable !== false` (seul `false` bloque explicitement le chemin Gemini ; `null` évite les faux négatifs). Aligné sur `TalkCaptureMicButton` (ton succès online/offline).

Fichier : `src/services/intention/offlineAudioQueue.ts`

En cas de :
- offline (`!isNetInfoConsideredOnline(net)`), ou
- échec Gemini / parsing / persistance **avec** erreur classée réseau/serveur pendant le bulk en ligne (`isLikelyNetworkOrServerError` dans `offlineStability.ts` → enqueue auto),
- échec sans classification réseau : Alert `proposeOfflineFallback` si aucune persistance ni enqueue auto,

`IntentionContext` appelle :

- `queueOfflineAudioCapture({ transcript, audioUri, title, lang })` **ou**
- `queueOfflineTextCapture({ transcript, title, lang })`

Ce que fait la queue offline :

1. S’appuie sur la table `offline_audio_queue` (SQLite) + indexes déjà créées au bootstrap (`initTrankilV2Schema`).
2. Copie le fichier audio dans `documentDirectory/offline_queue/<uuid>.m4a` (si audio).
3. Insère une NOTE dans `intentions` :
   - `metadata_json` : `source: 'offline_audio_queue'`, **`persistence_label` / `tag` : `NOTE_FALLBACK`** (identification retry / Timeline ; les lignes `source=offline_audio_queue` ne sont **pas** masquées par `isHiddenTechnicalNoteFallbackRow`),
   - `is_pending_ai = 1`
4. Ajoute une ligne de queue `offline_audio_queue(status='pending')`.
5. Notification : `notifyOfflineAudioPendingAnalysis()` (actions “Analyser / Garder audio”).

**Observabilité** : logs console **`[OFFLINE-STABILITY]`** via `src/utils/offlineStability.ts` (`logOfflineStability`, `isLikelyNetworkOrServerError`, `isNetInfoConsideredOnline`, phase **`netinfo_online_null_reachable`**) ; **`[CAPTURE_FLOW]`** via `src/utils/captureFlowLog.ts` : logs console **`__DEV__`** **et** bus global **`notifyCapturePipelineProgress`** (`CAPTURE_PIPELINE_PROGRESS_EVENT`) pour l’overlay global (`GlobalCaptureOverlay` / `useCapturePipelineOverlay`) + corrélation `traceId` ; phases incluant `peek_snapshot_emit`, **`peek_snapshot_offline_queue`**, **`bulk_network_resilience_enqueue`**, `submit_netinfo`, `submit_offline_queued`, etc.

Rejouage :

- `IntentionContext.analyzeLatestOfflineAudio()` rejoue un élément `pending` via `submitCapturePayload` ; **`markOfflineAudioAsDone` n’est appelé qu’après** un retour **`true`** de `submitCapturePayload` (succès bulk, bulk complet sans break, ou enqueue offline direct / auto), sinon l’entrée reste `pending`.

### 2.6 Background processing (TaskManager)

Fichier : `src/services/CaptureProcessingService.ts`

- Task `TALKNDONE_CAPTURE_PROCESSING_TASK` (BackgroundFetch) :
  - lit une queue AsyncStorage (`talkndone.capture.processing.queue`)
  - traite 1 job : `analyzeLocally(transcript, locale)` (Gatekeeper / NLP.js)
  - réécrit la queue.

⚠️ Cette queue **n’est pas** la même que `offline_audio_queue` (SQLite). Elle sert plutôt à des traitements locaux “light”.

---

## 3) Fonctions clés repérées (échantillon utile)

### 3.1 OneTap / parsing / titre

- `src/services/smartTitle.ts`
  - `cleanTranscriptText(rawTranscript)` : nettoyage “pré‑titre” (filler words, segments faibles).
  - `shouldLockSmartTitle(transcript)` : heuristique “verrouiller” un titre si transcript long / ponctué.
  - `generateSmartTitle(rawTranscript, locale?)` : titre court, supprime marqueurs temporels (heuristique).
  - `sanitizeDisplayTitle(input, locale?)` : sanitation générique d’un titre affiché.

- `src/services/oneTapUniversalCapture.ts`
  - `splitBulkTranscript(raw)` : split par séparateur `**` (bulk client-side).
  - `inferOneTapSkeletonFromTranscript(...)` : Path A synchrone (squelette local).
  - `refineOneTapWithGeminiCompressed(...)` : Path B Gemini (`systemInstruction` Pass 1 Few-Shot JSON + corps user via `geminiGenerateOneTapCompressedLine` / stream ; `getActivePass1ModelId()`).
  - `buildOneTapPass1SystemInstruction(now: Date)` / `buildOneTapPass1UserContent(transcript, seed, now)` : Few-Shot JSON universel ; legacy Bullet-Pipe dans `*Legacy()`.
  - `parsePartialWireLine(buffer)` / `mergeWireIntoOneTapSkeleton(...)` : parsing “wire” (héritage + compat).
  - (internes critiques) `parseBulletPipeIntentsFromBuffer`, `parseJsonIntentsFromBuffer`, `mergeIntentArrayIntoOneTapSkeleton`.

### 3.1b Timeline — cluster tactique (Tirelire)

- [`clusterEngine.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/clusterEngine.ts) : **`getBestOrphanCluster(rows)`** — filtre TODO sans `due_date`, groupe par `category_id` (normalisation alignée domaine), choix du plus grand groupe puis départage par **`created_at`** le plus ancien ; log **`[CLUSTER-ENGINE] 🎯 …`**
- [`TimelineScreen.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TimelineScreen.tsx) : agrège **`orphanClusterPool`** (tirelire cachée + TODO sans date dans `filteredPool`) ; si `count >= 2` et filtres ALL/TODO, entrée liste **`ideaBankCluster`** (carte unique) ; sinon comportement **`ideaBank`** inchangé ; état **`ideaBankCategoryFilter`** pour passer à **`IdeaBankModal`** uniquement les lignes du cluster.
- i18n : `timeline.ideaBank.clusterNudge`, `timeline.ideaBank.clusterSubtitle`.
- **Planifier le début (PROJECT)** : dans [`IdeaBankModal.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IdeaBankModal.tsx), si `type === 'PROJECT'` et pas de `project.start_date` (`getProjectStartDateFromMetadataJson`), le CTA **Planifier le début** (`cluster.planProjectStart`) ouvre le sélecteur de date ; à la validation : `patchMetadata` (`start_date` + `buildProjectMilestonesMetadataPatch` après `replanProjectMilestonesFromStartDate`) puis `updateTrankilV2IntentionTemporal({ due_date })` — l’intention quitte le pool orphelin et apparaît sur la Timeline. Autres types : `due_date` seul (`timeline.ideaBank.schedule`).
- Util partagée : [`projectMilestonesModel.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/projectMilestonesModel.ts) — `getProjectStartDateFromMetadataJson`, `replanProjectMilestonesFromStartDate`.

### 3.1c Timeline — carte TRIP (`IntentionCard`)

- [`IntentionCard.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionCard.tsx) : pied de carte **uniquement** si `metadata_json.trip` ; logique [`tripTimelineCard.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripTimelineCard.ts) (`resolveTripTimelineFooter`) — lecture **metadata only** + `remind_to_leave` (SQL Timeline).
- **All Day** : **aucun** footer Timeline (pas de badge).
- **FREE** : footer CTA verrouillé → paywall direct ; tap corps → **hub TRIP unifié** (vitrine + `tripSurveillanceStartLocked`).
- **PRO + PROBE1 fait + mission surveillée active** : [`ElasticDepartureCapsule`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/ElasticDepartureCapsule.tsx) compacte remplace le badge texte ; mapping via [`tripElasticCapsuleModel.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripElasticCapsuleModel.ts) (`elastic_anchor_*`, fallback fenêtre résolue, `elastic_degradation_ratio`) ; tap = navigation GPS.
- **Retard Timeline** (`nowMs > endMs`) : capsule remplacée par un orbe GPS graphite `#1C1C1E` sans texte, taille `compact` (26 px), aligné sur le slot X du badge GPS vert.
- **PRO + mission active + PROBE1 pending** : badge scan à 3 états — `timeline.scanTrafficScheduled` (heure miroir `trip.next_probe_at_ms`), `timeline.scanTrafficInProgress` (≤ 60 s avant l’heure ou heure passée), puis fenêtre élastique après PROBE1 ; horloge locale [`useProbeScheduleClock`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useProbeScheduleClock.ts) (tick 30 s, cleanup au démontage).
- **Reconcile Sentinel** : déclenché à la sélection autocomplete (`onSelect`) et au tap Big Button ; debounce 500 ms ; mutex activation par `intentionId` ; retry SQLite [`withSentinelDbRetry`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/sentinelDbRetry.ts) (logs `[TRIP-SENTINEL-RECOVERY]`). `syncSentinelAfterDestinationChange` no-op si `remind_to_leave === 0`.
- **PRO non configuré** : footer CTA setup **ou** tap corps → **même Sheet hub unifiée** (mémo + logistique + Big Button).
- **Sheet TRIP** : plus de switch — Big Button [`tripSurveillanceButton.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripSurveillanceButton.ts) (`tripSurveillanceStart` / `tripSurveillanceActive` / locked) ; toast si champs manquants ; origine GPS non bloquante ; garde anti double-tap ; `applyTripMetadataLocally` après `onSelect` Places (sync optimiste Big Button).
- **Readiness coords** : [`tripTripReadiness.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripTripReadiness.ts) — `readValidTripCoords` rejette `null`/`0` ; pas de préremplissage favori silencieux à l’ouverture sheet.
- **Fix crash Surveiller** : INSERT `sentinel_trips` — 31 placeholders / 31 args ; reset connexion SQLite sans ré-init schéma ; queue `getFirstAsync` / `getAllAsync` ; `getTrankilV2IntentionById` via `withTrankilV2Database`.
- **Anti-faux créneau** : pas de fenêtre UI sans `standard_duration_min`.
- **Contrat de Départ (mai 2026)** : deadline auto-calibrée `T_arr − (T_pred×D)` (sans α fixe) ; `T_ideal` distance/50 km/h ; PROBE1 `departure_time ≥ now+2min` ; shifts `D=max(D₁,D_live)` ; hystérésis 5 min ; PROBE3 skip. Voir SPEC § formules élastiques.
- TASK / HABIT / LIST / PROJECT : layout inchangé (hauteur 105).

### 3.2 Orchestration UI capture

- `src/context/IntentionContext.tsx`
  - `submitCapturePayload(...) → Promise<boolean>` : Path A peek (`INTENTION_PEEK_SNAPSHOT`) **avant** NetInfo ; hors ligne → file SQLite ; en ligne → `await runGeminiBulkSequence`. `true` = donnée persistée en ligne **ou** placée en file offline (directe ou auto-queue réseau) ; sert au drain sûr du rejouage.
  - `runGeminiBulkSequence(...)` : séquenceur bulk **séquentiel** ; échec chunk → `break` ; erreur réseau/serveur → **enqueue auto** `queueOffline*` (reste des chunks ou transcript+audio si rien n’a été persisté) ; `allowAutoOfflineQueue: false` pour `triggerJalonZoom`.
  - `proposeOfflineFallback(...)` : Alert UI + sauvegarde hors-ligne (repli si erreur non réseau / pas d’enqueue auto).
  - `triggerJalonZoom({ projectIntentionId, parentJalonUid })` : “zoom IA” d’un jalon projet (réutilise bulk(1) en mode enfant).

### 3.3 Persistance / Douane DB

- `src/services/oneTapPersist.ts`
  - `persistOneTapDraft(...)` : persistance unitaire (1 intention).
  - `persistOneTapDraftVentilated(...)` : persistance multi‑intentions (ventilation) + contrôle `allowNoteFallback`.
  - `preSaveOneTapOptimisticDraft(...)` / `finalizeOneTapOptimisticDraft(...)` / `replacePendingOneTapDraft(...)` : pipeline “optimistic row” (pré‑save puis finalisation).
  - (interne) `materializeOneTapIntentionRow(...)` : mapping OneTap → colonnes Trankil‑v2.

- `src/api/trankilV2Db.ts`
  - `bootstrapTrankilV2Database()` : init unique.
  - `initTrankilV2Schema()` : création tables + indexes + backfills ; migration **`context_tag`** via `ALTER TABLE` (données existantes conservées).
  - `insertTrankilV2Intention` : `category_id` forcé non-null (`normalizeIntentionCategoryId`) ; colonne **`context_tag`**.
  - `withTrankilV2Database(fn)` : exécuteur sérialisé + auto-reopen si `NativeDatabase.prepareAsync` rejette.
  - Queue SQLite : `runAsync`, `execAsync`, **`getFirstAsync`**, **`getAllAsync`** (patch au bind `getDb()`) — lectures + écritures sérialisées pour éviter race UI/Sentinel.
  - `getTrankilV2IntentionById` : lecture via `withTrankilV2Database` (point d’entrée Sentinel).
  - `patchMetadata(id, partial, opts?)` : merge transactionnel `metadata_json` (contrat SPEC).

### 3.4 Offline queue & background

- `src/services/intention/offlineAudioQueue.ts`
  - `queueOfflineAudioCapture(...)` / `queueOfflineTextCapture(...)`
  - `getLatestPendingOfflineAudio()` / `getOfflineAudioById(queueId)`
  - `markOfflineAudioAsDone(queueId)` / `markOfflineAudioAsKept(queueId)`
  - `notifyOfflineAudioPendingAnalysis()`
  - `purgeProcessedQueue()`

- `src/services/CaptureProcessingService.ts`
  - `configureCaptureBackgroundTask()` : register BackgroundFetch.
  - `enqueueCaptureProcessingJob(transcript, locale)` : push AsyncStorage queue.
  - `startCaptureProcessingForeground(context)` / `stopCaptureProcessingForeground()` : notif sticky Android (garder app active).

---

## 4) Diagnostic — “qu’est-ce qui manque” pour être 100% stable selon SPEC.md ?

> Ci-dessous : les écarts “actionnables” constatés dans le code /src par rapport aux exigences explicites de SPEC.md.

### 4.1 Unification “Micro as Bulk(1)” (aligné SPEC)

SPEC (section “Pipeline Unique — Micro as a Bulk(1)”) demande :

- `submitCapturePayload` → route **toute** capture micro vers `runGeminiBulkSequence({ chunks:[transcript] })`
- afin d’avoir : mêmes logs, mêmes verrous, même ventilation DB (`persistOneTapDraftVentilated`), mêmes règles d’échec chunk, **plus** file offline automatique sur erreurs réseau/serveur pendant le bulk.

État actuel :

- `submitCapturePayload(...)` **attend** la fin de `runGeminiBulkSequence(...)` (`await`) et propage un **booléen** de « sûreté » (drain replay / confirmation file).
- micro = `chunks=[transcript]` (Bulk(1)) ; persistance **uniquement** via `persistOneTapDraftVentilated(...)`.
- `traceId` est fixé avant l’appel bulk pour des logs cohérents.

### 4.2 Nettoyage du “code mort” / complexité streaming multi-intents

SPEC : simplicité = stabilité ; pas de second pipeline « live » dans le contexte capture.

**Registre dédié :** [`nettoyage-code-mort.md`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/nettoyage-code-mort.md) — inventaire des symboles retirés ou commentés, liens fichiers, checklist avant suppression définitive. **À mettre à jour** à chaque retrait de feature (pas d’utilisateurs finaux → privilégier commentaires + stubs plutôt que delete immédiat).

État actuel :

- `oneTapUniversalCapture.ts` conserve une surface `useStream` / parsing multi‑intents pour compatibilité interne ou usages futurs.
- `IntentionContext` **n’expose plus** `runGeminiStreamRefine` ni validation streaming associée : un seul chemin bulk + persistance ventilée.
- **Nudge « 2 minutes disponibles »** (`AvailabilityNudgeModal`) : **retiré** de `App.tsx` (mai 2026) ; stubs + blocs `DEPRECATED` dans `AvailabilityNudgeModal.tsx`, `AvailabilityTimer.ts`, `BonusEngine` (chemin optimal reward), `Strings.nudges`, `trankilV2Db.pickAvailabilityTask` — détail §1–§5 du registre.

### 4.3 Table `offline_audio_queue` et bootstrap DB

SPEC (2.c.2) : schéma nécessaire au démarrage, incluant `offline_audio_queue`.

État actuel :

- `initTrankilV2Schema()` crée `offline_audio_queue` et ses index au bootstrap.
- `offlineAudioQueue.ts` n’exécute plus de DDL « à la volée » (`ensureOfflineAudioQueueTable` supprimé).

### 4.4 Cinématique peek capture (Path A / Path B / full 95 %)

SPEC : après dictée, peek relatif au viewport, transition à la persistance Pass 1, auto-close contrôlé.

État actuel :

- `TimelineScreen` / `TalkDebugScreen` : sur `INTENTION_PEEK_SNAPSHOT`, row `peek_pending` + ouverture peek **Path A** (`capturePeekPathAHeightPx`, ratio **~5 %** viewport via `CAPTURE_PEEK_PATH_A_RATIO`) — **y compris** quand la suite du pipeline est la **file offline** (pas de `INTENTION_PEEK_FIRST_SAVE` dans ce cycle jusqu’au rejeu en ligne). **Gating focus** : `useIsFocused()` — si l’onglet n’a pas le focus, l’événement est ignoré (`logCaptureFlow` : `ui_peek_snapshot_skip_unfocused` / `ui_peek_first_save_skip_unfocused`) ; seul l’écran focalisé émet `ui_peek_snapshot` / `ui_peek_first_save`. Au blur d’un onglet qui portait encore un peek capture actif (`path_a` | `path_b` | `peek_pending`), fermeture locale (`ui_peek_capture_dismissed_unfocused_tab`) pour éviter une `Modal` résiduelle.
- Sur `INTENTION_PEEK_FIRST_SAVE`, hydration + peek **Path B** (`capturePeekPathBHeightPx`, ~25 %) **sans** fermer/réouvrir la sheet sur le même onglet (spring `peekTranslateY` uniquement).
- `IntentionDetailSheet` : entrée complète (opacity + translate) **uniquement** à `visible` false→true ; passage Path A→B = **spring** sur `peekTranslateY` sans ré-entrée (évite flash) ; props `peekCapturePhase`, `captureSheetMaxHeightRatio` (0.95 en flux capture), validation UI **Path B** ; hauteurs peek = ratios viewport (`capturePeekPathAHeightPx` / `capturePeekPathBHeightPx`, sans plancher px) ; full sheet = `windowHeight × ratio` (0,86 / 0,92 si source étendue, ou 0,95 capture), sans plancher 240 px ; auto-fermeture 4 s en Path B ; timer annulé par pan / full / focus `TextInput` ; slot 1 neumorphique + pastel par `category_id`.
- **Verrou Pass 2** : `pass2_unlocked` (**`1`** = CTA consommé). **`metadataJsonLive`** alimente `meta` pour `showPass2FooterCta` (footer + Path B). CTA masqué si `isPass2UnlockedMeta(meta)` ; types **TRIP | LIST | PROJECT** ; TRIP → **`intentionDetail.actionSetupAlert`** ; LIST/PROJECT → **`pass2.*`**. **`TalkDebugScreen`** : `patchPeekDetailRow` via `onPatchRow`. **PRO** : overlay + hydratation locale ; réouverture → vue détaillée sans CTA. **FREE** : 🔒 + `ProSubscription`. **Trajet** : `gateFullTripBypass` ; CTA si `!== 1`.
- **Path B — bouton principal (Talk)** : TRIP → `actionSetupAlert` ; LIST/PROJECT → `pass2.generateList` / `pass2.generateSteps` ; masqué après génération ; log **`[ACTION-ADVISOR]`**.
- **TRIP — Contrat de Départ & guidage** : capsule fenêtre ancrée sous les adresses (sheet), refresh SQLite des metadata silencieuses Sentinel ; **All Day** → mode passif (`allDayNoDepartureSlot`, switch remind disabled/OFF) ; `suspendTripMissionForAllDay` / `wakeTripMissionAfterTimedRestore`.
- **TRIP — notifications Contrat de Départ** : [`NotificationService.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/NotificationService.ts) — mise à jour unique sticky (capsule Unicode, sans son pendant probes) ; Signal A à `elastic_anchor_start_ms` (time-sensitive + son) ; Signal B optionnel (`departure_safety_reminder_offset_min`, défaut 5 min) ; `clearAllDepartureNotifications` sur navigation GPS / arrivée / annulation mission. SPEC §9 + [`dossier_de_soumission.md`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/dossier_de_soumission.md).
- **TRIP — carte Timeline** : capsule compacte PRO si surveillance active + fenêtre élastique ; orbe graphite GPS si en retard ; badges/CTA setup conservés sinon.
- **TRIP — transport** : 3 icônes sheet ; legacy `transit`→`auto` ; plus de switch Newton.
- **Gating monétisation Pass 2 (SPEC §6)** — `useUserSpectrum().spectrum.isProUser` dans `IntentionDetailSheet` : FREE sans écriture `pass2_unlocked: 1` ; PRO persiste `1` + enrichissement optionnel LIST/PROJECT.
- Utilitaire : `src/utils/capturePeekLayout.ts`.
- **Overlay progression Talk** : [`useCapturePipelineOverlay.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useCapturePipelineOverlay.ts) + [`useAIProgressInertia.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useAIProgressInertia.ts) + [`AIUniversalProgressOverlay.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/AIUniversalProgressOverlay.tsx) (exporte **`CaptureTranscriptEditor`** pour le micro), montés par [`GlobalCaptureOverlay.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/GlobalCaptureOverlay.tsx) ; phase micro **`pipeline_wait`** + ref **`exitPipelineWaitToIdle`** dans [`TalkCaptureMicButton.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TalkCaptureMicButton.tsx). Peek Path B différé : events **`CAPTURE_DEFERRED_PEEK_FIRST_SAVE_FLUSH`** / **`CAPTURE_PIPELINE_SPRINT_COMPLETE`**. L’édition STT + barre validation clavier a lieu **avant** l’overlay Pass 1 (`recording`). [`TalkPipelineProgressDashboard.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TalkPipelineProgressDashboard.tsx) reste dans le dépôt mais **n’est plus** monté.
- **DealerBoard — « Matérialisation » (Talk)** : [`DealerBoard.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/DealerBoard.tsx) monté uniquement sous `TalkDebugScreen` ; **proxies visuels** (pas d’écriture SQLite — persistance inchangée via `IntentionContext`). Cartes **sélectionnables** (`selectedIntentionIndex` / `onSelectIntentionIndex`) pour piloter la fiche peek / full. **`INTENTION_PEEK_SNAPSHOT`** inclut désormais **`transcript`** (emit `IntentionContext`) : mot-clé fantôme = **dernier mot** du transcript brut (regex `(\S+)\s*$`) avec repli sur le titre Path A. **`INTENTION_PEEK_FIRST_SAVE`** → remplacement / ballet (`LayoutAnimation` + springs Reanimated) selon le nombre d’intentions ; payload **`dealerBulkItems`** construit dans `IntentionContext` sur bulk ventilé ; géométrie 2/3/4 cartes et + dans [`dealerBalletLayout.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/dealerBalletLayout.ts) ; cartes **portrait** (~100×140 via `dealerPortraitMetrics`) ; matérialisation via [`DealerMaterializeCard.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/DealerMaterializeCard.tsx) + [`dealerMaterialTheme.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/dealerMaterialTheme.ts). **`MICRO_CAPTURE_START`** (`intentionEvents.ts`, émis par `TalkCaptureMicButton`) : coupe le timer idle et aspire vers le badge NEW ; haptique à l’impact ; timer idle aspiration **30 s** ; archivage **local** du proxy à l’aspiration.

### 4.5 Offline-first : traitement ultérieur encore “semi-manuel”

Le contrat “mise en file offline pour traitement ultérieur” est présent, avec **consolidation récente** :

- **Drain replay** : `markOfflineAudioAsDone` n’est plus appelé avant un `submitCapturePayload` réussi (`Promise<boolean>`), ce qui évite de supprimer l’audio de file si le rejeu échoue.
- **Auto-queue réseau** : erreurs réseau/serveur pendant le bulk en ligne enfilent le contenu sans imposer une Alert (logs `[OFFLINE-STABILITY]`).
- Le rejouage reste surtout déclenché par **NetInfo** / notification / action utilisateur (`analyzeLatestOfflineAudio()`), pas par un scheduler/worker dédié.
- `CaptureProcessingService` (BackgroundFetch) traite une autre queue (AsyncStorage) et appelle seulement `analyzeLocally` (pas de ré-injection systématique OneTap/Gemini + persistance).

Si l’objectif produit est “zéro friction offline”, il peut encore manquer un **replay automatique** plus agressif (avec garde-fous anti-doublon et backoff).

### 4.6 Instrumentation Pass 1 / Pass 2 (logs)

État actuel :

- **[`logAiInteraction`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/logAiInteraction.ts)** (`__DEV__`) : blocs `[🤖 AI PASS 1 - EXTRACTION]` / `[🧠 AI PASS 2 - REASONING]` ou `[❌ … FAILED]` avec modèle, latence, config (`JSON Mode`, temp, tokens), prompt, **`RAW RESPONSE` même en échec** (avant `ERROR` — diagnostic parse JSON).
- Enrichissement Pass 2 **uniquement** depuis `IntentionDetailSheet` (flux manuel PRO) ; logs dev `[Pass2] ✅ … enrich …ms` après succès ; `[GEMINI-RC] Pass2 steering` avant `lab.list_enrich_generic`.
- Plus d’enrichissement silencieux depuis `oneTapPersist` après insert LIST/PROJECT.

---

## Annexes (repères pratiques)

### Registre code mort — [`nettoyage-code-mort.md`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/nettoyage-code-mort.md)

Fichier **hors SPEC** : journal de travail pour la **suppression progressive** du code inutilisé, sans perdre le contexte pour un debug ou une réactivation temporaire.

| Rôle | Contenu |
|------|---------|
| **Pourquoi** | Pas encore d’utilisateurs finaux → on **démonte** les features (UI + timers) mais on **garde** l’implémentation en commentaires / stubs pour comparer ou réactiver pendant les tests. |
| **Quoi** | Liste des fichiers concernés, statut (RETIRÉ / COMMENTÉ / À SUPPRIMER), clés AsyncStorage orphelines, commandes `rg` + `tsc`, renvois vers d’autres candidats morts (audit notifications, legacy Sentinel, etc.). |
| **Quand l’ouvrir** | Avant un gros nettoyage git ; après avoir retiré une modale, un timer ou un export API ; pour savoir quoi supprimer définitivement une fois la validation terminée. |
| **Maintenance** | Ajouter une section numérotée par feature retirée ; cocher la checklist §7 du registre quand les symboles sont supprimés du dépôt. |

**Entrées actuelles (mai 2026) :** nudge disponibilité §1–§5 ; pointeurs vers audit notifications (§6) non traités dans ce passage.

### Fichiers à relire en priorité quand tu reprends le dev

1. `src/context/IntentionContext.tsx` (orchestration + verrous + offline + booléen drain)
2. `src/services/oneTapUniversalCapture.ts` (contrats prompt/parsing)
3. `src/services/oneTapPersist.ts` (mapping DB + Pass 2 + NOTE_FALLBACK)
4. `src/api/trankilV2Db.ts` (schéma, patchMetadata, sérialisation)
5. `src/services/intention/offlineAudioQueue.ts` (offline queue réelle en SQLite)
6. `src/utils/offlineStability.ts` (heuristique réseau/serveur + logs `[OFFLINE-STABILITY]`)
7. `src/utils/captureFlowLog.ts` (`logCaptureFlow` / `notifyCapturePipelineProgress`, corrélation `traceId` → Talk)
8. `src/hooks/useAIProgressInertia.ts` (lissage 0–100 % : inertie P1/P2, phase 3, bumps `CAPTURE_PIPELINE`, sprint final)
9. `src/components/AIUniversalProgressOverlay.tsx` (overlay plein écran Pass 1 Talk / Pass 3 synthèse)
10. `src/components/dailyRoadmap/*` (sas Pass 3, modal WebView / PDF)
11. `src/services/dailyRoadmapPass3.ts` (payload + instruction Pass 3)
12. `src/utils/elasticSlotEngine.ts` + `src/services/traffic/trafficSchedulerElasticTick.ts` (TRIP Contrat de Départ)
13. `src/services/traffic/sentinelTripMission.ts` (cancel / reset mission)
14. `src/services/NotificationService.ts` + `src/utils/formatDepartureCapsule.ts` + `dossier_de_soumission.md` (notifications Contrat de Départ)
15. [`nettoyage-code-mort.md`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/nettoyage-code-mort.md) (registre code mort / retraits feature)
16. `src/theme/TalkThemeRegistry.ts` + `src/hooks/useDesignTokens.ts` (variantes visuelles / rollback `CURRENT`)

