# PROJECT_STATUS — Dev-trankil-v34 (TalknDone)

> Objectif de ce document : reconstruire la “mémoire” du projet après migration, en cartographiant **/src** et en recollant au contrat **SPEC.md** (one‑tap capture + offline‑first + SQLite Trankil‑v2).

## TL;DR

- Stack : **Expo / React Native**, React Navigation, React Context, **SQLite (expo-sqlite)** comme source de vérité locale (`talkndone.db`).
- Cœur produit : pipeline **OneTap Dual‑Path** (Path A heuristiques locales → Path B Gemini via proxy) puis **Douane** (parsing/normalisation) et **persistance**.
- Offline-first (**urbanisation SPEC v34 : 100 % terminée**) : en cas d’échec réseau/IA, la capture (texte/audio) est **mise en file** via `offline_audio_queue` + insertion d’une NOTE `is_pending_ai=1` (métadonnées `persistence_label` / `tag` = `NOTE_FALLBACK` + `source: offline_audio_queue`), puis rejouée ultérieurement. **NetInfo** : « en ligne » si `isConnected === true` **et** `isInternetReachable !== false` (`isNetInfoConsideredOnline`) ; log `[OFFLINE-STABILITY] netinfo_online_null_reachable` si tentative en ligne avec reachability `null`. **En ligne**, une coupure **pendant** Path B / persistance d’un chunk peut déclencher un **enqueue auto** (heuristique réseau/serveur, logs `[OFFLINE-STABILITY]`) sans Alert obligatoire. **Parité peek** : `INTENTION_PEEK_SNAPSHOT` (Path A) est émis **avant** `NetInfo` et la file, pour le même feedback visuel hors ligne qu’en ligne.
- **Feuille de Route (Pass 3)** : depuis la Timeline, icône imprimante → sas SQL (retards + orphelines) → synthèse Gemini HTML (RC `prompt_pass3_synth_v1`) → `daily_summaries` + WebView / PDF ; overlay progression réutilise `useAIProgressInertia` + `AIUniversalProgressOverlay` ; lien sous le groupe « Aujourd’hui ».
- **Smart Clusters (Timeline, mai–juin 2026)** : carrousel **Inbox · À acheter · Box · Routines · Projets** ([`SmartClustersCarousel`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/SmartClustersCarousel.tsx)) — **Inbox** = journal 24h (toutes captures TODO du jour, datées ou non) ; **Box** = inventaire froid (`created_at` &lt; aujourd’hui, sans `due_date`, hors SHOP, HABIT) + purge globale ; **Routines** = bibliothèque HABIT par catégorie + badges série 🔥/❄️, sans purge globale. **Legacy** : [`getBestOrphanCluster`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/clusterEngine.ts) non branché. **Projets orphelins** (IdeaBank) : `cluster.planProjectStart` → `project.start_date` + replan jalons. Détail : **SPEC.md § 2.a bis–2.b**.
- **Chronologie narrative + Rappel / Pin (juin 2026)** : mode `EMAIL_HUB` (**Chronologie narrative**) — segments **Matin · Après-midi · Soir** + bloc **Rappel** (bas de page) = seul foyer des intentions `is_pinned` et des échéances « Avant le » ; auto-épingle à la capture ([`oneTapPersist`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapPersist.ts)) ; routage partagé [`narrativePinRules.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/narrativePinRules.ts) ; badge **J-X** pour les datées ; **Espace Sacré** Cockpit synchronisé avec le bloc Rappel Timeline. Détail : **SPEC.md § 2.c**.
- **TRIP — Contrat de Départ (mai 2026)** : **marge adaptative** `Deadline = T_arr − (T_pred × D)` ; `T_ideal` statique API ou distance/50 km/h ; relax fixe 15 min ; ancres `min()` ; hystérésis 5 min ; PROBE3 skip ; `departure_time ≥ now+2min` ; dispatcher PROBE1/2/3 ([`elasticSlotEngine.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/elasticSlotEngine.ts), [`trafficSchedulerElasticTick.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/trafficSchedulerElasticTick.ts)) ; zéro polling ; UI **ElasticDepartureCapsule** sheet + Timeline compacte ; **notifications locales** [`NotificationService.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/NotificationService.ts) (sticky silencieuse + Signal A sonore time-sensitive + Signal B rappel sans son) ; [`dossier_de_soumission.md`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/dossier_de_soumission.md) ; [`sentinelTripMission.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/sentinelTripMission.ts).
- **TRIP — Validateur de Promesse (mai 2026)** : **Phase 1** — promesse P1 figée (`promise_departure_time_unix`, `promise_duration_min`, `promise_validated_at` dans `metadata_json.trip`) ; **Phase 2** — PROBE2 **prédictif** (même `departure_time` que P1), comparaison `|T_p2 − promise_duration_min|`, **Ghost Update** si `≤ 5 min` (pas d’UI / sticky / `stateVersion`), notif douce `promiseDrift*` si dérive ; PROBE3 **live** inchangé ; logs `[PROBE2_PREDICTIVE]`, `[PROMISE_VALIDATED]`. Détail : **SPEC.md § Validateur de Promesse**.
- **TRIP — Trio Zéro Gaspillage Mapbox (juin 2026)** : saisie adresse **local-first** — SQLite `local_places` (`LIKE`, `last_used_at`, seed `location_favorites`) **avant** tout appel distant ; seuil **12 car.** ; auto Mapbox `/suggest` si local vide ; loupe = **insister** (fusion local + distant) ; sélection Mapbox → `/retrieve` + upsert cache ; session token UUID au montage (renouvelé après 5 min vide) ; erreurs réseau `addressSearchUnavailable` ; provider [`mapConfig.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/config/mapConfig.ts) `MAP_PROVIDER=mapbox` ([`usePlaceSearch`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/usePlaceSearch.ts), [`mapSearchService`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/mapSearchService.ts), [`localPlaces`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/localPlaces.ts)) ; Google conservé derrière `MAP_PROVIDER=google`. Cache Distance Matrix inchangé. Détail : **SPEC.md § 8.a**.
- **Tirelire TRIP — Itinéraire augmenté (mai 2026)** : cartes avec bloc départ/arrivée ([`IdeaBankTripItineraryBlock`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IdeaBankTripItineraryBlock.tsx)) ; **rideau de recherche inline** (départ + arrivée, sans fermer la modale) ; pilule hybride armement Sentinel inline ([`tripSurveillanceToggle.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/tripSurveillanceToggle.ts)) ; persistance [`persistTripArrivalAddress`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/persistTripArrivalAddress.ts) / `persistTripOriginAddress`. Détail : **SPEC.md § 2.d.3**.
- **Rappel universel — alarme + notification (juin 2026)** : [`useIntentAlarm`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useIntentAlarm.ts) + [`intentAlarmTemporal.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/intentAlarmTemporal.ts) — **action** dans [`IntentionDetailSheet`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionDetailSheet.tsx) (bouton « Planifier une alarme », toute intention avec date d'échéance) → [`scheduleOneTapUniversalReminders`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapUniversalReminders.ts) + [`AlarmService.openAlarmSelection`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/alarmService.ts) + `metadata_json.is_alarm_set` + toast ; **témoin** cloche sur [`IntentionCard`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionCard.tsx) (non cliquable) ; expiration UI **+15 min** après l’heure effective ; i18n `intentAlarm.*`. Détail : **SPEC.md § 2.c ter**.
- **TRIP — Heure rappel départ (mai 2026)** : `resolveElasticDepartureAlarmUnixSec` (−20 % `endMs`) consommée par `useIntentAlarm` pour les trajets avec capsule ; i18n legacy `tripAlarm.*` ; queries [`app.json`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/app.json).
- **TRIP — Sentinel Focus Badge (juin 2026)** : [`SentinelFocusBadge`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/SentinelFocusBadge.tsx) — bulle Talk 105 dp (`#F2F2F7`, en-tête 💬 TalkNDone) sous « Aujourd’hui » (**EMAIL_HUB**) et **TalkDebug** ; **séquenceur glissant** [`pickSentinelFocus`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/sentinelFocusSelection.ts) (tri chronologique arrivée → Priorité 1 micro non expiré → Priorité 2 cascade suggestion : passé / configuré éliminés) ; slot 117 dp ou 0 (`isSentinelFocusSlotVisible`) ; i18n `sentinelFocus.promptLine1` / `promptLine2`. Détail : **SPEC.md § 8.c**.
- **Living Hub — bloc TRAJETS unifié (juin 2026)** : court-circuit UI [`resolveHubBlockCategoryId`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/hubCategoryRegistry.ts) — tous les TRIP → `TRIPS_HUB` (🏁), pas le `category_id` Pass 1 (LEARN/SHOP/…). Détail : **SPEC.md § 2.c bis** (modales Box / Routines).
- **Pass 1 — Few-Shot JSON universel (mai 2026)** : `buildOneTapPass1SystemInstruction(now)` + `buildOneTapPass1UserContent(..., now)` — SI proxy (règles LIST/TASK différenciées + **6** few-shots multilingues FR/EN/ES) + user (`NOW` / `TZ` / `SEED` / `INPUT`) ; `maxOutputTokens: 2048` ; modèle RC **`gemini_pass1_model_id`**. **Correctif PROJECT (mai 2026)** : `parseJsonIntentsFromBuffer` accepte désormais `type=PROJECT` avec `content` (ex. « Rénover la cuisine ») — avant, la réponse Gemini valide était ignorée → `Pass1 parse failed` → `NOTE_FALLBACK` Inbox au lieu du cluster Projets. Détail complet : **SPEC.md § 2**.
- **Pass 2 LIST/PROJECT (mai 2026)** : `geminiEnrichGenericList` — prompt inline `PASS2_*_INLINE_PROMPT` + `Transcription:` · **sans** `systemInstruction` · `temperature: 0.18` · `maxOutputTokens: 2048` · modèle RC **`gemini-pro-latest`** (défaut compilé) · chaîne fallback proxy `[override, …shortlist]`. Unités naturelles préservées (`sachets`, `pincées`, `g`…) ; `unités` → affichage quantité seule. Détail : **SPEC.md § Prompt Pass 2**.
- **Pass 3 / Expert** : même steering `gemini_pass2_model_id` ; warmup proxy cible **Pass 1** uniquement ; RC `[GEMINI-RC]` (mobile : défauts compilés, fetch réseau ignoré — Option A) ; re-fetch avant Pass 2 si source ≠ `remote` (**web**).
- **Thèmes dynamiques (mai 2026)** : **TalkThemeRegistry** + showroom AsyncStorage (`@trankil_debug_theme_variant`) — 6 variantes interchangeables à la volée depuis **Debug** (🎨 EXPLORATION GRAPHIQUE) ; **Disposition Timeline** (`@trankil_debug_timeline_layout`, hub email par `category_id`) ; **Box / Routines** (carrousel Smart Clusters) ; `useDesignTokens()` réactif ; rollback = **Actuel (TellYouTo)** / **Cartes actuelles**. Tokens **`pressedOpacity` / `pressedScale`** (0,7 / 0,97). Détail : **SPEC.md § Architecture UI — 0)** et **§ 2.b–2.d**.
- **Typographie Zen (juin 2026)** : échelle **`ZEN_TYPOGRAPHY`** exposée par `useDesignTokens().typography` (`caption` 11 → `hero` 24 px) ; remplace les `fontSize` littéraux par token. **Migrés** : `OneTapConfirmModal`, `IntentionDetailSheet`, `TimelineScreen`, `DebugScreen`. **Backlog** : ~29 fichiers `src/` encore en px bruts (carrousel, modales Pass 3, `SentinelFocusBadge`, etc.). Détail : **SPEC.md § 0) — Échelle typographique Zen**.
- **Micro-interactions T=0 (mai 2026)** : harmonisation Talk · Timeline · IdeaBank — [`PressableScale`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/common/PressableScale.tsx) + [`haptics.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/haptics.ts) ; phase **`preparing`** micro ; overlay optimiste **T=0** au Send (TalkDebug) ; haptique Success synchronisée au **paint** overlay (double `rAF`) ; verrou **`isSubmitting`** toolbar ; **`busyRows`** IdeaBank (SQLite) ; reload Timeline **`LayoutAnimation` 300 ms** ; feedback pressed sur cartes, carrousel clusters, hub Living. Détail : **SPEC.md § Chronologie UX capture** et **§ 2.d.2**.
- **TalkNDone-Vault — backup SQLite (juin 2026)** : export / import de **`talkndone.db`** via partage natif (**`expo-sharing`** + **`expo-document-picker`**) — carte Debug section **[SYSTÈME]** ; copie à froid (`closeTrankilV2DatabaseForVault` → `copyAsync` → `shareAsync` → `reopenTrankilV2DatabaseAfterVault`) ; import avec confirmation, remplacement fichier, purge `-wal`/`-shm`, `reloadApplication()`. **Sans** OAuth Google Drive. Helpers dans [`trankilV2Db.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/api/trankilV2Db.ts). Détail : **SPEC.md § TalkNDone-Vault — backup SQLite**.
- **Share Sheet → One-Tap + Vault images (juin 2026)** : réception d’images (captures d’écran) via **`expo-share-intent`** — [`ShareIntentProvider`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/App.tsx) + [`ShareIntentBootstrap`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/ShareIntentBootstrap.tsx) (dans [`CapturePresentationProvider`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/context/CapturePresentationContext.tsx) — **ballet overlay** dès réception) ; compression + stockage **`TalknDone-Vault/{intentionId}.jpg`** ([`fileStorage.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/fileStorage.ts), JPEG 70 %, max 1200 px) ; Vision Gemini [`geminiAnalyzeImageBase64`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts) → transcript → `submitCapturePayload({ preassignedIntentionId })` → SQLite (`talkndone.db`). **Consultation** : icône `image-outline` sur [`IntentionCard`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionCard.tsx) → [`VaultImageViewerModal`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/VaultImageViewerModal.tsx). **Mode local** : pas de sync Firebase Storage (`syncVaultImageToCloudIfEnabled` / `uploadToCloudIfEnabled` stubs) ; log `[ShareService] Image reçue, envoi vers Gemini en mode LOCAL`. Cold-start : [`linking.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/navigation/linking.ts) (`getInitialURL` / `subscribe`). **Dev client requis** (pas Expo Go). Détail : **SPEC.md § Share Sheet système**.
- Alignement SPEC : le flux “**Micro as Bulk(1)**” est **unifié** : micro/texte unitaire passent par le **séquenceur bulk** avec persistance **ventilée** (une seule “source de vérité”), et un `traceId` est propagé pour des logs cohérents. **Calque global capture (mai 2026)** : [`GlobalCaptureOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/GlobalCaptureOverlay.tsx) monte **une fois** le micro + l’overlay pipeline ([`useCapturePipelineOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useCapturePipelineOverlay.ts) + [`useAIProgressInertia`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useAIProgressInertia.ts) + [`AIUniversalProgressOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/AIUniversalProgressOverlay.tsx)) au-dessus de toute la navigation ; présentation par écran via [`CapturePresentationContext`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/context/CapturePresentationContext.tsx). **Position overlay (mai 2026)** : micro **absolu** (`GlobalCaptureOverlay`), `bottom` via [`resolveGlobalCaptureOverlayBottom`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/constants/captureOverlayLayout.ts) (`TAB_BAR_CORE_HEIGHT` + safe area + `CAPTURE_OVERLAY_TAB_GAP` = **8 px**) — flotte au-dessus de la tab bar (overlay monté **hors** `NavigationContainer`). En capture Talk : toolbar ancrée en bas du dock (transcript + `maxHeight` au-dessus). **Réglage fin device** : si le micro est encore un peu haut ou bas, ajuster `CAPTURE_OVERLAY_TAB_GAP` dans `captureOverlayLayout.ts` (ex. **8 → 12 px**). Sur **TalkDebug** (`dashboardPipelineHost`), l’overlay couvre l’attente Pass 1 (micro « échap » sans annuler le pipeline). **Audit post-centralisation (mai 2026)** : `TalkDebugScreen` / `TimelineScreen` **sans** micro ni overlay capture locaux ; peek Path B différé via **`CAPTURE_DEFERRED_PEEK_FIRST_SAVE_FLUSH`** ; reset **DealerBoard** via `registerOverlayLifecycleHandlers({ onPipelineSprintComplete })` (plus de bus `CAPTURE_PIPELINE_SPRINT_COMPLETE`). **Correction STT optionnelle** : crayon → barre validation **Poubelle / Check** au-dessus du clavier (`translateY` + listeners clavier) → `transcript` final vers Gemini ; logs `transcript_manual_edit` / `[MIC] ✏️`.

---

## 1) Architecture globale

### 1.1 Entrypoints & bootstrap

- `index.ts` : charge i18n (`./src/locales/i18n`) puis enregistre `App`.
- `App.tsx` :
  - bootstrap services (une fois par session JS, garde module `appServicesBootstrapDone` — évite le spam Fast Refresh) : `initializeGeminiEngine()` (steering RC Gemini), `configureCaptureBackgroundTask()`, `requestBackgroundExecutionPermissions()`
  - **Permissions Android batterie** : `requestIgnoreBatteryOptimizationAndroid()` mémorise `@trankil_battery_permission_requested` (AsyncStorage) — la modale système n’est sollicitée qu’une fois ; reset via **Debug** → section Système
  - **Foreground RC** : `AppState` → `scheduleGeminiForegroundRemoteConfigRefresh()` (refresh silencieux modèle Gemini)
  - bootstrap DB : `bootstrapTrankilV2Database()` (avec fallback timer 1.2s pour ne pas bloquer l’UI)
  - **`ShareIntentProvider`** (`expo-share-intent`, désactivé sous Expo Go / web) enveloppe l’arbre UI après `dbReady`
  - injecte des Providers (ordre important car ils fournissent thème, i18n, profil, etc.)
  - monte `NavigationContainer` (avec deep linking + `rootNavigationRef` + handlers share intent cold-start).
  - **`IntentionProvider` → `CapturePresentationProvider` → `ShareIntentBootstrap` + `AppNavigation` + `GlobalCaptureOverlay`** (micro + overlay pipeline persistants au-dessus des tabs/stack ; Share Intent accède au ballet overlay).

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
- `CapturePresentationContext` : config micro global par écran focalisé (`variant`, `dashboardPipelineHost`, `compact`, `micHidden`, `disabled`) + état partagé overlay (`isPipelineOverlayVisible`, `captureRecordingActive`) + hooks lifecycle (`onPipelineSprintComplete`, etc.) + **orchestration** (`micRef`, quota lock, callbacks pipeline — consommés par `GlobalCaptureOverlay` et partagés si besoin).

### 1.4 Thème & design tokens (`src/theme/`)

Architecture **Thèmes Découplés** — permet de tester 5 directions visuelles sans toucher à la logique métier.

| Fichier | Rôle |
|---------|------|
| [`TalkThemeRegistry.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/theme/TalkThemeRegistry.ts) | Palettes par variante, `getDesignTokens`, AsyncStorage `readPersistedDesignVariant` / `persistDesignVariant` |
| [`DebugScreen.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/DebugScreen.tsx) | Showroom **🎨 EXPLORATION GRAPHIQUE** — 6 variantes + **Disposition Timeline** ; **TalkNDone-Vault** export/import `talkndone.db` (`expo-sharing` / `expo-document-picker`) |
| [`colors.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/theme/colors.ts) | Palette TellYouTo (Teal `#008080`, Orange `#FF8C00`, Off-white `#F5F5F0`) |
| [`paperTheme.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/theme/paperTheme.ts) | `createTellYouToLightTheme` / `createTellYouToDarkTheme` (MD3) |
| [`neumorphism.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/theme/neumorphism.ts) | `neumorphicRaised` / `neumorphicInset` — composants **non encore migrés** |
| [`index.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/theme/index.ts) | Ré-exports publics |
| [`useDesignTokens.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useDesignTokens.ts) | Hook : `useDesignTokens()` → `DesignTokens` + **`typography`** (`ZEN_TYPOGRAPHY`) selon variante + schéma clair/sombre |

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
- `pressedOpacity` (0,7), `pressedScale` (0,97) — feedback tactile uniforme
- `shadowStyle` (relief raised), `cardShadowStyle` (relief inset)
- **`typography`** — échelle Zen (`caption` 11, `label` 12, `bodySmall` 13, `body` 14, `bodyLarge` 15, `title` 16, `headline` 18, `hero` 24) ; **identique clair/sombre** ; remplace les `fontSize` px bruts lors de la migration progressive

**Échelle typographique — fichiers migrés (juin 2026)** :

| Fichier | Notes |
|---------|-------|
| [`OneTapConfirmModal.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/OneTapConfirmModal.tsx) | 50 styles via `createOneTapConfirmStyles(typography)` |
| [`IntentionDetailSheet.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionDetailSheet.tsx) | Sheet + styles inline checklist / streak |
| [`TimelineScreen.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TimelineScreen.tsx) | En-têtes, badges compacts (`caption`), titres (`hero`) |
| [`DebugScreen.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/DebugScreen.tsx) | Moniteurs monospace → `caption` ; titres → `hero` |

**Pattern migration** :

```typescript
const { typography, ...designTokens } = useDesignTokens();
const styles = useMemo(() => createMyStyles(typography), [typography]);
// fontSize: typography.bodySmall  (ex. ancien 13)
```

**Intégration ThemeContext** : si variante ≠ `CURRENT`, `ThemeContext` fusionne les tokens dans `paperTheme.colors` (`primary`, `background`, `surface`, `onSurface`, etc.) — les composants Paper héritent du nouveau look sans migration.

**Composants déjà migrés** (mai 2026) :

- [`PressableScale.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/common/PressableScale.tsx) — wrapper T=0 (opacity/scale + haptique configurable).
- [`TimelineScreen.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TimelineScreen.tsx) — fond racine ; liens roadmap / CTA jour vide ; `reload()` animé 300 ms ; **`typography`** (juin 2026).
- [`TalkDebugScreen.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TalkDebugScreen.tsx) — fond + Phoenix + bouton Envoyer (micro **global**, plus local).
- [`DebugScreen.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/DebugScreen.tsx) — fond, titres, panneau showroom ; **`typography`** (juin 2026).
- [`GlobalCaptureOverlay.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/GlobalCaptureOverlay.tsx) — micro unique (overlay absolu, `bottom` via `captureOverlayLayout`) + overlay pipeline + quota lock.
- [`TalkCaptureMicButton.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TalkCaptureMicButton.tsx) — STT / enregistrement ; phase **`preparing`** ; overlay T=0 ; toolbar verrouillée `isSubmitting`.
- [`IntentionCard.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionCard.tsx) — cartes Timeline + feedback pressed corps carte.
- [`SmartClustersCarousel.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/SmartClustersCarousel.tsx) — tuiles carrousel pressed tokens.
- [`LivingHubBlockShell.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/LivingHubBlockShell.tsx) — blocs hub EMAIL_HUB pressed tokens.
- [`IdeaBankModal.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IdeaBankModal.tsx) — Tirelire : orbe validation ; cartes TRIP enrichies + rideau recherche inline ; pilule TRIP hybride ; `onPatchItem` optimiste ; cinématique Éditer 320 ms ; **`onEditItem`** → `IntentionDetailSheet`.
- [`IntentionDetailSheet.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionDetailSheet.tsx) — sheet + CTA principaux ; **`typography`** (juin 2026).
- [`OneTapConfirmModal.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/OneTapConfirmModal.tsx) — modal confirmation OneTap ; **`typography`** (juin 2026).

**Migration progressive recommandée** pour les autres composants (~29 fichiers encore en `fontSize` px bruts — voir [`nettoyage-code-mort.md`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/nettoyage-code-mort.md) §17) :

```typescript
import { useDesignTokens } from '../hooks/useDesignTokens';

const { typography, ...designTokens } = useDesignTokens();
const styles = useMemo(() => createMyStyles(typography), [typography]);
// style={{ backgroundColor: designTokens.backgroundColor, fontSize: typography.body }}
// style={[designTokens.shadowStyle, styles.carte]}
```

Contrat SPEC complet : **SPEC.md § Architecture UI — 0) Architecture de Thèmes Découplés**.

