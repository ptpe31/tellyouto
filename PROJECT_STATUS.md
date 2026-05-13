# PROJECT_STATUS — Dev-trankil-v34 (TalknDone)

> Objectif de ce document : reconstruire la “mémoire” du projet après migration, en cartographiant **/src** et en recollant au contrat **SPEC.md** (one‑tap capture + offline‑first + SQLite Trankil‑v2).

## TL;DR

- Stack : **Expo / React Native**, React Navigation, React Context, **SQLite (expo-sqlite)** comme source de vérité locale (`talkndone.db`).
- Cœur produit : pipeline **OneTap Dual‑Path** (Path A heuristiques locales → Path B Gemini via proxy) puis **Douane** (parsing/normalisation) et **persistance**.
- Offline-first : en cas d’échec réseau/IA, la capture (texte/audio) est **mise en file** via `offline_audio_queue` + insertion d’une NOTE `is_pending_ai=1`, puis rejouée ultérieurement.
- Alignement SPEC : le flux “**Micro as Bulk(1)**” est **unifié** : micro/texte unitaire passent par le **séquenceur bulk** avec persistance **ventilée** (une seule “source de vérité”), et un `traceId` est propagé pour des logs cohérents.

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
- `services/captureStrategies/*` : stratégies “classiques” (task/habit/note/list/project) côté TalkDebug.
- `CaptureProcessingService.ts` : BackgroundFetch/TaskManager + queue AsyncStorage (jobs “analyse locale”).
- `services/intention/offlineAudioQueue.ts` : file offline texte/audio **en SQLite**, notifications, purge.
- `WhisperAdapter.ts` : transcription locale “best effort” via `whisper.rn` (si module dispo).

#### Données & persistance

- `api/trankilV2Db.ts` : **repository SQLite** (schema, writes sérialisées, queries Timeline, patchMetadata, quotas, etc.).
- `api/localDb.ts` : petit KV local (table `app_prefs`), lui aussi sérialisé.

#### IA Gemini

- `initializeGeminiEngine.ts` : initialise la shortlist de modèles.
- `geminiRemoteModelSteering.ts` : shortlist, cache, validations.
- `geminiSemanticLab.ts` : appels Gemini (stream/non‑stream), métriques tokens/latence/cost, fallback modèles.
- `geminiResponseGuards.ts` : parsing/guards.

#### “Sentinel” / Trafic (autre sous-système)

- `services/traffic/*` : scheduler, background service, notifications, distance matrix, activation, runtime, etc.

---

## 2) Pipeline de capture (texte/audio → SQLite)

> Vue “reverse-engineered” depuis les points d’entrée UI (TalkDebug/Timeline) et `IntentionContext`/`oneTap*`.

### 2.1 Entrée (UI) : texte et/ou audio

- `TalkDebugScreen.tsx` : écran principal de capture (debug-friendly) :
  - collecte un **transcript** (dictée/saisie) et parfois un **audioUri** (mémo).
  - déclenche le flux via `IntentionContext` (quand disponible) ou via `captureStrategies` (modes spécifiques).
- `IntentionContext.tsx` expose une API interne :
  - `startCapture()` / `cancelCapture()` : réinitialise les refs capture (sans funnel UI « streaming »).
  - `submitCapturePayload({ transcript, audioUri, lang, traceId? })` : **soumission** (post-dictée) ; en ligne, `await runGeminiBulkSequence` (Bulk(1) pour le micro).

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

- Prompt : construit via `buildCompressedGeminiPrompt()` et le seed `wireLineFromSkeleton(skeleton)`.
- Langue : `detectLangForOneTapPrompt()` puis discipline “zéro traduction” (contrat SPEC).
- Appel Gemini : `geminiSemanticLab` (stream ou non‑stream).
- Parsing modèle :
  - priorité au format **Bullet‑Pipe** (`parseBulletPipeIntentsFromBuffer`)
  - fallback JSON “best-effort” (`parseJsonIntentsFromBuffer`)
- Fusion : `mergeIntentArrayIntoOneTapSkeleton(...)` puis normalisation
  - normalisation des catégories inconnues → `PERSO`
  - normalisation temporelle (`normalizeUniversalTemporalInData`)
  - **Top-Down Sync** : recalcul `dueDateYmd/dueTimeHm` depuis `dueDateTime` via `syncYmdHmFromDueDateTime` (alignement SPEC)

