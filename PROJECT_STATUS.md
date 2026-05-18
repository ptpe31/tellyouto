# PROJECT_STATUS — Dev-trankil-v34 (TalknDone)

> Objectif de ce document : reconstruire la “mémoire” du projet après migration, en cartographiant **/src** et en recollant au contrat **SPEC.md** (one‑tap capture + offline‑first + SQLite Trankil‑v2).

## TL;DR

- Stack : **Expo / React Native**, React Navigation, React Context, **SQLite (expo-sqlite)** comme source de vérité locale (`talkndone.db`).
- Cœur produit : pipeline **OneTap Dual‑Path** (Path A heuristiques locales → Path B Gemini via proxy) puis **Douane** (parsing/normalisation) et **persistance**.
- Offline-first (**urbanisation SPEC v34 : 100 % terminée**) : en cas d’échec réseau/IA, la capture (texte/audio) est **mise en file** via `offline_audio_queue` + insertion d’une NOTE `is_pending_ai=1` (métadonnées `persistence_label` / `tag` = `NOTE_FALLBACK` + `source: offline_audio_queue`), puis rejouée ultérieurement. **NetInfo** : « en ligne » si `isConnected === true` **et** `isInternetReachable !== false` (`isNetInfoConsideredOnline`) ; log `[OFFLINE-STABILITY] netinfo_online_null_reachable` si tentative en ligne avec reachability `null`. **En ligne**, une coupure **pendant** Path B / persistance d’un chunk peut déclencher un **enqueue auto** (heuristique réseau/serveur, logs `[OFFLINE-STABILITY]`) sans Alert obligatoire. **Parité peek** : `INTENTION_PEEK_SNAPSHOT` (Path A) est émis **avant** `NetInfo` et la file, pour le même feedback visuel hors ligne qu’en ligne.
- **Feuille de Route (Pass 3)** : depuis la Timeline, icône imprimante → sas SQL (retards + orphelines) → synthèse Gemini HTML (RC `prompt_pass3_synth_v1`) → `daily_summaries` + WebView / PDF ; overlay progression réutilise `useAIProgressInertia` + `AIUniversalProgressOverlay` ; lien sous le groupe « Aujourd’hui ».
- **Cluster tactique (Tirelire)** : [`getBestOrphanCluster`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/clusterEngine.ts) sur `TimelineScreen` (seuil d’affichage `count >= 2`, contexte ALL + TODO) ; carte neumorphique + ouverture [`IdeaBankModal`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IdeaBankModal.tsx) filtrée par `category_id` ; log `[CLUSTER-ENGINE]`. **Projets orphelins** : bouton `cluster.planProjectStart` → `project.start_date` + replan jalons (`replanProjectMilestonesFromStartDate`) + `due_date` pour sortir du cluster.
- Alignement SPEC : le flux “**Micro as Bulk(1)**” est **unifié** : micro/texte unitaire passent par le **séquenceur bulk** avec persistance **ventilée** (une seule “source de vérité”), et un `traceId` est propagé pour des logs cohérents ; sur **TalkDebug**, l’**overlay de progression** ([`useAIProgressInertia`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useAIProgressInertia.ts) + [`AIUniversalProgressOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/AIUniversalProgressOverlay.tsx) + événements `CAPTURE_PIPELINE_PROGRESS`) couvre l’attente Pass 1 (micro « échap » sans annuler le pipeline). **Correction STT optionnelle** : crayon → barre validation **Poubelle / Check** au-dessus du clavier (`translateY` + listeners clavier) → `transcript` final vers Gemini ; logs `transcript_manual_edit` / `[MIC] ✏️`.

---

## 1) Architecture globale

### 1.1 Entrypoints & bootstrap

- `index.ts` : charge i18n (`./src/locales/i18n`) puis enregistre `App`.
- `App.tsx` :
  - bootstrap services : `initializeGeminiEngine()`, `configureCaptureBackgroundTask()`, `requestBackgroundExecutionPermissions()`
  - bootstrap DB : `bootstrapTrankilV2Database()` (avec fallback timer 1.2s pour ne pas bloquer l’UI)
  - injecte des Providers (ordre important car ils fournissent thème, i18n, profil, etc.)
  - monte `NavigationContainer` (avec deep linking + `rootNavigationRef`).

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

- `ThemeContext` : thèmes Paper / couleurs.
- `LanguageContext` : i18n / locale.
- `DebugUnlockContext` : gating d’options debug.
- `AllyContext` : couche “assistant/ally” (UX).
- `PowerContext` : état “power” / capacités.
- `UserSpectrumContext` : **profil runtime** (ex. `locale`, `isProUser`) utilisé partout pour quotas, i18n, etc.
- `CalendarIntegrationContext` : intégration calendrier.
- `SaturationContext` : animation multiplier / “mode saturation” (overlay Blur).
- `FocusProtectionContext` : protections UX (focus / distraction).
- `IntentionContext` (**le cœur**) : orchestration de capture, OneTap (A/B), offline queue, bulk séquentiel, zoom projet.

### 1.4 Services (domain)

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

#### IA Gemini

- `initializeGeminiEngine.ts` : initialise la shortlist de modèles.
- `geminiRemoteModelSteering.ts` : shortlist, cache, validations.
- `geminiSemanticLab.ts` : appels Gemini (stream/non‑stream), métriques tokens/latence/cost, fallback modèles ; **Pass 3** `geminiPass3DailyRoadmapHtml` (Feuille de Route HTML).
- `dailyRoadmapPass3.ts` : construction du JSON Pass 3, composition system instruction (RC + suffixe), orchestration appel + persistance rapport.
- `geminiResponseGuards.ts` : parsing/guards.

#### “Sentinel” / Trafic (autre sous-système)

- `services/traffic/*` : scheduler, background service, notifications, distance matrix, activation, runtime, etc.

---

## 2) Pipeline de capture (texte/audio → SQLite)

> Vue “reverse-engineered” depuis les points d’entrée UI (TalkDebug/Timeline) et `IntentionContext`/`oneTap*`.

### 2.1 Entrée (UI) : texte et/ou audio

- `TalkDebugScreen.tsx` : écran principal de capture (debug-friendly) :
  - **Phoenix** (champ texte) et **micro** (`TalkCaptureMicButton`) passent par `IntentionContext.submitCapturePayload` (Bulk(1) / OneTap).
  - **Micro — correction STT (optionnelle)** : **Crayon** → mode édition (`CaptureTranscriptEditor`, STT gelé, `LayoutAnimation`). Barre réduite **Poubelle · Check** (Pause/Crayon masqués) ; le bloc capture remonte avec le clavier (`keyboardWill*` / `keyboardDid*`, `translateY` animé, offset safe area + 20 px). **Check** : dismiss clavier + `stopRecording` (texte corrigé) ; **Poubelle** : dismiss + annulation capture. Même comportement sur **Timeline**. Logs `[CAPTURE_FLOW]` `transcript_edit_start` / `transcript_manual_edit` + `[MIC] ✏️`.
  - **Overlay progression** ([`useAIProgressInertia`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useAIProgressInertia.ts) + [`AIUniversalProgressOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/AIUniversalProgressOverlay.tsx)) : après stop dictée, `Modal` plein écran (fond opaque + flou) ; titre i18n `talkDebug.stepTransport` / `stepTranscription` / `stepAnalysis`, barre 0–100 % lissée (inertie P1/P2 → 60 %, phase 3, bumps bus), mode **orange** + `talkDebug.errorNetwork` si file NetInfo, auto-queue réseau `bulk_network_resilience_enqueue`, ou `submit_offline_queued` `reason: netinfo_offline` ; succès → fade puis reveal **DealerBoard** ; résilience → **2 s** puis navigation **Timeline**). Le micro reste visible : tap en **`pipeline_wait`** ferme l’overlay via `exitPipelineWaitToIdle` **sans** annuler `submitCapturePayload`. `IntentionSuggestionsBanner` masqué pendant l’overlay.
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

Points importants :

- Prompt : `buildOneTapPass1SystemInstruction()` + `buildOneTapPass1UserContent(transcript, wireLineFromSkeleton(skeleton))` (deux blocs distincts côté proxy, pas de concaténation côté app).
- **Pass 1 — aiguillage TYPE** : la `systemInstruction` impose une hiérarchie **action / centrée utilisateur** (PROJECT → LIST → HABIT → TRIP → TASK) : le modèle choisit le `TYPE` selon la **prochaine action la plus utile** dans l’app (plan, liste, habitude, trajet, note atomique), sans changer le format Bullet‑Pipe ni les contrats DISPLAY TITLE / CATEGORY / TRIP.
- Langue : `detectLangForOneTapPrompt()` puis discipline “zéro traduction” (contrat SPEC).
- Appel Gemini : `geminiSemanticLab` (stream ou non‑stream).
- Parsing modèle :
  - priorité au format **Bullet‑Pipe** 5 segments : `> TYPE | CONTENT | CATEGORY_CODE | SLOT_4 | CONTEXT` (`parseBulletPipeIntentsFromBuffer` ; rétrocompat 4 segments)
  - fallback JSON “best-effort” (`parseJsonIntentsFromBuffer`)
  - type intermédiaire **ExtractionResult** ; intents portent `category` + `context`
- Fusion : `mergeIntentArrayIntoOneTapSkeleton(...)` puis normalisation
  - `categoryTag` + **`contextTag`** sur le brouillon fusionné
  - normalisation des catégories inconnues → `PERSO` (`normalizeOneTapCategoryCode`)
  - normalisation contexte → token uppercase (`normalizeOneTapContextTag`)
  - normalisation temporelle (`normalizeUniversalTemporalInData`)
  - **Top-Down Sync** : recalcul `dueDateYmd/dueTimeHm` depuis `dueDateTime` via `syncYmdHmFromDueDateTime` (alignement SPEC)
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
- **`IntentionDetailSheet.tsx`** : footer CTA TRIP/LIST/PROJECT ; `pass2_unlocked: 1` au clic PRO ; TRIP → `intentionDetail.actionSetupAlert` (*Me prévenir quand partir ?*) ; LIST/PROJECT → `pass2.generateList` / `pass2.generateSteps` ; `metadataJsonLive` + `showPass2FooterCta` (masque CTA dès `pass2_unlocked === 1` en UI, y compris Path B peek) ; overlay inertie LIST/PROJECT ; `applyPass2MetadataLocally` + `onPatchRow` ; `onPressPass2` / Path B ; logs `[Pass2] ✅`.
- **TRIP logistique (sheet)** : confort **Estimé / Réel** + barre ratio (`sentinelTripComfort.ts`, lecture `sentinel_trips`) ; auto-apprentissage silencieux `location_favorites` au `onSelect` Places arrivée si `destination_name` ; bouton **Lancer l’itinéraire** si coords arrivée + 1er scan Newton (`routeReady`) ; **transport** : 3 modes (`auto` / `walking` / `bike`) via [`tripTransportMode.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripTransportMode.ts) — **transit / bus retiré** (migration legacy `transit`→`auto` à l’ouverture fiche) ; logs dev `[TRIP-INIT]` / `[TRIP-LEARN]` / `[TRIP-SENTINEL]` / `[API-CALL]` (Places, Distance Matrix).
- **`TalkDebugScreen.tsx`** : `onPatchRow={patchPeekDetailRow}` sur `IntentionDetailSheet` (sync `peekDetailRows` après Pass 2 — évite CTA fantôme post-génération).
- **Pass 1** : `buildOneTapPass1SystemInstruction` + `buildOneTapPass1UserContent` dans [`oneTapUniversalCapture.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapUniversalCapture.ts) ; proxy reçoit `systemInstruction` + corps user réduit (référence temps + dictée + seed heuristique).
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

**Observabilité** : logs console **`[OFFLINE-STABILITY]`** via `src/utils/offlineStability.ts` (`logOfflineStability`, `isLikelyNetworkOrServerError`, `isNetInfoConsideredOnline`, phase **`netinfo_online_null_reachable`**) ; **`[CAPTURE_FLOW]`** via `src/utils/captureFlowLog.ts` : logs console **`__DEV__`** **et** bus global **`notifyCapturePipelineProgress`** (`CAPTURE_PIPELINE_PROGRESS_EVENT`) pour l’overlay Talk (`useAIProgressInertia` / `AIUniversalProgressOverlay`) + corrélation `traceId` ; phases incluant `peek_snapshot_emit`, **`peek_snapshot_offline_queue`**, **`bulk_network_resilience_enqueue`**, `submit_netinfo`, `submit_offline_queued`, etc.

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
  - `refineOneTapWithGeminiCompressed(...)` : Path B Gemini (`systemInstruction` Pass 1 + corps user court via `geminiGenerateOneTapCompressedLine` / stream).
  - `buildOneTapPass1SystemInstruction()` / `buildOneTapPass1UserContent(...)` : découpage SPEC (SI vs Reference Time + seed + dictée seulement ; pas de règles dupliquées dans le user).
  - `parsePartialWireLine(buffer)` / `mergeWireIntoOneTapSkeleton(...)` : parsing “wire” (héritage + compat).
  - (internes critiques) `parseBulletPipeIntentsFromBuffer`, `parseJsonIntentsFromBuffer`, `mergeIntentArrayIntoOneTapSkeleton`.

### 3.1b Timeline — cluster tactique (Tirelire)

- [`clusterEngine.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/clusterEngine.ts) : **`getBestOrphanCluster(rows)`** — filtre TODO sans `due_date`, groupe par `category_id` (normalisation alignée domaine), choix du plus grand groupe puis départage par **`created_at`** le plus ancien ; log **`[CLUSTER-ENGINE] 🎯 …`**
- [`TimelineScreen.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TimelineScreen.tsx) : agrège **`orphanClusterPool`** (tirelire cachée + TODO sans date dans `filteredPool`) ; si `count >= 2` et filtres ALL/TODO, entrée liste **`ideaBankCluster`** (carte unique) ; sinon comportement **`ideaBank`** inchangé ; état **`ideaBankCategoryFilter`** pour passer à **`IdeaBankModal`** uniquement les lignes du cluster.
- i18n : `timeline.ideaBank.clusterNudge`, `timeline.ideaBank.clusterSubtitle`.
- **Planifier le début (PROJECT)** : dans [`IdeaBankModal.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IdeaBankModal.tsx), si `type === 'PROJECT'` et pas de `project.start_date` (`getProjectStartDateFromMetadataJson`), le CTA **Planifier le début** (`cluster.planProjectStart`) ouvre le sélecteur de date ; à la validation : `patchMetadata` (`start_date` + `buildProjectMilestonesMetadataPatch` après `replanProjectMilestonesFromStartDate`) puis `updateTrankilV2IntentionTemporal({ due_date })` — l’intention quitte le pool orphelin et apparaît sur la Timeline. Autres types : `due_date` seul (`timeline.ideaBank.schedule`).
- Util partagée : [`projectMilestonesModel.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/projectMilestonesModel.ts) — `getProjectStartDateFromMetadataJson`, `replanProjectMilestonesFromStartDate`.

### 3.1c Timeline — carte TRIP (`IntentionCard`)

- [`IntentionCard.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionCard.tsx) : pied de carte **uniquement** si `metadata_json.trip` ; logique centralisée [`tripTimelineCard.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripTimelineCard.ts) (`resolveTripTimelineFooter`).
- **Cas A** (`pass2_unlocked !== 1`) : bouton `intentionDetail.actionSetupAlert` → `onPressTripSetup` / [`TimelineScreen.openDetailTripSetup`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TimelineScreen.tsx) : sheet **full** + `focusArrivalAddressOnOpen` sur le champ arrivée ([`IntentionDetailSheet`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionDetailSheet.tsx)).
- **Cas B** (`pass2_unlocked === 1` + scan Newton) : badge `timeline.trafficScanConfigured` ou `timeline.trafficLiveMinutes` (lecture `sentinel_trips` + repli `trip.last_traffic_duration`).
- **Cas C** (configuré, pas de scan) : badge créneau statique `[ HH:mm ]` ou `[ start – end ]` (`timeline.estimatedDeparture*`).
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

État actuel :

- `oneTapUniversalCapture.ts` conserve une surface `useStream` / parsing multi‑intents pour compatibilité interne ou usages futurs.
- `IntentionContext` **n’expose plus** `runGeminiStreamRefine` ni validation streaming associée : un seul chemin bulk + persistance ventilée.

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
- **TRIP — confort & guidage** : bloc **Estimé / Réel** (durées depuis `sentinel_trips` via `getSentinelTripComfortSnapshot`) ; `upsertLocationFavorite` silencieux si alias `destination_name` à la validation Places ; **Lancer l’itinéraire** visible si `location_lat/lng` + `hasNewtonFirstScanRecorded` (plus de condition sur coords départ).
- **TRIP — carte Timeline** ([`IntentionCard.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionCard.tsx) + [`tripTimelineCard.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripTimelineCard.ts)) : CTA `intentionDetail.actionSetupAlert` si `pass2_unlocked !== 1` ; badges traffic / créneau estimé si configuré ; `openDetailTripSetup` → sheet full + focus arrivée.
- **TRIP — transport** : plus de mode **transit** (i18n `transportTransit` / `timeline.tripSetupCta` supprimés) ; 3 icônes sheet ; Newton / Maps en `driving` pour legacy.
- **Gating monétisation Pass 2 (SPEC §6)** — `useUserSpectrum().spectrum.isProUser` dans `IntentionDetailSheet` : FREE sans écriture `pass2_unlocked: 1` ; PRO persiste `1` + enrichissement optionnel LIST/PROJECT.
- Utilitaire : `src/utils/capturePeekLayout.ts`.
- **Overlay progression Talk** : [`useAIProgressInertia.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useAIProgressInertia.ts) + [`AIUniversalProgressOverlay.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/AIUniversalProgressOverlay.tsx) (exporte **`CaptureTranscriptEditor`** pour le micro), branché depuis [`TalkDebugScreen.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TalkDebugScreen.tsx) ; phase micro **`pipeline_wait`** + ref **`exitPipelineWaitToIdle`** dans [`TalkCaptureMicButton.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TalkCaptureMicButton.tsx). L’édition STT + barre validation clavier a lieu **avant** cet overlay (`recording`). [`TalkPipelineProgressDashboard.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TalkPipelineProgressDashboard.tsx) reste dans le dépôt mais **n’est plus** monté par TalkDebug.
- **DealerBoard — « Matérialisation » (Talk)** : [`DealerBoard.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/DealerBoard.tsx) monté uniquement sous `TalkDebugScreen` ; **proxies visuels** (pas d’écriture SQLite — persistance inchangée via `IntentionContext`). Cartes **sélectionnables** (`selectedIntentionIndex` / `onSelectIntentionIndex`) pour piloter la fiche peek / full. **`INTENTION_PEEK_SNAPSHOT`** inclut désormais **`transcript`** (emit `IntentionContext`) : mot-clé fantôme = **dernier mot** du transcript brut (regex `(\S+)\s*$`) avec repli sur le titre Path A. **`INTENTION_PEEK_FIRST_SAVE`** → remplacement / ballet (`LayoutAnimation` + springs Reanimated) selon le nombre d’intentions ; payload **`dealerBulkItems`** construit dans `IntentionContext` sur bulk ventilé ; géométrie 2/3/4 cartes et + dans [`dealerBalletLayout.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/dealerBalletLayout.ts) ; cartes **portrait** (~100×140 via `dealerPortraitMetrics`) ; matérialisation via [`DealerMaterializeCard.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/DealerMaterializeCard.tsx) + [`dealerMaterialTheme.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/dealerMaterialTheme.ts). **`MICRO_CAPTURE_START`** (`intentionEvents.ts`, émis par `TalkCaptureMicButton`) : coupe le timer idle et aspire vers le badge NEW ; haptique à l’impact ; timer idle aspiration **30 s** ; archivage **local** du proxy à l’aspiration.

### 4.5 Offline-first : traitement ultérieur encore “semi-manuel”

Le contrat “mise en file offline pour traitement ultérieur” est présent, avec **consolidation récente** :

- **Drain replay** : `markOfflineAudioAsDone` n’est plus appelé avant un `submitCapturePayload` réussi (`Promise<boolean>`), ce qui évite de supprimer l’audio de file si le rejeu échoue.
- **Auto-queue réseau** : erreurs réseau/serveur pendant le bulk en ligne enfilent le contenu sans imposer une Alert (logs `[OFFLINE-STABILITY]`).
- Le rejouage reste surtout déclenché par **NetInfo** / notification / action utilisateur (`analyzeLatestOfflineAudio()`), pas par un scheduler/worker dédié.
- `CaptureProcessingService` (BackgroundFetch) traite une autre queue (AsyncStorage) et appelle seulement `analyzeLocally` (pas de ré-injection systématique OneTap/Gemini + persistance).

Si l’objectif produit est “zéro friction offline”, il peut encore manquer un **replay automatique** plus agressif (avec garde-fous anti-doublon et backoff).

### 4.6 Instrumentation Pass 2 (logs)

État actuel :

- Enrichissement **uniquement** depuis `IntentionDetailSheet` (flux manuel PRO) ; logs dev `[Pass2] ✅ … enrich …ms` après succès.
- Plus d’enrichissement silencieux depuis `oneTapPersist` après insert LIST/PROJECT.

---

## Annexes (repères pratiques)

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