### 1.5 Services (domain)

Repères dans `src/services/*` :

#### OneTap / Capture (cœur)

- `oneTapUniversalCapture.ts` : Path A (heuristique) + Path B (Gemini) + parsing & fusion (douane “avant DB”).
- `oneTapPersist.ts` : Douane “DB” (mapping type → schéma Trankil‑v2) + Pass 2 LIST/PROJECT + NOTE_FALLBACK.
- [`GlobalCaptureOverlay.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/GlobalCaptureOverlay.tsx) + [`useCapturePipelineOverlay.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useCapturePipelineOverlay.ts) + [`CapturePresentationContext.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/context/CapturePresentationContext.tsx) + [`captureOverlayLayout.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/constants/captureOverlayLayout.ts) : calque micro + overlay Pass 1 au-dessus de la navigation ; constantes `TAB_BAR_CORE_HEIGHT`, `CAPTURE_OVERLAY_TAB_GAP`, `TALK_DEBUG_MIC_DOCK_MIN_HEIGHT`, `resolveGlobalCaptureOverlayBottom`.
- `services/captureStrategies/*` : stratégies “classiques” (task/habit/note/list/project) — utilisées ailleurs (ex. Timeline) ; **TalkDebug** ne déclenche plus le flux projet offline-first / deadline (`generateProjectPlanFromDeadline`) supprimé de l’écran au profit du pipeline OneTap unifié.
- `CaptureProcessingService.ts` : BackgroundFetch/TaskManager + queue AsyncStorage (jobs “analyse locale”).
- `services/intention/offlineAudioQueue.ts` : file offline texte/audio **en SQLite**, notifications, purge.
- `WhisperAdapter.ts` : transcription locale “best effort” via `whisper.rn` (si module dispo).