Sortie : un `OneTapUniversalResult` enrichi + métadonnées HTTP (tokens, latence, coût).

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
- insertion : `insertTrankilV2Intention(...)` (repository)
- mutations `metadata_json` : via `patchMetadata(...)` (merge sécurisé, attendu par SPEC)

#### Pass 2 (LIST / PROJECT)

SPEC exige un enrichissement Pass 2 pour `LIST`/`PROJECT`.

Le repo contient le déclenchement dans `oneTapPersist.ts` (appel `geminiEnrichGenericList(...)`) et la persistance d’état (ex. `metadata_json.is_generating`, `list_enrich_status`, payload `list_scalable_v1` / `project_milestones_v1`).

#### NOTE_FALLBACK (résilience)

Si aucune intention persistable n’est extraite/persistée, `oneTapPersist.ts` peut créer une NOTE de fallback (label `NOTE_FALLBACK`) pour ne pas “perdre” la capture.

### 2.5 Offline-first : file locale + rejouage

Fichier : `src/services/intention/offlineAudioQueue.ts`

En cas de :
- offline (`NetInfo`), ou
- échec Gemini / parsing / persistance,

`IntentionContext` appelle :

- `queueOfflineAudioCapture({ transcript, audioUri, title, lang })` **ou**
- `queueOfflineTextCapture({ transcript, title, lang })`

Ce que fait la queue offline :

1. S’appuie sur la table `offline_audio_queue` (SQLite) + indexes déjà créées au bootstrap (`initTrankilV2Schema`).
2. Copie le fichier audio dans `documentDirectory/offline_queue/<uuid>.m4a` (si audio).
3. Insère une NOTE dans `intentions` :
   - `metadata_json.source = 'offline_audio_queue'`
   - `is_pending_ai = 1`
4. Ajoute une ligne de queue `offline_audio_queue(status='pending')`.
5. Notification : `notifyOfflineAudioPendingAnalysis()` (actions “Analyser / Garder audio”).

Rejouage :

- `IntentionContext.analyzeLatestOfflineAudio()` récupère un élément pending, le marque done, puis rappelle `submitCapturePayload(...)`.

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
  - `refineOneTapWithGeminiCompressed(...)` : Path B Gemini (prompt → parse → merge).
  - `parsePartialWireLine(buffer)` / `mergeWireIntoOneTapSkeleton(...)` : parsing “wire” (héritage + compat).
  - (internes critiques) `parseBulletPipeIntentsFromBuffer`, `parseJsonIntentsFromBuffer`, `mergeIntentArrayIntoOneTapSkeleton`.

### 3.2 Orchestration UI capture

- `src/context/IntentionContext.tsx`
  - `submitCapturePayload({ transcript, audioUri, lang, traceId? })` : pipeline micro/texte “unitaire” (NetInfo → `await runGeminiBulkSequence` ou queue offline).
  - `runGeminiBulkSequence(...)` : séquenceur bulk **séquentiel** avec **verrou strict** : échec ou exception sur le chunk *i* → `break` (pas de chunk *i+1*).
  - `proposeOfflineFallback(...)` : Alert UI + sauvegarde hors-ligne.
  - `triggerJalonZoom({ projectIntentionId, parentJalonUid })` : “zoom IA” d’un jalon projet (réutilise bulk(1) en mode enfant).

### 3.3 Persistance / Douane DB

- `src/services/oneTapPersist.ts`
  - `persistOneTapDraft(...)` : persistance unitaire (1 intention).
  - `persistOneTapDraftVentilated(...)` : persistance multi‑intentions (ventilation) + contrôle `allowNoteFallback`.
  - `preSaveOneTapOptimisticDraft(...)` / `finalizeOneTapOptimisticDraft(...)` / `replacePendingOneTapDraft(...)` : pipeline “optimistic row” (pré‑save puis finalisation).
  - (interne) `materializeOneTapIntentionRow(...)` : mapping OneTap → colonnes Trankil‑v2.

- `src/api/trankilV2Db.ts`
  - `bootstrapTrankilV2Database()` : init unique.
  - `initTrankilV2Schema()` : création tables + indexes + backfills.
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
- afin d’avoir : mêmes logs, mêmes verrous, même ventilation DB (`persistOneTapDraftVentilated`), mêmes règles d’échec chunk.

État actuel :

- `submitCapturePayload(...)` **attend** la fin de `runGeminiBulkSequence(...)` (`await`) : le même séquenceur couvre micro et texte.
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