#### Données & persistance

- `api/trankilV2Db.ts` : **repository SQLite** (schema, writes sérialisées, queries Timeline, patchMetadata, quotas, Pass 3 cleanup `listIntentionsForPass3Cleanup`, `daily_summaries`, etc.).
- `api/localDb.ts` : petit KV local (table `app_prefs`), lui aussi sérialisé.

#### Mode Solo Local 100 % autonome (juin 2026)

| Fichier | Rôle |
|---------|------|
| [`appConfig.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/config/appConfig.ts) | `IS_LOCAL_MODE`, `LOCAL_GEMINI_API_KEY` |
| [`geminiDirectClient.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiDirectClient.ts) | `executeGeminiCall` — proxy Firebase **ou** Google AI Studio direct |
| [`ProfileSyncBootstrap.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/ProfileSyncBootstrap.tsx) | Sync Firestore désactivée si `IS_LOCAL_MODE` |
| [`UserSpectrumContext.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/context/UserSpectrumContext.tsx) | Skip push Firestore profil / entitlements |
| [`QuotaManager.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/QuotaManager.ts) | Quota Sentinel AsyncStorage seul |

Activation : `EXPO_PUBLIC_LOCAL_MODE=true` + `EXPO_PUBLIC_GEMINI_API_KEY`. Réactivation Firebase : [README.md](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/README.md).

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
| [`geminiDirectClient.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiDirectClient.ts) | Routeur HTTP Gemini (proxy ou direct selon `IS_LOCAL_MODE`) |
| [`geminiSemanticLab.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts) | Appels via `executeGeminiCall` (SSE) — types **TEXT**, **AUDIO** (`geminiTranscribeAudioBase64`), **IMAGE** (`geminiAnalyzeImageBase64`) ; verrou steering 2 s, retry candidats, exclusion session |
| [`fileStorage.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/fileStorage.ts) | **TalknDone-Vault** : `saveAndCompressImage`, `getImagePath`, `deleteImage` ; stub `syncVaultImageToCloudIfEnabled` |
| [`share/shareService.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/share/shareService.ts) | Intake Share Sheet : base64 depuis Vault, stub cloud |
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
| [`DistanceMatrixMapsService.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/DistanceMatrixMapsService.ts) | `fetchTrafficSample` ; cache **grid 3 décimales** + mémoire + **AsyncStorage** (TTL 15 min) ; logs `CACHE HIT (memory|storage)` / `NETWORK` |
| [`addressResolver.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/addressResolver.ts) | `resolveManual` (Geocoding) ; `resolveFromPlaceId` ; `fetchAutocompletePredictions` (loupe Lazy-Fetch) |
| [`useAddressLogic.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useAddressLogic.ts) | Lazy-Fetch : seuil **12 car.**, loupe volontaire, `isValidated`, liste à plat |
| [`AddressInput.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/traffic/AddressInput.tsx) | UI icônes ✕ / 🔍 / ✓ ; champ verrouillé post-validation |
| [`AddressInputField.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/traffic/AddressInputField.tsx) | Drop-in (`GooglePlacesAutocompleteField` re-export) |
| [`persistTripArrivalAddress.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/persistTripArrivalAddress.ts) | Persistance arrivée/départ depuis Tirelire (SQLite + favoris alias) |
| [`tripSurveillanceToggle.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/tripSurveillanceToggle.ts) | Armement/désarmement Sentinel partagé (sheet + pilule Tirelire) |
| [`alarmService.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/alarmService.ts) | Intent Horloge OS (`openAlarmSelection`) — Android/iOS |
| [`useIntentAlarm.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useIntentAlarm.ts) | Hook alarme universelle : `isAlarmSet`, `hasDueDate`, `onSetAlarm` ; notification + Horloge OS ; patch `is_alarm_set` |
| [`intentAlarmTemporal.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/intentAlarmTemporal.ts) | Heure effective, ISO échéance, unix alarme, fenêtre témoin +15 min, `hasIntentionSchedulableDueDate` |
| [`sentinelElasticTripMetadata.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/sentinelElasticTripMetadata.ts) | `buildContractTripPatch`, champs `elastic_anchor_*`, **promesse P1** (`promise_*`, `readTripPromiseReference`) |
| [`tripTripReadiness.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripTripReadiness.ts) | Blocages mission (`destination`, `arrival_time`) |
| [`tripProbeScheduleDisplay.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripProbeScheduleDisplay.ts) | Badge scan C1/C2 : `scanTrafficScheduled` / `scanTrafficInProgress` |
| [`useProbeScheduleClock.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useProbeScheduleClock.ts) | Tick 30 s pour bascule badge futur → en cours |
| [`tripSurveillanceButton.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripSurveillanceButton.ts) | États Big Button Sheet (`Surveiller le trajet` / active / locked) |
| [`sentinelDbRetry.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/sentinelDbRetry.ts) | Retry sync metadata SQLite + recovery kick |
| [`sentinelElasticProbes.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/sentinelElasticProbes.ts) | Planification sondes, `resolveTrafficDeltaMin`, retry échec API, **`PROBE1_RETRY_CEILING = 3`** → STATIC |
| [`trafficSchedulerElasticTick.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/trafficSchedulerElasticTick.ts) | Dispatcher PROBE1/2/3 ; **P2 prédictif + Ghost Update** ; `skipDepartureNotificationSync` |
| [`tripMathLogger.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripMathLogger.ts) | Logs `[TRIP-MATH]` avec `[Ratio_D]`, `[UI_UPDATE]`, `[PROBE3_SKIPPED]` |
| [`TrafficSchedulerV4.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/TrafficSchedulerV4.ts) | 1 `setTimeout`/TRIP ; sync sticky conditionnel ; `sendPromiseDriftSoftPush` |
| [`SentinelBackgroundService.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/SentinelBackgroundService.ts) | Filet OS : tick **si sonde due** (pas de polling global) |
| [`sentinelTripMission.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/sentinelTripMission.ts) | `cancelTripMission`, `clearTripElasticProbeMetadata`, **`suspendTripMissionForAllDay`** |
| [`sentinelReconciler.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/sentinelReconciler.ts) | Activation + reset + debounce 500 ms + mutex ; reconcile **onSelect only** |
| [`tripElasticDisplay.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripElasticDisplay.ts) | Affichage UI depuis `metadata_json.trip` ; **`isTripAllDay`** |
| [`ElasticDepartureCapsule.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/ElasticDepartureCapsule.tsx) | Capsule contrat : piste D, deadline, GPS (`onNavigationPress`), slot réveil optionnel (legacy Sentinel), état retard |
| [`SentinelFocusBadge.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/SentinelFocusBadge.tsx) | Bulle Talk 105 dp (hub + Talk) ; états A barre / B suggestion ; `SentinelFocusBadgeShell` |
| [`useSentinelFocus.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useSentinelFocus.ts) | Hook React — `pickSentinelFocus` + `visible` (horloge 10 s) |
| [`sentinelFocusSelection.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/sentinelFocusSelection.ts) | Séquenceur glissant : tri arrivée, `pickActiveMicroDashboardTrip`, `pickSlidingSuggestionTrip`, `isSentinelFocusSlotVisible` |
| [`TripNeumorphicOrb.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TripNeumorphicOrb.tsx) | Orbe partagé TRIP (`card` 54 px / `compact` 26 px) pour transport, scan/GPS, retard |
| [`tripElasticCapsuleModel.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripElasticCapsuleModel.ts) | Éligibilité Timeline + mapping `elastic_anchor_*` / `ratioD` ; alarme prédéfinie `resolveElasticDepartureAlarmUnixSec` (−20 % `endMs`) |
| [`tripNavigation.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripNavigation.ts) | Lancement Apple/Google Maps/Waze réutilisable depuis sheet + Timeline ; `clearAllDepartureNotifications` au GPS |
| [`NotificationService.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/NotificationService.ts) | Contrat de départ : sticky silencieuse, Signal A/B, **`sendTripPromiseDriftSoftNotification`**, sync V4 |
| [`formatDepartureCapsule.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/formatDepartureCapsule.ts) | `formatCapsule(trip)` → chaîne Unicode `[🟢 HH:mm ———◉———— HH:mm]` |
| [`dossier_de_soumission.md`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/dossier_de_soumission.md) | Textes copier-coller Apple/Google (localisation, time-sensitive, confidentialité) |
| [`nettoyage-code-mort.md`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/nettoyage-code-mort.md) | **Registre de code mort** : modules retirés ou stubés, procédure de réactivation, checklist suppression définitive (voir § Annexe — registre code mort) |

**Legacy conservé** : `TrafficScheduler.ts` / `TrafficEngine.ts` (DebugScreen simulateur) ; colonnes SQLite `displayed_t_*`, `newtonEnabled` en metadata (nettoyage UI fait).

**Supprimé du chemin produit** : switch Newton, polling confort 5 s, tick interne 60 s, badge Timeline « Circulation : X min ».

---

## 2) Pipeline de capture (texte/audio/image → SQLite)

> Vue “reverse-engineered” depuis les points d’entrée UI (TalkDebug/Timeline/Share Sheet) et `IntentionContext`/`oneTap*`.

### 2.1 Entrée (UI) : texte, audio ou image partagée

#### Share Sheet système (image)

| Fichier | Rôle |
|---------|------|
| [`app.json`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/app.json) | Plugin `expo-share-intent` — `image/*` + `text/*` (Android intent filters ; iOS activation rules) |
| [`ShareIntentBootstrap.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/ShareIntentBootstrap.tsx) | Écoute `useShareIntentContext` ; ballet overlay ; `preassignedIntentionId` ; déduplique l’intent |
| [`fileStorage.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/fileStorage.ts) | `saveAndCompressImage` → `TalknDone-Vault/{intentionId}.jpg` (JPEG 70 %, max 1200 px) |
| [`shareService.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/share/shareService.ts) | `readLocalImageAsBase64` depuis Vault ; `uploadToCloudIfEnabled` (stub) |
| [`geminiSemanticLab.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts) | `geminiAnalyzeImageBase64` — opération `lab.analyze_image` (inlineData + prompt Vision) |
| [`IntentionCard.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionCard.tsx) + [`VaultImageViewerModal.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/VaultImageViewerModal.tsx) | Icône `image-outline` si image Vault ; visionneuse plein écran |
| [`linking.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/navigation/linking.ts) | Cold-start / background : `getInitialURL`, `subscribe`, `getStateFromPath` pour share extension |

Flux : **Partage OS** → ballet overlay → compression Vault → Vision Gemini (transcript structuré) → `submitCapturePayload({ preassignedIntentionId })` → Path A peek → bulk Gemini → `talkndone.db` (même `intentionId`). Compatible **`IS_LOCAL_MODE`** (HTTP direct + stockage device-only). Rebuild natif : `expo prebuild` + `expo run:ios|android`.

#### Texte et audio (dictée)

- `TalkDebugScreen.tsx` : écran principal de capture (debug-friendly) :
  - **Phoenix** (champ texte) passe par `IntentionContext.submitCapturePayload` (Bulk(1) / OneTap). Le **micro** est global (`GlobalCaptureOverlay`, overlay **absolu**) ; TalkDebug configure `variant: talkDebug` + `dashboardPipelineHost: true` via `CapturePresentationContext`.
  - **Layout micro global (Talk)** : [`GlobalCaptureOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/GlobalCaptureOverlay.tsx) — `position: 'absolute'`, `bottom: resolveGlobalCaptureOverlayBottom(insets.bottom)` ([`captureOverlayLayout.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/constants/captureOverlayLayout.ts)) pour flotter **au-dessus** de la tab bar (sibling hors `NavigationContainer`). Host TalkDebug : `justifyContent: 'flex-end'` (idle + recording) — **jamais** `top: 0`. Au repos : `minHeight: TALK_DEBUG_MIC_DOCK_MIN_HEIGHT` (88 px). En enregistrement : transcript + waveform (`maxHeight` ~30 % viewport) **au-dessus** de la toolbar (poubelle / pause / crayon / envoyer) ancrée en bas du dock. `TalkDebugScreen` : `bottomSpacer` + `IntentionSuggestionsBanner` (`resolveTalkDebugSuggestionsBottomOffset`) réservent l’espace in-flow. **Réglage device** : modifier `CAPTURE_OVERLAY_TAB_GAP` (défaut **8 px**, ex. **12 px**) si le micro est trop haut ou trop bas.
  - **Micro — correction STT (optionnelle)** : **Crayon** → mode édition (`CaptureTranscriptEditor`, STT gelé, `LayoutAnimation`). Barre réduite **Poubelle · Check** (Pause/Crayon masqués) ; le bloc capture remonte avec le clavier (`keyboardWill*` / `keyboardDid*`, `translateY` animé, offset safe area + 20 px). **Check** : dismiss clavier + `stopRecording` (texte corrigé) ; **Poubelle** : dismiss + annulation capture. Comportement identique Timeline / Talk (même composant global). Logs `[CAPTURE_FLOW]` `transcript_edit_start` / `transcript_manual_edit` + `[MIC] ✏️`.
  - **Overlay progression** : orchestré par [`GlobalCaptureOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/GlobalCaptureOverlay.tsx) + [`useCapturePipelineOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useCapturePipelineOverlay.ts) (ex-logique TalkDebug) ; [`AIUniversalProgressOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/AIUniversalProgressOverlay.tsx) en `Modal` plein écran ; titre i18n `talkDebug.stepTransport` / `stepTranscription` / `stepAnalysis`, barre 0–100 % lissée, mode **orange** + `talkDebug.errorNetwork` si file NetInfo ; succès → fade puis reveal **DealerBoard** ; résilience → **2 s** puis navigation **Timeline**. Micro global visible : tap en **`pipeline_wait`** ferme l’overlay via `exitPipelineWaitToIdle` **sans** annuler `submitCapturePayload`. `IntentionSuggestionsBanner` masqué via `captureRecordingActive` / `isPipelineOverlayVisible`.
  - **Fin de salve ballet** : sprint **200 ms** jusqu’à **100 %** (événements `gemini_one_tap_call_success` / `persist_callback`, géré dans `useAIProgressInertia`), **hold 150 ms** puis fermeture de l’overlay ; logs `[BALLET-PROFILER]` (`T5_BOOST_START`, `T5_100_REACHED`, `T6_HIDE_START`) ; libellé final i18n `talkDebug.stepComplete`.
  - **Mixeur d’intentions (Talk)** : `peekDetailRows` aligné sur `DealerBoard` / `dealerBulkItems` ; `selectedIntentionIndex` + surbrillance carte ; `IntentionDetailSheet` reçoit la même sélection + `intentionMixAccentColor` via `getIntentionColor(title)` (`src/utils/intentionColorHash.ts`) ; morph du corps de fiche quand plusieurs lignes peek.
  - Ancien CTA « projet structuré (échéance) », modale deadline, prévisualisation plan Gemini et persistance `PROJECT_ATOMIZE` **retirés** de cet écran (Pass 2 projet à la demande vit dans `oneTapPersist` / contexte).
- `TimelineScreen.tsx` : projection SQLite + peek capture ; **micro global** (`useCapturePresentation` → `variant: timeline`, `compact: true`) — **plus** de dock local `TalkCaptureMicButton`. Peek bloqué/différé tant que `isPipelineOverlayVisible` (overlay global actif). **`AIUniversalProgressOverlay` + `useAIProgressInertia` locaux** : réservés au **Pass 3 Feuille de Route** (`pass3SynthOpen`), distincts de l’overlay capture.
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
  - **priorité JSON** : `parseJsonIntentsFromBuffer` (trailing garbage coupé en mode final `!partial`) — types `TASK` / `TRIP` / `NOTE` / `HABIT` / `LIST` / **`PROJECT`** ; pour PROJECT : `title ← title ?? content`, `unitLabel` défaut `etape` (aligné prompt Pass 1 + Bullet-Pipe)
  - **repli Bullet-Pipe** uniquement si le buffer ne contient **aucun `{`** (évite faux positifs sur excuses markdown)
  - type intermédiaire **ExtractionResult** ; intents portent `category` + `context`
- Fusion : `mergeIntentArrayIntoOneTapSkeleton(...)` puis normalisation
  - **`clearPass1MergedIntentFields`** : isolation par intention en bulk (reset list/trip/due à chaque itération ; dernière intention → preview top-level) — corrige la fuite TRIP→LIST en logs streaming
  - **LIST / PROJECT** : titre `title ?? content` ; `project_mode: true` pour PROJECT ; `unitLabel` défaut `personne` / `etape`
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
- mutations `metadata_json` : via `patchMetadata(...)` (merge sécurisé, attendu par SPEC) ; réentrance **`sqliteMetadataPatchInProgress`** (apply direct sans SAVEPOINT imbriqué) ; savepoints **`trankil_pm_N`** pour transactions externes ; reset compteurs au recycle connexion SQLite (fix `no such savepoint` pendant PROBE Sentinel)
- **HABIT** : `due_date = null` ; `metadata_json` inclut `recurrence_rule` (structuré Pass 1) + champs legacy `cadenceDescription` / `preferredTimeHm` pour rétrocompat · coercition [`coerceRecurrenceRule`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/habitRecurrenceRule.ts) si Gemini renvoie encore `recurrence` + `due`

#### Chronologie narrative — Matin / AM / Soir / Rappel (juin 2026)

- **Switch Debug** : `CURRENT` (cartes) vs `EMAIL_HUB` (**Chronologie narrative**) — AsyncStorage `@trankil_debug_timeline_layout` ; défaut compilé `EMAIL_HUB` ([`timelineLayoutRegistry.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/timelineLayoutRegistry.ts)).
- **Carrousel** (vue Aujourd’hui + ALL + TODO) : **Inbox · À acheter · Box · Routines · Projets** — inchangé.
- **Corps Timeline** (mode `EMAIL_HUB`) : [`buildNarrativeTimelineBlocks`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/buildNarrativeTimelineBlocks.ts) — segments `MORNING` / `AFTERNOON` / `EVENING` + bloc bas **`REMINDER` (Rappel)**.
- **Rappel = Pin** : `is_pinned = 1` → bloc Rappel uniquement (pas de doublon horaire sauf épinglée **avec** échéance aujourd’hui + heure) ; tri datées ↑ puis sans date (`updated_at` ↓) ; badge **J-X** ; sous-titre `📍` adresse ([`NarrativeTimelineBlockShell`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/NarrativeTimelineBlockShell.tsx)).
- **Capture** : « Avant le [date] » → auto `is_pinned` + `metadata_json.due_constraint: 'BEFORE'` ([`narrativePinRules.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/narrativePinRules.ts) + `oneTapPersist`).
- **Toggle manuel** : `IntentionDetailSheet` — plafond `MAX_PINS_COUNT` ; `updateTrankilV2IntentionPinnedState` + miroir `patchMetadata` ; patch optimiste `onPatchRow`.
- **Espace Sacré (TalkDebug)** : même liste que le bloc Rappel du jour (`extractReminderBlockRows` sur feuille de route).
- **Sentinel Focus Badge** : sous « Aujourd’hui », avant les blocs narratifs — bulle Talk 105 dp ; cascade suggestion ; **TalkDebug** (`openTalkTripDetail`).
- **Perf** : `getItemLayout` estimé par bloc narratif ; segments passés grisés (`isTimeSegmentPast`, Rappel exclu).

#### Living Hub — blocs catégorie (Box / Routines, mai 2026)

- **Modales** : [`buildLivingHubBlocks`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/buildLivingHubBlocks.ts) + [`LivingHubCategoryModal`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/LivingHubCategoryModal.tsx) — groupBy `category_id` ; **TRIP → `TRIPS_HUB`** (🏁).

#### Inbox — journal 24h (juin 2026)

- **Rôle** : sas temporel — toutes les intentions **TODO créées aujourd’hui** (locale), avec ou sans `due_date`, jusqu’à minuit.
- **SQL** : [`INBOX_TODAY_WHERE`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/api/trankilV2Db.ts) — `listTrankilV2InboxToday`, `countInboxToday` ; plus d’exclusion `is_organized` / `due_date` / `is_pinned`.
- **UI** : tuile carrousel + [`IdeaBankModal`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IdeaBankModal.tsx) mode `inbox` ; **pas** de bouton « Tout retirer » (obsolète) ; sortie via Fait / Supprimer / archivage.
- **Feuille de route** : chevauchement autorisé — capture du jour datée pour aujourd’hui visible Inbox **et** Timeline.

#### Box — inventaire froid (mai–juin 2026)

- **Rôle** : stock à froid — intentions **créées avant aujourd’hui**, sans `due_date`, hors SHOP et HABIT.
- **Carrousel** : tuile **Box** (hardcodée) avec pastille `boxCount` — remplace le nudge cluster orphelin + tuile Listes.
- **Vue** : [`LivingHubCategoryModal`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/LivingHubCategoryModal.tsx) — blocs catégorie identiques au hub ; purge globale destructive.
- **API** : `listTrankilV2BoxStockIntentions`, `bulkDeleteTrankilV2IntentionsByIds`, filtre `BOX_STOCK_WHERE` (`created_at` &lt; jour local, `due_date` vide, hors SHOP, hors HABIT).

#### Routines — bibliothèque d'habitudes (mai 2026)

- **Carrousel** : tuile **🔁 Routines** (`routinesCount`) — vue « gérer » distincte du hub JIT « faire ».
- **Vue** : `LivingHubCategoryModal` variant routine — aperçu cadence + badge série ; tap bloc → `IdeaBankModal` ; **sans** purge globale.
- **Séries** : `getHabitCompletionDayKeysByIntentionIds` + `resolveHabitStreakDisplay` (🔥 jours consécutifs / ❄️ Pause).

#### Habitudes — Living Hub JIT (mai 2026)

- **Capture** : prompt Pass 1 étendu (`recurrence_rule` structurée, interdit `due` sur HABIT) · seed Path A inclut `H:` pour l’heure habituelle.
- **Persistance** : pass-through JSON dans `metadata_json` — pas de logique métier à l’écriture.
- **Affichage** : [`listActiveHabitsForHub`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/api/trankilV2Db.ts) → [`isHabitRowActiveForDate`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/habitRecurrenceEvaluator.ts) → injection dans [`buildLivingHubBlocks`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/buildLivingHubBlocks.ts) (regroupement par catégorie, mode `EMAIL_HUB`).
- **Carte** : `IntentionCard` affiche `time_target` / `preferredTimeHm` pour les HABIT sans `due_date`.
- **À venir** : rappels / alarmes / filtres calendrier « demain · cette semaine » sur le même evaluateur.

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

### 3.1b Timeline — Smart Clusters (Inbox · Box · Routines)

- [`SmartClustersCarousel.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/SmartClustersCarousel.tsx) : tuiles **Inbox · À acheter · Box · Routines · Projets** ; compteurs via `getTrankilV2SmartClusterCounts` (`inboxToday`, `shopCount`, `boxCount`, `routinesCount`, `projectsToday`).
- **Inbox** : [`INBOX_TODAY_WHERE`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/api/trankilV2Db.ts) — journal 24h (`created_at` = jour local, `status = TODO`) ; [`IdeaBankModal`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IdeaBankModal.tsx) mode `inbox`.
- **Box** : [`BOX_STOCK_WHERE`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/api/trankilV2Db.ts) — inventaire froid (`created_at` &lt; jour local, sans `due_date`, hors SHOP et **HABIT**) ; [`LivingHubCategoryModal`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/LivingHubCategoryModal.tsx) + [`buildLivingHubBlocks`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/buildLivingHubBlocks.ts) ; tap bloc → [`IdeaBankModal`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IdeaBankModal.tsx) ; purge globale `bulkDeleteTrankilV2IntentionsByIds` (i18n `timeline.box.*`).
- **Routines** : [`ROUTINE_HABIT_WHERE`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/api/trankilV2Db.ts) — toutes les HABIT actives ; [`buildRoutineHubBlocks`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/buildLivingHubBlocks.ts) + badges série en aperçu ; tap bloc catégorie → [`IdeaBankModal`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IdeaBankModal.tsx) ; **sans** purge globale au niveau vue catégories.
- **Legacy** : [`clusterEngine.getBestOrphanCluster`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/clusterEngine.ts) conservé mais **non branché** au carrousel.
- **Planifier le début (PROJECT)** : dans [`IdeaBankModal.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IdeaBankModal.tsx), si `type === 'PROJECT'` et pas de `project.start_date`, CTA **Planifier le début** (`cluster.planProjectStart`) ; `patchMetadata` + `updateTrankilV2IntentionTemporal({ due_date })`.
- **Actions ligne IdeaBank** : icônes seules ✓ / 📅 / ✏️ / 🗑️ ; **Modifier** ferme la modale puis `openDetail` → `IntentionDetailSheet`.
- Util partagée : [`projectMilestonesModel.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/projectMilestonesModel.ts).

### 3.1c Timeline — carte TRIP (`IntentionCard`)

- [`IntentionCard.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionCard.tsx) : pied de carte **uniquement** si `metadata_json.trip` ; logique [`tripTimelineCard.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripTimelineCard.ts) (`resolveTripTimelineFooter`) — lecture **metadata only** + `remind_to_leave` (SQL Timeline).
- **All Day** : **aucun** footer Timeline (pas de badge).
- **FREE** : footer CTA verrouillé → paywall direct ; tap corps → **hub TRIP unifié** (vitrine + `tripSurveillanceStartLocked`).
- **PRO + PROBE1 fait + mission surveillée active** : [`ElasticDepartureCapsule`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/ElasticDepartureCapsule.tsx) compacte remplace le badge texte ; GPS uniquement sur carte ; mapping via [`tripElasticCapsuleModel.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripElasticCapsuleModel.ts) ; tap GPS = navigation ; **rappel** = bouton footer sheet + témoin cloche carte ([`useIntentAlarm`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useIntentAlarm.ts), § 2.c ter SPEC).
- **Retard Timeline** (`nowMs > endMs`) : capsule remplacée par un orbe GPS graphite `#1C1C1E` sans texte, taille `compact` (26 px), aligné sur le slot X du badge GPS vert.
- **PRO + mission active + PROBE1 pending** : badge scan à 3 états — `timeline.scanTrafficScheduled` (heure miroir `trip.next_probe_at_ms`), `timeline.scanTrafficInProgress` (≤ 60 s avant l’heure ou heure passée), puis fenêtre élastique après PROBE1 ; horloge locale [`useProbeScheduleClock`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useProbeScheduleClock.ts) (tick 30 s, cleanup au démontage).
- **Reconcile Sentinel** : déclenché au submit adresse (`onSelect` après OK Geocoding) et au tap Big Button ; debounce 500 ms ; mutex activation par `intentionId` ; retry SQLite [`withSentinelDbRetry`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/sentinelDbRetry.ts) (logs `[TRIP-SENTINEL-RECOVERY]`). `syncSentinelAfterDestinationChange` no-op si `remind_to_leave === 0`.
- **PRO non configuré** : footer CTA setup **ou** tap corps → **même Sheet hub unifiée** (mémo + logistique + Big Button).
- **Sheet TRIP** : plus de switch — Big Button [`tripSurveillanceButton.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripSurveillanceButton.ts) (`tripSurveillanceStart` / `tripSurveillanceActive` / locked) ; toast si champs manquants ; origine GPS non bloquante ; garde anti double-tap ; `applyTripMetadataLocally` après `onSelect` adresse (sync optimiste Big Button).
- **Saisie adresse (Lazy-Fetch)** : [`AddressInputField`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/traffic/AddressInputField.tsx) — **0 Autocomplete à la frappe** ; Done → Geocoding (< 12 car.) ; loupe → Autocomplete volontaire (≥ 12 car.) ; ✓ verte + verrouillage après validation.
- **Tirelire TRIP** : [`IdeaBankTripItineraryBlock`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IdeaBankTripItineraryBlock.tsx) + rideau recherche inline ; pilule surveillance hybride — voir **SPEC.md § 2.d.3**.
- **Readiness coords** : [`tripTripReadiness.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripTripReadiness.ts) — `readValidTripCoords` rejette `null`/`0` ; pas de préremplissage favori silencieux à l’ouverture sheet.
- **Fix crash Surveiller** : INSERT `sentinel_trips` — 31 placeholders / 31 args ; reset connexion SQLite sans ré-init schéma ; queue `getFirstAsync` / `getAllAsync` ; `getTrankilV2IntentionById` via `withTrankilV2Database`.
- **Anti-faux créneau** : pas de fenêtre UI sans `standard_duration_min`.
- **Contrat de Départ (mai 2026)** : deadline auto-calibrée `T_arr − (T_pred×D)` ; promesse P1 (`promise_*`) ; PROBE2 prédictif + Ghost Update (`|Δ_promise| ≤ 5 min`) ; PROBE3 live ; notif douce dérive. Voir SPEC § Validateur de Promesse.
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
- **Centralisation micro / overlay (mai 2026)** : logique pipeline (~200 lignes) extraite de `TalkDebugScreen` vers [`useCapturePipelineOverlay.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useCapturePipelineOverlay.ts) + [`GlobalCaptureOverlay.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/GlobalCaptureOverlay.tsx) + orchestration dans [`CapturePresentationContext.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/context/CapturePresentationContext.tsx). Montage micro unique (grep `TalkCaptureMicButton` dans `src/` → composant + overlay global). **Position overlay (mai 2026)** : [`captureOverlayLayout.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/constants/captureOverlayLayout.ts) — `resolveGlobalCaptureOverlayBottom` ; réglage fin via `CAPTURE_OVERLAY_TAB_GAP` (8 px, ajuster ex. 8→12 si chevauchement tab bar). **Retiré des écrans** : `TalkCaptureMicButton`, overlay Pass 1, `PassProModal`, refs `pipelineModalVisible*`, callbacks `onPipelineDashboard*`, state `captureStep`, ancien `captureDock` in-flow (remplacé par overlay + `bottomSpacer`).
- [`TalkPipelineProgressDashboard.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TalkPipelineProgressDashboard.tsx) : **jamais monté** — candidat suppression (legacy pré-`AIUniversalProgressOverlay`).
- **Nudge « 2 minutes disponibles »** (`AvailabilityNudgeModal`) : **retiré** de `App.tsx` (mai 2026) ; stubs + blocs `DEPRECATED` dans `AvailabilityNudgeModal.tsx`, `AvailabilityTimer.ts`, `BonusEngine` (chemin optimal reward), `Strings.nudges`, `trankilV2Db.pickAvailabilityTask` — détail §1–§5 du registre.

### 4.3 Table `offline_audio_queue` et bootstrap DB

SPEC (2.c.2) : schéma nécessaire au démarrage, incluant `offline_audio_queue`.

État actuel :

- `initTrankilV2Schema()` crée `offline_audio_queue` et ses index au bootstrap.
- `offlineAudioQueue.ts` n’exécute plus de DDL « à la volée » (`ensureOfflineAudioQueueTable` supprimé).

### 4.4 Cinématique peek capture (Path A / Path B / full 95 %)

SPEC : après dictée, peek relatif au viewport, transition à la persistance Pass 1, auto-close contrôlé.

État actuel :

- `TimelineScreen` / `TalkDebugScreen` : sur `INTENTION_PEEK_SNAPSHOT`, row `peek_pending` + ouverture peek **Path A** (`capturePeekPathAHeightPx`, ratio **~5 %** viewport via `CAPTURE_PEEK_PATH_A_RATIO`) — **y compris** quand la suite du pipeline est la **file offline** (pas de `INTENTION_PEEK_FIRST_SAVE` dans ce cycle jusqu’au rejeu en ligne). **Gating overlay global** : peek Path A/B ignoré ou différé tant que `isPipelineOverlayVisible` / `pipelineOverlayVisibleRef` (Path B flush via **`CAPTURE_DEFERRED_PEEK_FIRST_SAVE_FLUSH`**). **Gating focus** : `useIsFocused()` — si l’onglet n’a pas le focus, l’événement est ignoré (`logCaptureFlow` : `ui_peek_snapshot_skip_unfocused` / `ui_peek_first_save_skip_unfocused`) ; seul l’écran focalisé émet `ui_peek_snapshot` / `ui_peek_first_save`. Au blur d’un onglet qui portait encore un peek capture actif (`path_a` | `path_b` | `peek_pending`), fermeture locale (`ui_peek_capture_dismissed_unfocused_tab`) pour éviter une `Modal` résiduelle.
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
- **Overlay progression Talk** : [`useCapturePipelineOverlay.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useCapturePipelineOverlay.ts) + [`useAIProgressInertia.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useAIProgressInertia.ts) + [`AIUniversalProgressOverlay.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/AIUniversalProgressOverlay.tsx) (exporte **`CaptureTranscriptEditor`** pour le micro), montés par [`GlobalCaptureOverlay.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/GlobalCaptureOverlay.tsx) ; dock micro **absolu** repositionné via [`captureOverlayLayout.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/constants/captureOverlayLayout.ts) (`CAPTURE_OVERLAY_TAB_GAP` ajustable). Phase micro **`pipeline_wait`** + ref **`exitPipelineWaitToIdle`** dans [`TalkCaptureMicButton.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TalkCaptureMicButton.tsx). **Harmonisation T=0 (mai 2026)** : `PressableScale` sur micro ; phase **`preparing`** (spinner permissions/quota) ; TalkDebug affiche overlay + `pipeline_wait` **avant** `stopAndUnloadAsync` / NetInfo ; haptique Success au paint overlay (double `rAF` dans `useCapturePipelineOverlay`) ; toolbar **`isSubmitting`** verrouillée au Send. Peek Path B différé : event **`CAPTURE_DEFERRED_PEEK_FIRST_SAVE_FLUSH`** ; reset sélection **DealerBoard** via `CapturePresentationContext.registerOverlayLifecycleHandlers({ onPipelineSprintComplete })`. L’édition STT + barre validation clavier a lieu **avant** l’overlay Pass 1 (`recording`). [`TalkPipelineProgressDashboard.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TalkPipelineProgressDashboard.tsx) reste dans le dépôt mais **n’est plus** monté.
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

## Concept Sourced Intelligence (juin 2026)

**Objectif** : ancrer chaque intention capturée (source, contexte, temporalité) — zéro migration SQLite lourde.

| Levier | Implémentation |
|--------|----------------|
| **Rollback** | `SOURCING_V1_ENABLED` dans [`src/config/features.ts`](src/config/features.ts) — `false` = comportement prod pré-feature |
| **Blob métier** | `metadata_json.sourcing_v1` via `patchMetadata` (pas de `ALTER TABLE`) |
| **Colonne native** | `context_tag` (déjà en place) |
| **Pass 1** | `buildOneTapPass1SystemInstructionSourced` + champs `source_hint`, `title_mode`, `event_series` ; sélection via `resolvePass1SystemInstruction` |
| **UUIDs T0** | `CaptureBatchContext` dans `submitCapturePayload` (`capture_batch_id`, `vault_parent_id`, `auto_parent_id`, `child_id_pool`) |
| **Offline immuable** | stub `sourcing_v1` dans NOTE shell `offline_audio_queue` ; rehydratation au replay |
| **Multi-bloc** | `persistOneTapDraftVentilated` : PROJECT parent auto + TASK enfants (`parent_id`) si `intents.length > 1` |
| **EVENT_SERIES** | type SQLite `TASK` ; `due_date` = 1er slot ; série dans `sourcing_v1.event_series_v1` |
| **UI Inbox** | [`InboxLineTitle.tsx`](src/components/InboxLineTitle.tsx) — 2 lignes strictes, pastille catégorie, **pas de miniature Vault** (perf FlatList) |
| **Hiérarchie Inbox** | [`buildInboxRootsView`](src/utils/inboxRootsView.ts) — filtrage racines **côté JS** ; accordéon dans `IdeaBankModal` |

**Fichiers clés** : `src/utils/sourcingV1.ts`, `src/utils/inboxRootsView.ts`, `oneTapUniversalCapture.ts`, `oneTapPersist.ts`, `IntentionContext.tsx`, `offlineAudioQueue.ts`, `trankilV2Db.ts` (mapper), `IdeaBankModal.tsx`, `TimelineScreen.tsx`.

**Non-régression** : capture mono-intention (`"Acheter du lait"`) → 1 TASK racine, pas de PROJECT parent, UI ligne 2 = moment/NEW.

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
7. `src/utils/captureFlowLog.ts` (`logCaptureFlow` / `notifyCapturePipelineProgress`, corrélation `traceId` → overlay global)
8. `src/hooks/useCapturePipelineOverlay.ts` (orchestration overlay Pass 1 Talk — ex-TalkDebugScreen)
9. `src/context/CapturePresentationContext.tsx` (config micro global par écran + lifecycle + orchestration pipeline/quota)
10. `src/constants/captureOverlayLayout.ts` (`resolveGlobalCaptureOverlayBottom`, `CAPTURE_OVERLAY_TAB_GAP` — réglage fin position micro)
11. `src/components/GlobalCaptureOverlay.tsx` (micro unique overlay absolu + overlay + quota lock)
12. `src/hooks/useAIProgressInertia.ts` (lissage 0–100 % : inertie P1/P2, phase 3, bumps `CAPTURE_PIPELINE`, sprint final)
13. `src/components/AIUniversalProgressOverlay.tsx` (overlay plein écran : Pass 1 capture via `GlobalCaptureOverlay` ; Pass 3 synthèse via `TimelineScreen`)
14. `src/components/dailyRoadmap/*` (sas Pass 3, modal WebView / PDF)
15. `src/services/dailyRoadmapPass3.ts` (payload + instruction Pass 3)
16. `src/utils/elasticSlotEngine.ts` + `src/services/traffic/trafficSchedulerElasticTick.ts` (TRIP Contrat de Départ)
17. `src/services/traffic/sentinelTripMission.ts` (cancel / reset mission)
18. `src/services/NotificationService.ts` + `src/utils/formatDepartureCapsule.ts` + `dossier_de_soumission.md` (notifications Contrat de Départ)
19. [`nettoyage-code-mort.md`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/nettoyage-code-mort.md) (registre code mort / retraits feature)
20. `src/theme/TalkThemeRegistry.ts` + `src/hooks/useDesignTokens.ts` (variantes visuelles / rollback `CURRENT` / **`ZEN_TYPOGRAPHY`**)
21. `src/components/ShareIntentBootstrap.tsx` + `src/services/fileStorage.ts` + `src/services/share/shareService.ts` (Share Sheet → Vault → Vision → One-Tap)
22. `src/utils/sourcingV1.ts` + `src/utils/inboxRootsView.ts` + `src/components/InboxLineTitle.tsx` (Sourced Intelligence — rollback via `SOURCING_V1_ENABLED`)
23. `src/components/VaultImageViewerModal.tsx` + icône Vault dans `IntentionCard.tsx` (consultation image associée)
24. `src/screens/DebugScreen.tsx` + `src/api/trankilV2Db.ts` (TalkNDone-Vault : export/import SQLite natif)