- `TimelineScreen` / `TalkDebugScreen` : sur `INTENTION_PEEK_SNAPSHOT`, row `peek_pending` + ouverture peek **Path A** (`capturePeekPathAHeightPx`, ratio **~5 %** viewport via `CAPTURE_PEEK_PATH_A_RATIO`). **Gating focus** : `useIsFocused()` — si l’onglet n’a pas le focus, l’événement est ignoré (`logCaptureFlow` : `ui_peek_snapshot_skip_unfocused` / `ui_peek_first_save_skip_unfocused`) ; seul l’écran focalisé émet `ui_peek_snapshot` / `ui_peek_first_save`. Au blur d’un onglet qui portait encore un peek capture actif (`path_a` | `path_b` | `peek_pending`), fermeture locale (`ui_peek_capture_dismissed_unfocused_tab`) pour éviter une `Modal` résiduelle.
- Sur `INTENTION_PEEK_FIRST_SAVE`, hydration + peek **Path B** (`capturePeekPathBHeightPx`, ~25 %) **sans** fermer/réouvrir la sheet sur le même onglet (spring `peekTranslateY` uniquement).
- `IntentionDetailSheet` : entrée complète (opacity + translate) **uniquement** à `visible` false→true ; passage Path A→B = **spring** sur `peekTranslateY` sans ré-entrée (évite flash) ; props `peekCapturePhase`, `captureSheetMaxHeightRatio` (0.95 en flux capture), validation UI **Path B** ; hauteurs peek = ratios viewport (`capturePeekPathAHeightPx` / `capturePeekPathBHeightPx`, sans plancher px) ; full sheet = `windowHeight × ratio` (0,86 / 0,92 si source étendue, ou 0,95 capture), sans plancher 240 px ; auto-fermeture 4 s en Path B ; timer annulé par pan / full / focus `TextInput` ; slot 1 neumorphique + pastel par `category_id`.
- **Verrou Pass 2** : `metadata_json.pass2_unlocked` (bool). Tant que `false`/absent → fiche **Zen** (intercalaire, titre, moment, mémo) + CTA i18n par type. **PRO** : clic → `patchMetadata` + fondu vers UI complète (liste, jalons, itinéraire, Mission/Newton TRIP, etc.) ; Path B capture : même pose de `pass2_unlocked` avant enrich LIST/PROJECT.
- **Gating monétisation Pass 2 (SPEC §6)** — implémenté dans `IntentionDetailSheet` : `useUserSpectrum().spectrum.isProUser`. **FREE** : CTA Pass 2 avec suffixe i18n `pass2LockedSuffix` (🔒) ; clic → **aucune** écriture `pass2_unlocked`, **aucun** enrichissement Gemini ; redirection vers `ProSubscription`. **PRO** : comportement actuel (mutation + animation). Persistance `pass2_unlocked` inchangée côté PRO.
- Utilitaire : `src/utils/capturePeekLayout.ts`.

### 4.5 Offline-first : traitement ultérieur encore “semi-manuel”

Le contrat “mise en file offline pour traitement ultérieur” est présent, mais :

- le rejouage de `offline_audio_queue` est déclenché par interaction/notification (`analyzeLatestOfflineAudio()`), pas par un moteur automatique robuste (scheduler/worker).
- `CaptureProcessingService` (BackgroundFetch) traite une autre queue (AsyncStorage) et appelle seulement `analyzeLocally` (pas de ré-injection systématique OneTap/Gemini + persistance).

Si l’objectif produit est “zéro friction offline”, il manque une stratégie de replay automatique (avec garde-fous).

### 4.6 Instrumentation Pass 2 (logs) — à harmoniser

SPEC demande des logs explicites `[Pass2] START/SUCCESS`.

État actuel :

- Pass 2 semble implémenté dans `oneTapPersist.ts` (enrich LIST/PROJECT) mais l’instrumentation dédiée n’est pas clairement standardisée (à confirmer/ajouter).

---

## Annexes (repères pratiques)

### Fichiers à relire en priorité quand tu reprends le dev

1. `src/context/IntentionContext.tsx` (orchestration + verrous + offline)
2. `src/services/oneTapUniversalCapture.ts` (contrats prompt/parsing)
3. `src/services/oneTapPersist.ts` (mapping DB + Pass 2 + NOTE_FALLBACK)
4. `src/api/trankilV2Db.ts` (schéma, patchMetadata, sérialisation)
5. `src/services/intention/offlineAudioQueue.ts` (offline queue réelle en SQLite)

