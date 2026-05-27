# SPEC — Dev-trankil-v34 (TalknDone)

## Objectif produit

Dev-trankil-v34 est une application mobile orientée “one‑tap capture” : l’utilisateur dicte une pensée (tâche, déplacement, note, habitude, liste) et l’app la transforme immédiatement en intentions structurées, prêtes à être enregistrées.

Le flux OneTap vise :
- une capture très rapide (UI réactive en streaming),
- une extraction structurée déterministe (contrats de format),
- un fonctionnement multilingue (détection de langue + i18n),
- une continuité offline‑first (fallback quand le réseau/IA est indisponible) ; **urbanisation offline-first SPEC v34 : 100 % terminée** (file SQLite, peek-first, auto-queue réseau, harmonisation `NOTE_FALLBACK` métadonnées file, NetInfo « null reachable », logs `[OFFLINE-STABILITY]`).

Documents de référence :
- Démarrage & variables d’environnement : [README.md](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/README.md)
- Proxy Gemini & routage modèles : [MODELS_ROUTING_STRATEGY.md](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/docs/MODELS_ROUTING_STRATEGY.md)
- Contrat de stabilité OneTap : [STABILITY_SPEC_ONETAP_GEMINI.md](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/docs/STABILITY_SPEC_ONETAP_GEMINI.md)

## Architecture fonctionnelle (OneTap)

Le pipeline OneTap est “dual‑path” :
- Path A (local) : heuristiques synchrones (type, dates, signaux) pour un squelette immédiat.
- Path B (Gemini via proxy) : classification/structuration unitaire d’un chunk, puis fusion dans le squelette.

### 0) Logique de Traitement & Contrats IA

#### 0.a) Entretien d’Embauche (Benchmarking) — état réel du repo

Ce repo ne contient pas de “campagne de benchmark” formalisée (dataset, scorecards, notebooks, CI eval) ni de tests nommés “hallucination”.

Ce qui existe réellement comme routine de qualification/robustesse (terrain) :
- Probe “health check” multi‑modèles : l’écran Debug sonde une shortlist de modèles (ordre = candidats actuels) avec un prompt minimal `ok`, et retient le premier modèle répondant en HTTP 200. Voir [geminiModelHealthCheck.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiModelHealthCheck.ts).
- **Pilotage modèle Gemini (Remote Config + self-healing session)** — voir § **0.b)** ci-dessous.
- Script de smoke test proxy : `modelId: 'gemini-3.1-flash-lite'`. Voir [testGeminiProxyStream.mjs](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/scripts/testGeminiProxyStream.mjs).
- Observabilité par requête : modèle + latence par appel. Voir [geminiSemanticLab.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts).

“Test hallucinations” (réel) : il n’existe pas de routine dédiée. La protection implémentée est structurelle : parsing strict / tolérance limitée + refus implicite via fallback (voir Douane) quand la sortie ne respecte pas le contrat de forme.

#### 0.b) Steering modèle Gemini (Remote Config)

**Objectif** : changer le modèle IA en production **sans rebuild** (sauf modification du défaut compilé), avec résilience hors-ligne et auto-cicatrisation en session.

**Singleton RC** : [firebaseRemoteConfig.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/firebaseRemoteConfig.ts) — init unique (`minimumFetchIntervalMillis`, `defaultConfig`). Deux clés modèle avec défauts compilés : **`gemini_pass1_model_id`** (extraction) et **`gemini_pass2_model_id`** (raisonnement).

**Clés Firebase Remote Config**

| Clé | Rôle |
|-----|------|
| `gemini_pass1_model_id` | Modèle Pass 1 (extraction / capture One-Tap, warmup proxy) — défaut `gemini-3.1-flash-lite` |
| `gemini_pass2_model_id` | Modèle Pass 2 / Pass 3 / Expert / lab (raisonnement) — défaut `gemini-pro-latest` |
| `gemini_model_fallbacks` | CSV optionnel remplaçant la shortlist compilée pour la chaîne Pass 2 (ex. `gemini-pro-latest,gemini-3.1-flash-lite`) |
| `prompt_pass3_synth_v1` | Template system Pass 3 (Feuille de route) |
| `max_pins_count` | Plafond d’intentions épinglées dans l’Espace Sacré (Cockpit) — défaut compilé `2` via [`MAX_PINS_COUNT`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/config/appConfig.ts) |

**Chaîne de résolution (boot)**

1. Override Debug (`debug_override_model`, AsyncStorage, TTL 24 h) — prioritaire sur **Pass 2**
2. RC réseau (`fetchAndActivate` **OK**, **web uniquement**) → `gemini_pass1_model_id` + `gemini_pass2_model_id` ; sur **iOS/Android**, fetch réseau **court-circuité** (Option A) → `defaultConfig` compilé immédiatement
3. Session fallback Pass 2 (mémoire vive uniquement, après 503/404)
4. Défauts compilés : Pass 1 `gemini-3.1-flash-lite` · Pass 2 `gemini-pro-latest`

**Architecture Firebase (Option A — web JS SDK)**

Point d’entrée unique : [`src/config/firebase.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/config/firebase.ts) → interface `FirebaseProvider` :

| Module | Rôle |
|--------|------|
| [`firebaseWebProvider.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/config/firebaseWebProvider.ts) | Backend actif Expo/Hermes : `@firebase/app`, Auth (`getReactNativePersistence` + AsyncStorage), Firestore (`initializeFirestore` + `memoryLocalCache()`) |
| [`firebaseNativeProvider.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/config/firebaseNativeProvider.ts) | Option B — stub `@react-native-firebase/*` (non implémenté) |
| [`src/api/firebase.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/api/firebase.ts) | Façade deprecated — réexporte `config/firebase` |

**Remote Config mobile (Option A)** : le SDK web RC est **structurellement incompatible** avec Hermes sans IndexedDB (`@firebase/installations` exige `idb` pour `getId()` avant tout fetch REST). Aucun polyfill IDB n’est utilisé. Dans [`firebaseRemoteConfig.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/firebaseRemoteConfig.ts), si `Platform.OS !== 'web'`, `fetchAndActivateRemoteConfig()` retourne `false` sans appeler le réseau ; log boot : `[GEMINI-RC] Mobile détecté : fetch réseau ignoré, utilisation des défauts compilés`. Les clés sont lues via `defaultConfig` / `getRemoteConfigEntry` (source `default`).

**TODO (Option B)** : migrer vers `@react-native-firebase/remote-config` dans `firebaseNativeProvider.ts` pour réactiver le fetch réseau RC sur mobile ; activer via `EXPO_PUBLIC_FIREBASE_BACKEND=react-native-firebase` (voir commentaire identique dans `fetchAndActivateRemoteConfig`).

**Diagnostic RC (`__DEV__`)** : [`getRemoteConfigEntry`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/firebaseRemoteConfig.ts) expose `value` + `source` (`remote` | `default` | `static`). Logs `[GEMINI-RC]` au boot : init instance, skip mobile (Option A), ou après `fetchAndActivate` web (OK/ÉCHEC + message) ; avant Pass 2 via [`logPass2ModelSteeringDiagnostics`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiRemoteModelSteering.ts). [`ensureFreshPassModelsFromRemoteConfig`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiRemoteModelSteering.ts) re-tente un fetch si Pass 2 n’est pas encore sourcé depuis le réseau (**web** ; no-op fetch sur mobile).

**Nettoyage mai 2026** : suppression de [`firebaseIndexedDbGuard.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/api/firebaseIndexedDbGuard.ts) (patch IDB retiré — Firestore n’en dépendait pas ; RC mobile bascule sur Option A).

**Verrou avant appel réseau** : `awaitGeminiSteeringBeforeNetworkCall()` ([geminiSemanticLab.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts), [GeminiExpert.js](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/GeminiExpert.js)) attend `ensureGeminiRemoteModelInitialized()` avec **timeout 2 s** → fast-path Debug / défauts sans bloquer One-Tap.

**Self-healing session** : sur HTTP **404** ou **503** (ou 400 « model not found »), `excludeGeminiModelForSession(modelId)` alimente `sessionBannedModels` ; les appels Pass 2 ignorent ce modèle (`getGeminiCandidateModelIds`). Le fallback réussi reste **en mémoire** (`setGeminiSessionFallbackModelId`) — jamais persisté.

**Foreground refresh** : [App.tsx](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/App.tsx) écoute `AppState` (`background|inactive` → `active`) et lance `scheduleGeminiForegroundRemoteConfigRefresh()` (silencieux, non bloquant). Recharge Pass 1 / Pass 2 depuis RC sauf override Debug Pass 2 ou modèle banni en session.

**Bootstrap** : `initializeGeminiEngine()` au cold start ([App.tsx](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/App.tsx)) ; shortlist compilée appliquée à la chaîne Pass 2 seulement si `gemini_model_fallbacks` absent du RC. **Warmup proxy** : `warmGeminiProxySession()` préchauffe **Pass 1** (`getActivePass1ModelId()`).

**Proxy serveur** : fallback `modelId` = `gemini-3.1-flash-lite` si body absent ([functions/src/index.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/functions/src/index.ts)).

#### 1) Dual-Path (synchronisation des flux)

- Path A (heuristique locale) : extraction immédiate (signaux/regex + chrono-node) du type d’intention et de dates relatives simples afin de produire un placeholder UI (brouillon exploitable) sans réseau.
- Path B (Gemini unitaire) : envoi d’un chunk unique au proxy Gemini. Path B enrichit/rectifie les champs issus de Path A, sans casser les identifiants de suivi (l’ID d’intention généré côté app et les repères de progression restent stables).
- Autonomie réelle en cas de panne réseau/proxy :
  - **Avant** `NetInfo.fetch()` et tout appel Gemini, `submitCapturePayload` calcule le squelette Path A (`inferOneTapSkeletonFromTranscript`) et émet **`INTENTION_PEEK_SNAPSHOT`** : le peek s’affiche **aussi** en branche file offline (parité UX, feedback quasi immédiat). Ensuite seulement : si **`!isNetInfoConsideredOnline(net)`** (voir §2.c : `isConnected === true` **et** `isInternetReachable !== false` ; un `null` sur reachability **n’impose pas** la file tant que la connexion est déclarée), la capture est enfilée via `queueOfflineAudioCapture` / `queueOfflineTextCapture` (NOTE `is_pending_ai=1` + ligne `offline_audio_queue`), sans Path B.
  - **En ligne**, si Path B ou la persistance d’un chunk échoue avec une erreur **réseau ou serveur** (heuristique `isLikelyNetworkOrServerError` dans `offlineStability.ts`), le séquenceur **`runGeminiBulkSequence`** enfile **automatiquement** le transcript restant (ou le transcript complet + copie audio si aucun chunk n’a encore été persisté) dans la même file offline — l’utilisateur n’a pas à valider une Alert pour « sauver sa pensée » dans ce cas.
  - Les erreurs métier / validation (hors heuristique réseau) peuvent encore ouvrir **`proposeOfflineFallback`** (Alert optionnelle) lorsqu’aucune persistance ni enqueue auto n’a eu lieu.
  - **Rejouage** : `analyzeLatestOfflineAudio` n’appelle `markOfflineAudioAsDone` qu’**après** un `submitCapturePayload` ayant retourné `true` (donnée traitée ou re-file de façon sûre) ; sinon l’entrée `pending` est conservée.
  - **Observabilité** : logs console **`[OFFLINE-STABILITY]`** (`logOfflineStability`) pour enqueue auto, replay, branche offline directe et **`netinfo_online_null_reachable`** ; **`[CAPTURE_FLOW]`** via [captureFlowLog.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/captureFlowLog.ts) : journalisation console **`__DEV__`** + émission **`notifyCapturePipelineProgress`** (`CAPTURE_PIPELINE_PROGRESS_EVENT`, `DeviceEventEmitter`) à chaque `logCaptureFlow` pour corréler `traceId` (ex. micro) avec l’**overlay de progression global** ([`GlobalCaptureOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/GlobalCaptureOverlay.tsx) → [`useCapturePipelineOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useCapturePipelineOverlay.ts) + [`useAIProgressInertia`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useAIProgressInertia.ts) + [`AIUniversalProgressOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/AIUniversalProgressOverlay.tsx)) ; phases usuelles : `mic_stop_audio_done`, `mic_submit_invoke`, `submit_enter`, `submit_netinfo`, `peek_snapshot_emit`, `peek_snapshot_offline_queue`, `bulk_start`, `chunk_*`, `peek_first_save_emit`, **`bulk_network_resilience_enqueue`** (enqueue auto Vague 1), `submit_return_after_bulk`, `submit_offline_queued` (dont `reason: netinfo_offline`), **`transcript_edit_start`**, **`transcript_manual_edit`** (correction STT optionnelle avant envoi), etc.
- Cycle de vie du titre (critique) :
  - Path A (heuristique locale) : génère un titre “bruit” (brut ou via heuristiques simples) uniquement pour l’affichage immédiat.
  - Path B (Gemini) : fournit le Smart Title définitif via son champ `CONTENT`.
  - Règle de conflit : dès que Path B répond, `CONTENT` devient la source de vérité absolue. Le client ne fait aucun nettoyage lexical/regex sur `CONTENT` (à part formatage de surface : trim/majuscule) ; si le titre est “sale”, on corrige le prompt, pas le code.

#### 2) Recette du prompt Pass 1 — Few-Shot JSON universel

**Source de vérité code** : [`buildOneTapPass1SystemInstruction(now)`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapUniversalCapture.ts) · [`buildOneTapPass1UserContent(transcript, seedLine, now)`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapUniversalCapture.ts) · orchestration [`refineOneTapWithGeminiCompressed`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapUniversalCapture.ts).

L'instance `now = new Date()` est créée **une seule fois** par capture et passée aux deux builders — cohérence few-shot / `NOW:` utilisateur.

> **Prompt universel** : même contrat pour tous les modèles Pass 1. Legacy Bullet-Pipe conservé (`buildOneTapPass1SystemInstructionLegacy`) pour rollback.

##### 2.a) Architecture transport (proxy Firebase)

| Rôle | Contenu | Envoyé comme |
|------|---------|--------------|
| **System instruction** | Règles + 6 few-shots multilingues + schéma sortie | `body.systemInstruction` |
| **User turn** | `NOW` + fuseau + `SEED` + `INPUT` | `request.contents[0].parts[0].text` |

- **Modèle** : `getActivePass1ModelId()` → RC `gemini_pass1_model_id` (défaut `gemini-3.1-flash-lite`).
- **Operations** : `oneTap.wire.stream` (micro) · `oneTap.wire.nonstream` (bulk).
- **`generationConfig`** : `maxOutputTokens: 2048` · `temperature: 0` (stream) · **sans** `responseMimeType`.
- **Logs dev** : [`logAiInteraction`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/logAiInteraction.ts) pass 1 / `EXTRACTION`.

##### 2.b) System instruction — texte (structure)

Ligne 1 (heure locale, jamais UTC) :

```
NOW: YYYY-MM-DD HH:mm | <weekdayEn> | <IANA tz>
Use NOW as the authoritative current time. All relative dates ("demain", "in 2h", weekday names) must be resolved from NOW.
```

Bloc `RULES:` (valeurs injectées dynamiquement) :

```
RULES:
- Language: detect from input → output ONLY in that language. ZERO translation.
- CATEGORY: exactly one of HOME WORK PERSO HEALTH FINANCE TRAVEL SOCIAL SHOP LEARN OTHER
- CONTEXT: one UPPERCASE token (BUREAU EXTERIEUR CANAPE MAISON or custom). null if truly unknown.
- CONTENT: pure action title — strip ALL time/date words. Fix typos. Start Uppercase.
- TRIP: any movement → type=TRIP. Trigger words: <TRIP_TRIGGER_TERMS EN+FR+extra>. Use field "destination" + "arrivalDue".
- HABIT: any recurrence → type=HABIT. Use **recurrence_rule** object (never `due` on HABIT). Fields: `frequency` (MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY), `interval` (≥1), `time_target` ("HH:mm" if time mentioned), `byWeekday` (1=Mon..7=Sun, weekly), `dayOfMonth` (monthly), `duration_minutes` (minutely windows), `raw_phrase` (verbatim recurrence fragment).
- LIST: ONLY for complex shopping, recipes, project materials, or explicit requests for a multi-item inventory (e.g., "fournitures scolaires", "party supplies"). → type=LIST, fields "title" + "baseCount".
- PROJECT: any multi-step objective → type=PROJECT, field "content".
- TASK: default for one-off actions, including single-item purchases or simple enumerations (e.g., "acheter de la colle", "buy milk and eggs"). → type=TASK, field "content".
- due / arrivalDue: "YYYY-MM-DD HH:mm" local 24h. null if no time mentioned. **Never on HABIT** — clock time goes in `recurrence_rule.time_target`.
```

**6 exemples few-shot** (multilingues FR/EN/ES — langue d'entrée = langue de sortie ; dates calculées depuis `now`) :

| Input | Output JSON (résumé) |
|-------|---------------------|
| `"Acheter de la colle"` | `TASK` · `content:"Acheter de la colle"` · `SHOP` · `MAISON` |
| `"Materials to repaint the bedroom"` | `LIST` · `title:"Repaint the bedroom"` · `baseCount:1` · `SHOP` · `MAISON` |
| `"Comprar huevos y leche"` | `TASK` · `content:"Comprar huevos y leche"` · `SHOP` · `MAISON` |
| `"Courses pour le barbecue de samedi"` | `LIST` · `title:"Barbecue"` · `baseCount:1` · `SHOP` · `EXTERIEUR` |
| `"Packing list for the ski trip"` | `LIST` · `title:"Ski trip packing"` · `baseCount:1` · `TRAVEL` · `MAISON` |
| `"Meeting with John in 2h"` | `TASK` · `content:"Meeting with John"` · `due:"<now+2h>"` · `WORK` · `BUREAU` |
| `"Faire la vaisselle tous les jours a 15h"` | `HABIT` · `content:"Faire la vaisselle"` · `recurrence_rule:{frequency:"DAILY",interval:1,time_target:"15:00",raw_phrase:"tous les jours a 15h"}` · `PERSO` · `MAISON` |
| `"Yoga every Monday at 8am"` | `HABIT` · `content:"Yoga"` · `recurrence_rule:{frequency:"WEEKLY",interval:1,byWeekday:1,time_target:"08:00"}` · `HEALTH` · `MAISON` |

Clôture :

```
Reply ONLY with a single raw JSON object. No markdown. No explanation. No text before or after.
Schema: {"intents":[{"type":"…","content":"…","due":"…","category":"…","context":"…","recurrence_rule":{…}}]}
```

> Les clés `title`, `baseCount`, `destination`, `arrivalDue`, `recurrence_rule` sont apprises via les **exemples**, pas listées dans le schéma minimal (évite fusion littérale sur Lite).

##### 2.c) Corps utilisateur

```
NOW: <formatLocalYYYYMMDDHHmm(now)>
TZ: <tz> | <weekdayEn> | weekday=<1..7>
SEED: <wireLineFromSkeleton>
INPUT: """<transcript max 12 000c>"""
```

- `SEED` = [`wireLineFromSkeleton`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapUniversalCapture.ts) : `P:<type>|K:<category>|T:<title≤90>|…` (+ `D:`/`H:`/`L:`/`C:`/`V:` selon type Path A).
- Anti-injection : `"""` internes → `""` ; pas d'échappement `"` sur guillemets simples.

##### 2.d) Champs intent par TYPE

| TYPE | Champs clés | Note produit |
|------|-------------|--------------|
| `TASK` | `content`, `due?`, `category`, `context?` | achat ponctuel, énumération simple (ex. « acheter des œufs ») |
| `TRIP` | `destination`, `arrivalDue?` | logistique |
| `LIST` | `title`, `baseCount` | inventaire multi-items, recette, fournitures — coquille vide · Pass 2 manuel |
| `PROJECT` | `content` (ou `title`) | objectif multi-étapes · coquille vide · `unitLabel` défaut `etape` · jalons Pass 2 manuel |
| `HABIT` | `content`, `recurrence_rule` | blob structuré dans `metadata_json` · pas de `due_date` SQLite · coercition défensive si Gemini renvoie encore `recurrence`+`due` ([`coerceRecurrenceRule`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/habitRecurrenceRule.ts)) |
| `NOTE` | `content` | |

Hiérarchie spec (non répétée dans le prompt) : `PROJECT` → `LIST` → `HABIT` → `TRIP` → `TASK`.

##### 2.e) Habitudes — `recurrence_rule` + évaluation JIT (Living Hub)

**Principe** : pas de colonne SQLite dédiée ni de moteur RRULE global à la capture. Gemini remplit un blob **`metadata_json.recurrence_rule`** ; la persistance est un **pass-through** ([`buildHabitMetadataFields`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapPersist.ts)). Le calcul « est-ce actif aujourd’hui ? » se fait **juste-à-temps** à l’affichage.

**Contrat `recurrence_rule`** (exemple) :

```json
{
  "frequency": "DAILY",
  "interval": 1,
  "time_target": "15:00",
  "raw_phrase": "tous les jours a 15h"
}
```

Fréquences : `MINUTELY` · `HOURLY` · `DAILY` · `WEEKLY` · `MONTHLY` (+ `byWeekday`, `dayOfMonth`, `duration_minutes` selon le cas).

**Modules** :

| Rôle | Fichier |
|------|---------|
| Coercition défensive (legacy `recurrence` + `due` → rule) | [`habitRecurrenceRule.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/habitRecurrenceRule.ts) |
| Évaluateur JIT (`isHabitActiveForDate`) | [`habitRecurrenceEvaluator.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/habitRecurrenceEvaluator.ts) |
| Injection virtuelle hub (groupBy `category_id` + habitudes JIT) | [`buildLivingHubBlocks.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/buildLivingHubBlocks.ts) |
| Source SQL habitudes actives | [`listActiveHabitsForHub`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/api/trankilV2Db.ts) |

**Hors scope immédiat** : rappels expo-notifications / `alarmManager` / expansion calendrier — consommeront la même rule plus tard.

#### 3) Traitement de sortie (Douane & normalisation)

La “Douane” OneTap est distribuée sur deux étages réels :

1) Douane de parsing (côté capture, avant persistance) — [oneTapUniversalCapture.ts](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts)
- Parse de la sortie modèle — **JSON en priorité, Bullet-Pipe en filet de sécurité** :
  - **JSON (priorité)** : [parseJsonIntentsFromBuffer](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L517-L623) avec parse best‑effort (`tryParseJsonObjectBestEffort` padding de `}`, `stripJsonFences` pour les backticks). Types supportés : `TASK`, `TRIP`, `NOTE`, `HABIT`, `LIST`, **`PROJECT`** (mai 2026 — `title ← title ?? content`, `unitLabel` défaut `etape`, aligné sur le prompt Pass 1 et le Bullet-Pipe). Protection trailing garbage : `lastIndexOf('}')` appliqué **uniquement en mode non-stream** (`!partial`) pour éviter la troncature sur des fragments incomplets en streaming.
  - **Bullet-Pipe (fallback silencieux)** : [parseBulletPipeIntentsFromBuffer](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L319-L380) — activé **uniquement si le buffer ne contient aucun `{`** (le modèle a totalement ignoré l'instruction JSON). Si `{` est présent et que JSON retourne `[]`, on fait confiance au résultat vide — déclencher Bullet-Pipe créerait des fausses intentions depuis du texte d'excuse markdown.
- Normalisation de catégorie : unknown → `PERSO` via [normalizeOneTapCategoryCode](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts).
- Normalisation de contexte : `normalizeOneTapContextTag` ; **ExtractionResult** ; brouillon `categoryTag` + `contextTag` ; `[DOUANE]` / `[CAPTURE_FLOW] pass1_bullet_pipe_resolved`.
- Fusion réelle Path B → Path A :
  - fusion d’une liste d’intents dans le squelette : [mergeIntentArrayIntoOneTapSkeleton](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts) — **`clearPass1MergedIntentFields`** efface list/trip/due/notes à **chaque** itération ; en bulk, seule la **dernière** intention du tableau pilote `predictedType` / titre / champs top-level du squelette (évite la fuite TRIP→LIST en streaming partiel). **LIST / PROJECT** : titre depuis `title ?? content` ; `project_mode: true` pour PROJECT ; `unitLabel` défaut `personne` (LIST) / `etape` (PROJECT).
  - titre affichable (strict) : le titre final est `CONTENT` (nettoyé par l’IA via prompt) et ne subit pas de post-processing lexical/regex côté client (seulement trim/majuscule).
  - normalisation temporelle (dueDateTime ISO, recurrence null si vide, logisticsPotential) : [normalizeUniversalTemporalInData](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L165-L220) + [`parsePass1DueDateTime`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/pass1DueDateParse.ts) (Hermes-safe, `timeMarker`).
  - Top-Down Sync (Gemini patron) : si Path B met à jour `dueDateTime` (ou `arrivalDue`), le client recalcule `dueDateYmd` + `dueTimeHm` + `timeMarker` via `parsePass1DueDateTime` (pas de `new Date(iso)` naïf sur chaînes à espace) afin d’éviter toute divergence avec les heuristiques Path A (chrono-node).
- Si aucune intention n’est extraite : le brouillon final reste le squelette Path A (pas de NOTE_FALLBACK à ce stade), avec logs debug éventuels : [refineOneTapWithGeminiCompressed](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L1236-L1378).

2) Douane de persistance (côté DB) — [persistOneTapDraftVentilated](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapPersist.ts#L893-L1281)
- Entrée : `draft.data.intents` (si présent) ou les champs “mono‑intention” (`data.list`, signaux temporels, logistique…).
- Traitement : boucle `intents[]` → drafts avec `categoryTag` / `contextTag` → SQLite `category_id` (non-null) + `context_tag` ([materializeOneTapIntentionRow](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapPersist.ts), [insertTrankilV2Intention](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/api/trankilV2Db.ts)) ; migration `ALTER TABLE intentions ADD COLUMN context_tag` ; log `[DATABASE] ✅ Intention sauvée avec succès | Category: … | Context: …`.
- Enrichissement Pass 2 (LIST / PROJECT) — **strictement à la demande** :
  - **Aucun** lancement **automatique** ni **immédiat** de Pass 2 après Pass 1 (ni dans la Douane de persistance, ni dans le séquenceur bulk, ni au moment de l’insertion SQLite). Le Pass 2 (ex. `geminiEnrichGenericList`) ne s’exécute **que** lorsque l’utilisateur **PRO** a persisté **`metadata_json.pass2_unlocked === true`** puis déclenché l’action métier associée (CTA « Enrichir » / libellés `intentionDetail.pass2*` — voir **Verrou sémantique** / Capture Flash).
  - **Déclenchement** : uniquement à ce moment-là ; avant toute intention `LIST` / `PROJECT` reste en base avec les seules données Pass 1 (pas de `list_enrich_status = 'pending'` imposé par la capture seule).
  - Pendant l’appel Pass 2 : écrire `metadata_json.is_generating = true` et `metadata_json.list_enrich_status = 'pending'`.
  - Après succès : écrire `metadata_json.is_generating = false` et `metadata_json.list_enrich_status = 'done'` + payload `list_scalable_v1` (ou équivalent PROJECT).
  - Après échec : écrire `metadata_json.is_generating = false` et `metadata_json.list_enrich_status = 'error'` (+ `list_enrich_error`).
- Gestion du vide / malformé (NOTE_FALLBACK) :
  - Si `intents[]` existe mais qu’aucune entité n’a pu être persistée : si `allowNoteFallback !== false`, création d’un draft NOTE avec `memo = transcript` et persistance sous label `NOTE_FALLBACK` : [oneTapPersist.ts:L1167-L1186](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapPersist.ts#L1167-L1186).
  - Si aucun résultat n’a été persisté après les branches list/temporal/trip : même fallback NOTE_FALLBACK : [oneTapPersist.ts:L1261-L1277](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapPersist.ts#L1261-L1277).

#### 4) Format de persistance final

- Les champs persistés doivent impérativement être alignés sur le schéma SQLite Trankil‑v2 (ex. `due_date`).
- `due_date` (SQLite) est un **jour clé** au format `YYYY-MM-DD` (date locale) utilisé pour la Timeline (filtre/tri par jour).
- L’heure / timestamp précis (quand applicable) est porté par `metadata_json` (ex. `dueDateTime`, `dueTimeHm`, `trip.arrivalDue`).
- IA & coûts (SQLite) :
  - Les tokens doivent être persistés dans `intentions.tokens_prompt`, `intentions.tokens_completion`, `intentions.tokens_total` (INTEGER).
  - Le coût estimé doit être persisté dans `intentions.cost` (REAL, USD) et non dans un champ `ai_cost_usd` (qui n’existe pas en DB). Le payload OneTap peut porter `ai_cost_usd`, mais il doit être mappé vers `cost` avant insertion.
  - Contrat d’insertion : toute modification du schéma (ajout de colonne) doit s’accompagner d’un alignement strict entre `INSERT INTO intentions (colonnes...)` et `VALUES (...placeholders...)`. Un mismatch (`37 values for 38 columns`) invalide la persistance et rend les intentions invisibles dans la Timeline.

### 1) Règle de découpage local (client-side splitting)

Le découpage “bulk” ne repose plus sur l’IA mais sur le code client.

- Déclencheur : présence du séparateur `**` dans le texte brut (dictée ou saisie).
- Principe : le client intercepte le texte brut et le découpe en un tableau de chunks (trim + suppression des vides).
- Composant responsable : [oneTapUniversalCapture.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapUniversalCapture.ts) (capture/parsing) et orchestration côté UI via [IntentionContext.tsx](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/context/IntentionContext.tsx).

### 2) Protocole du séquenceur (sequential processing)

Mode de traitement : boucle asynchrone séquentielle, une intention à la fois.

- Mode stable (unitaire séquentiel) : chaque chunk est traité de bout en bout (Gemini → Douane → DB) avant de passer au suivant.
- Règle d’or : l’appel N+1 vers Gemini ne démarre qu’après confirmation de succès DB (SUCCESS_DB) de l’appel N.
- Isolation : chaque chunk est envoyé à Gemini comme une requête atomique (Path B standard). Objectif : fiabilité maximale du format JSON/structuré et réduction du risque de sorties trop longues, tronquées ou ambiguës.
- Mécanisme de survie : un échec sur un chunk est logué et ne bloque pas le traitement des chunks restants.
- Fallback NOTE automatique (selon `allowNoteFallback`) : si Gemini ne parvient pas à produire d’intentions persistables, `persistOneTapDraftVentilated` peut créer une intention `NOTE_FALLBACK`. Ce fallback est activé par défaut, mais le séquenceur bulk le désactive explicitement (`allowNoteFallback: false`) et préfère alors un échec de chunk + mécanisme offline (auto-queue réseau ou Alert / file) au niveau séquenceur. Voir [oneTapPersist.ts:L1167-L1186](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapPersist.ts#L1167-L1186) et `runGeminiBulkSequence` dans [IntentionContext.tsx](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/context/IntentionContext.tsx).
- Verrouillage de progression : en mode bulk, l’index de progression (ex. 2/5) est mis à jour immédiatement après le succès DB afin de refléter l’état réel de la persistance (et non l’état de l’appel réseau).

#### Verrou de persistance (Persistence Lock)

Ce verrou garantit que le séquenceur ne lance jamais le chunk N+1 tant que la persistance du chunk N n’est pas confirmée.

- Contrat de résolution : [persistOneTapDraftVentilated](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapPersist.ts) est une fonction async (Promise). Elle ne “libère” le séquenceur qu’après confirmation d’écriture dans le stockage persistant.
- Multi-intentions par chunk : si Path B renvoie un tableau d’intentions pour un seul chunk, le verrou de persistance attend la sauvegarde de l’ensemble du tableau (toutes les écritures SQLite) avant de libérer le séquenceur.
- Gestion du flux : le séquenceur UI attend strictement `await persistOneTapDraftVentilated(...)` avant de passer au chunk suivant.
- Sécurité : un `finally` doit garantir que les drapeaux de traitement (ex. `isProcessing` / index de progression) ne restent jamais bloqués en cas d’erreur mineure.
- Feedback de verrou : un log système doit signaler la confirmation de persistance (ex. `[DATABASE] ✅ Persistance confirmée pour <ID>`).
- Gestion des erreurs (persistance) : pas de timeouts applicatifs codés en dur dans la persistance (pas de `setTimeout(12s)` masquant une panne). La persistance remonte l’erreur réelle (SQLite, contraintes, etc.) et le séquenceur applique le mécanisme de survie.

### 2.b) Standardisation base de données (Trankil-v2)

- Outils de maintenance (debug) : les actions “Reconstruire la base” et “Vider la base” ciblent uniquement `intentions` (SQLite `talkndone.db`) en exécution séquentielle (table par table) via le wrapper singleton `withTrankilV2Database`.
- Vidage manuel (debug) : le vidage exécute `DELETE FROM intentions;` après confirmation utilisateur, puis journalise un feedback `[DATABASE] 🧹 Base vidée avec succès`.
- Schéma : la source de vérité est la table SQLite `intentions` (Trankil‑v2). Les noms de colonnes sont stabilisés, notamment `due_date` (à utiliser partout côté Douane / insertions pour éviter tout conflit futur).
- Format : `due_date` est stocké en `YYYY-MM-DD` (date locale), et sert de pivot pour le groupement/tri de la Timeline.
- Initialisation atomique : interdire l’exécution du schéma SQL en un seul bloc géant via `execAsync`. L’initialisation doit exécuter les opérations séquentiellement (table par table, index par index) afin de limiter les timeouts au premier démarrage.
- Auto-réparation (healthcheck) : exécuter un test d’écriture/lecture `System Ready` immédiatement après l’ouverture/initialisation. Si ce test échoue (timeout natif, `NativeDatabase.prepareAsync` rejeté / NPE), lever une exception bloquante plutôt que de laisser le séquenceur tourner à vide.
- Mode de persistance : l’écriture est locale (SQLite `talkndone.db`) et constitue la source de vérité (base unique).
- Sécurité production : aucune suppression du fichier DB (ex. `deleteDatabaseAsync`) n’est exécutée au démarrage. Toute purge de données éventuelle doit rester une action explicite (debug/outils), jamais un comportement automatique.
- Migrations vs purge : le bootstrap DB peut exécuter des `DROP TABLE ...` uniquement dans des chemins de migration/normalisation de schéma (ex. contraintes `ARCHIVED`, ajout du type `LIST`) et non comme “purge périodique”. Voir [trankilV2Db.ts:L774-L843](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/api/trankilV2Db.ts#L774-L843) et [trankilV2Db.ts:L936-L1005](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/api/trankilV2Db.ts#L936-L1005).
- Hard Reset manuel (debug) : un “factory reset” existe et efface SQLite + préférences + notifications sur action utilisateur confirmée (double confirmation). Implémentation : [factoryReset.ts:L7-L18](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/factoryReset.ts#L7-L18). Déclenchement UI : [DebugScreen.tsx:L153-L173](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/screens/DebugScreen.tsx#L153-L173) puis exécution [DebugScreen.tsx:L133-L151](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/screens/DebugScreen.tsx#L133-L151).
- Instance singleton & re-open : l’instance SQLite est maintenue en singleton côté JS. En cas de `NativeDatabase.prepareAsync` rejeté (ou NPE natif), le système invalide l’instance courante et force une réouverture propre de la connexion avant de retenter l’opération.
- Stabilité Android (New Architecture) : le bootstrap SQLite ne doit jamais bloquer l’UI. En cas de stall SQLite au démarrage, l’app continue à afficher l’interface, et l’initialisation DB reste best-effort en arrière-plan.
- Stratégie anti-deadlock : sérialiser **toutes** les opérations async SQLite côté JS (`runAsync`, `execAsync`, **`getFirstAsync`**, **`getAllAsync`**) via une queue unique (`runSerializedSqlite` dans [`trankilV2Db.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/api/trankilV2Db.ts)). Seules les écritures sérialisées provoquaient des race conditions avec les lectures concurrentes (ex. `patchMetadata` UI vs reconcile Sentinel → crash `prepareAsync rejected`). Les lectures critiques Sentinel passent aussi par `withTrankilV2Database` (ex. `getTrankilV2IntentionById`).

### 2.c) Refonte DB Local-First / Cloud-Ready (Snapshot + Sync asynchrone)

Objectif : préparer une synchronisation multi-appareil fiable (Firebase) en partant d’une base “propre” réinstallée à froid (suppression des données existantes sur mobile), sans conserver la logique de migrations historiques.

#### 2.c.1) Principes

- Local-first : SQLite reste la source de vérité locale. Le cloud est un miroir asynchrone (push/pull).
- Identifiants universels : toutes les entités métier non-singleton utilisent `id TEXT PRIMARY KEY NOT NULL` avec génération UUID v4 **canonique** (format `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`) côté client.
- Gènes de synchronisation : chaque table métier embarque `updated_at INTEGER NOT NULL` (millisecondes), `is_dirty INTEGER NOT NULL DEFAULT 0`, `server_version INTEGER NOT NULL DEFAULT 0`.
- Résolution de conflits : “Last Write Wins” sur `updated_at` (ms). `server_version` est gardé pour une stratégie future plus riche.

#### 2.c.2) Unification du schéma (bootstrap)

- Interdiction de “bloc mort” dans l’initialisation : tout schéma nécessaire (identity, billing, logs, etc.) est créé au démarrage dans le flux principal.
- Définition canonique unique : une seule définition par table (pas de doublons).
- Standardisation des PK : toutes les tables non-singleton ont un PK en `TEXT`. Les tables singleton conservent un PK stable (`id INTEGER PRIMARY KEY CHECK (id = 1)`) et reçoivent aussi `updated_at/is_dirty/server_version`.

#### 2.c.2.b) Périmètre des tables synchronisables

- Inclus dans la standardisation et la sync : toutes les tables “données utilisateur”, y compris `sentinel_trips`, `location_favorites`, `offline_audio_queue` (et les tables “identity/billing”).
- Exclu (local-only) : logs techniques `emergency_logs`, `user_activity_logs` (ils peuvent rester locaux et ne pas être inclus dans les snapshots cloud).

#### 2.c.3) Écritures sérialisées (atomicité)

- Queue d’écriture : toutes les opérations d’écriture sur `talkndone.db` passent par un exécuteur sérialisé (calqué sur [localDb.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/api/localDb.ts#L12-L31)).
- Toute mutation métier doit :
  - être exécutée dans une transaction SQL,
  - mettre `updated_at = nowMs`,
  - mettre `is_dirty = 1` (sauf écritures issues du cloud, voir 2.c.3.b).

#### 2.c.3.b) Robustesse du flag `is_dirty` (anti “sync infinie”)

- Problème : lors d’un “pull” cloud → local, une écriture SQLite qui met `is_dirty = 1` déclenche ensuite un push local → cloud, provoquant une boucle.
- Règle : toutes les API d’écriture doivent accepter un paramètre optionnel de provenance, ex. `fromSync?: boolean` (défaut `false`).
- Comportement :
  - `fromSync === false` : écriture locale normale → `is_dirty = 1`.
  - `fromSync === true` : écriture issue du cloud → `is_dirty` reste `0` (et ne doit pas ré-enfiler l’objet dans la file de push).
- Application : cette règle s’applique aussi à la mutation de `metadata_json` (patch/merge) : un patch cloud ne doit jamais “salir” une ligne.

#### 2.c.4) Mutation sécurisée de `metadata_json`

- Interdiction d’un `UPDATE ... SET metadata_json = ?` qui écrase l’intégralité sans lecture préalable.
- API canonique : `patchMetadata(id, partialObject, opts?: { fromSync?: boolean })` :
  - démarre une transaction,
  - lit `metadata_json` actuel,
  - deep-merge avec `partialObject`,
  - écrit le JSON résultant + `updated_at` + `is_dirty` (1 si local, 0 si `fromSync=true`).
- Règle : toutes les features (IA, édition utilisateur, logistique, retry offline) passent par `patchMetadata`.

#### 2.c.5) Timeline & tables futures

- Table Timeline : il n’existe pas de table `timeline` en SQLite dans l’état actuel ; la Timeline est une projection/requête sur `intentions`.
- Synthèse quotidienne **Feuille de Route (Pass 3)** : table `daily_summaries` (`id`, `summary_date`, `content_html`, `created_at`) pour le HTML généré ; pas une projection Timeline mais un artefact lié au jour courant (voir § Architecture UI — Feuille de Route).
- Habitudes (futur) : `habit_logs` doit inclure une contrainte `UNIQUE(intention_id, business_date)` pour prévenir les doublons lors des imports cloud.

#### 2.c.6) Billing : règle “Premium collant” (anti régression multi-appareil)

- Contexte : `user_billing_state` est une table singleton critique (statut Premium / features).
- Risque : un appareil offline “ancien” peut écraser un statut Premium récent si la résolution de conflit est un LWW aveugle sur `updated_at`.
- Règle de fusion : le statut Premium est “collant” :
  - si l’une des deux versions (local vs cloud) est Premium, le résultat final doit être Premium, indépendamment de `updated_at`.
  - les autres champs (quotas, compteurs) peuvent rester en LWW ou règles dédiées, mais **le Premium ne doit jamais régresser** via une sync.

#### 2.c.7) UUID v4 et performance SQL (indexation)

- UUID v4 : générer des UUID v4 canoniques via une librairie standard (pas de `Date.now() + random`).
- Indexation : en plus de l’index implicite de la PK, créer des index dédiés pour les colonnes de jointure/lookup fréquentes.
  - Exemple attendu (futur) : index sur `habit_logs.intention_id` + contrainte `UNIQUE(intention_id, business_date)` (déjà actée en 2.c.5).

### 3) Feedback utilisateur (UI/UX)

L’interface doit refléter la progression du séquenceur (ex. “Création de 2/5…”).

- Succès : progression incrémentale + feedback au fur et à mesure des confirmations DB.
- Échec : message/log contextualisé sur le chunk concerné (sans stopper la boucle).

### 4) Nettoyage du code mort

Le flux OneTap doit éviter toute complexité liée au parsing de streaming multi-intentions côté IA.

- Les protocoles de découpage “côté modèle” et le parsing de flux multi-intentions ne font plus partie du contrat.
- Le système revient à de la classification unitaire simple (1 chunk → 1 requête Gemini → 1 persistance).

### 5) Protocole de logging (harmonisé)

- Les logs bulk (séquenceur) utilisent un gabarit visuel aligné avec les captures unitaires (bannières + tags `[SEQUENCER]`, `[DATABASE]`, `[GeminiAPI]`, `[DOUANE]`), afin de garder une observabilité homogène entre OneTap simple et bulk.
- Les mentions de protocoles temporaires (purge auto, debug-only) ne font pas partie de l’état stable.

### 6) Découplage des alarmes

- `syncAfterIntentionWrite` (synchronisation des notifications système / alarmes natives) est une opération non-critique et fire-and-forget. Elle ne doit jamais retarder la persistance ni le traitement du chunk suivant.

---

## IntentionDetailSheet — Hiérarchie Progressive (Trajets)

Objectif : réduire la friction sur les trajets en introduisant une hiérarchie progressive à 3 niveaux, sans dégrader le flux “Note” validé.

### Niveau 1 — Capture (déjà validé, ne pas modifier)
Mode par défaut (équivalent “Note”) :
- Afficher uniquement : **Titre**, **Note**, **Moment** (Date ou Jour/Heure).
- Aucune exigence de destination/transport/surveillance trafic à ce niveau.

### Niveau 2 — Engagement
Ajouter un switch i18n :
- Libellé : `intentionDetail.remindToLeave` (à créer si absent)
- Intention UX : “Me prévenir quand partir”

Contrat fonctionnel :
- OFF (par défaut) : le trajet reste en mode simple, aucune UI “Mission” n’est affichée.
- ON : déverrouille le bloc “Mission” (Niveau 3).

Persistance :
- Stocker l’état dans la ligne intention (colonne SQLite existante) : `intentions.remind_to_leave` (0/1).
- Miroir optionnel dans `metadata_json.trip.remindToLeave` si nécessaire pour compat UI, mais la source de vérité DB reste `remind_to_leave`.

### Niveau 3 — Mission (masqué par défaut)
Le bloc “Mission” ne s’affiche que si `remind_to_leave` est ON.

Contenu du bloc :
- Sélecteurs destination (adresse validée) + origine si exposée dans l’UI actuelle
- Sélecteur du mode de transport
- Pill **créneau élastique** (PRO uniquement, après PROBE1) : `[ borne basse – borne haute ]`

#### Surveillance trafic — Créneau élastique (remplace Newton)

**Modèle v34 (mai 2026)** : un seul interrupteur **`remind_to_leave`** (*Me prévenir quand partir*), réservé **PRO**. Plus de switch « Activer Newton » séparé.

Conditions minimales « surveillable » :
- **Adresse valide** (destination) :
  - `trip.location_place_id` non vide
  - `trip.location_lat` et `trip.location_lng` finies
  - `trip.location_address` non vide
- **Heure d’arrivée précise** :
  - `metadata_json.trip.arrivalDue` ou `metadata_json.trip.dueDateTime` défini (ISO)
  - et `meta.is_all_day` == false (donc pas « All Day »)

**FREE** : activation du rappel → redirection paywall `ProSubscription` (pas de créneau ni sondes).

#### Formules mathématiques — Créneau élastique (Contrat de Départ)

Stratégie **Pessimiste Prédictif auto-calibré** : marge de risque adaptative via ratio `D` (plus de paliers α fixes), ancrage unidirectionnel, hystérésis UI 5 min, PROBE3 conditionnel.

Implémentation : [`elasticSlotEngine.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/elasticSlotEngine.ts), orchestration [`trafficSchedulerElasticTick.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/trafficSchedulerElasticTick.ts).

**Notation**

| Symbole | Unité | Définition |
|---------|-------|------------|
| `T_arr` | ms | Heure d’arrivée cible (`arrivalDue` / `dueDateTime`) |
| `T_ideal` | min | Durée **statique** (`duration`, sans trafic) — `standard_duration_min` |
| `T_pred` | min | Durée **prédictive** (`duration_in_traffic` à `departure_time` PROBE1) — `elastic_predicted_duration_min` |
| `D` | ratio | **Multiplicateur de sécurité** `T_pred / T_ideal` — `elastic_degradation_ratio` (ancre de confiance PROBE1) |
| `Relax` | min | Largeur fixe du créneau = **15 min** (`elastic_buffer_min`, `Start = Deadline − Relax`) |
| `T_start` | ms | Borne basse ancrée (`elastic_anchor_start_ms`) |
| `T_end` | ms | **Deadline** ancrée (`elastic_anchor_end_ms`) — ne recule que vers le passé |
| `Δ` | min | `D_mesuré − baseline` (baseline = `elastic_anchor_duration_min`) |

**Constantes**

```
RELAX_WIDTH      = 15 min     (Start_Relax = Deadline − 15 min — incompressible)
REF_SPEED        = 50 km/h     (fallback T_ideal si pas de duration statique API)
DEAD_ZONE        = 5 min       (hystérésis — pas de patch UI si |Δ| ≤ 5)
PROBE3_SKIP_DEP  = 10 min     (skip API si stable + proche deadline)
PROBE1_DEP_LEAD  = 2 min       (departure_time API ≥ now + 2 min)
PROBE2_LEAD      = 45 min
PROBE3_LEAD      = 15 min
SHORT_TRIP_MAX   = 15 min     (pas de PROBE2 si durée < 15)
DEFAULT_T_IDEAL  = 30 min     (fallback avant PROBE1)
```

**Modes** : `auto` → `driving` ; `walking` / `bike` → `walking` / `bicycling`. **PROBE2 ignoré** pour piéton et vélo (PROBE1 + PROBE3 uniquement).

##### 1. T_ideal & ratio D (PROBE1 — auto-calibration)

**T_ideal** (référence stable, sans trafic) :
```
T_ideal = round(duration_statique_API / 60)     // prioritaire
       ou round((distance_m / 1000) / 50 × 60)  // fallback 50 km/h
```

**Appel Distance Matrix PROBE1** :
```
departure_time = max(now + 2 min, T_arr − (T_ideal + Relax))
```
(Garde anti « voyage dans le temps » si l’arrivée est proche.)

```
D = T_pred / max(T_ideal, 1)
```

`D` est le **multiplicateur de sécurité** : plus le trafic est dégradé vs l’idéal, plus la deadline recule.

Persisté : `elastic_degradation_ratio` (= `D`), `elastic_predicted_duration_min`, `standard_duration_min` (= `T_ideal`). Champ legacy `elastic_prudence_alpha` = copie de `D` (lecture rétrocompat).

##### 2. Contrat de départ — Deadline ancre de confiance

```
Deadline (T_end) = T_arr − (T_used × D) × 60 000
Start_Relax (T_start) = Deadline − Relax × 60 000    (= Deadline − 15 min)
```

À **PROBE1** : `T_used = T_pred`, `D` mesuré à l’instant → la deadline affichée intègre déjà le risque trafic constaté.

**PROBE2 / PROBE3** (shifts) :
```
D_shift = max(D_PROBE1_stocké, T_live / T_ideal)
Deadline_proposée = T_arr − (T_live × D_shift) × 60 000
Start_proposé = Deadline_proposée − 15 min
```

**Ancrage pessimiste** (monotone décroissant) :

```
T_end'   = min(T_end_ancre,   T_end_proposé)    // ne avance jamais vers le futur
T_start' = min(T_start_ancre, T_start_proposé)
```

Le créneau **ne s’améliore jamais** visuellement quand le trafic se dégage ; il ne **recule** que si le trafic empire au-delà de la zone morte.

##### 3. Hystérésis UI (PROBE2 / PROBE3)

```
Δ = D_live − elastic_anchor_duration_min

|Δ| ≤ 5 min  →  UI_UPDATE: false  (scan + metadata techniques OK, pas de patch displayed*)
|Δ| > 5 min   →  recalcul ancre + UI_UPDATE: true si ancre modifiée
```

Logs `[TRIP-MATH]` : `[Ratio_D]`, `[UI_UPDATE: boolean]`, `[PROBE3_SKIPPED]` à chaque étape.

##### 4. PROBE3 conditionnel (skip API)

```
skip PROBE3  ⟺  |Δ| ≤ 5  ET  timeToDeparture(T_end) < 10 min
```

Si skip : `probe3_skipped: true`, `status = DONE`, Go/No-Go depuis dernière mesure PROBE2, `apiCallsAvoidedExtrapolation++`, pas d’appel Distance Matrix.

Sinon : PROBE3 live + même règles d’ancrage / hystérésis.

**Go/No-Go** :

```
Δ_depart = max(0, round((T_end − now) / 60 000))
leave_now  si  Δ_depart < 10 min
smooth     sinon
```

##### 5. Planification des sondes PROBE2 / PROBE3

Les sondes 2 et 3 sont ancrées sur la **borne basse courante** `T_start` (initiale ou décalée) :

```
T_probe3 = T_start − PROBE3_LEAD × 60 000     (= T_start − 15 min)
T_probe2_raw = T_start − PROBE2_LEAD × 60 000 (= T_start − 45 min)
```

Règles d’éligibilité PROBE2 :
- **Absente** si `D_std < SHORT_TRIP_MAX` (trajet court < 15 min → seulement PROBE1 + PROBE3).
- Sinon : `T_probe2 = max(now, min(T_probe2_raw, T_probe3 − 1 min))` (PROBE2 toujours **strictement avant** PROBE3).

Garde-fou temporel : `T_probe3 = max(now, T_start − 15 min)`.

PROBE1 est toujours immédiat (`now`) à l’activation ou après reset destination.

##### 6. Fallbacks numériques

| Situation | Comportement |
|-----------|--------------|
| PROBE1 sans GPS origine | `D_std = DEFAULT_D_STD = 30`, `elastic_approximate: true`, retry GPS dans 3 min |
| PROBE1 API en échec | retry PROBE1 dans 3 min, créneau non modifié |
| PROBE2 API en échec | créneau **inchangé**, retry PROBE2 dans 5 min |
| PROBE3 API en échec | push `probe3Unavailable`, retry PROBE3 dans 2 min |

##### 7. Suspension « Toute la journée » (All Day)

**Condition** : `metadata_json.is_all_day === 1` **ou** absence d’`arrivalDue` / `dueDateTime` horaire (date seule `YYYY-MM-DD`) — helper [`isTripAllDay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripElasticDisplay.ts).

`T_arr` devient **indéfini** → le créneau élastique n’a plus de sens mathématique.

**Suspension immédiate** — [`suspendTripMissionForAllDay(id)`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/sentinelTripMission.ts) (Option A) :
1. `cancelTripMission(id)` — stop timers, sondes, notifs
2. `clearTripElasticProbeMetadata(id)` — purge `elastic_*`, `standard_duration_min`
3. `remind_to_leave = 0` en SQLite (silencieux, pas de paywall)

**UI passive** :
- Pill créneau → remplacée par `intentionDetail.allDayNoDepartureSlot`
- Switch « Me prévenir » → **désactivé** (OFF forcé)
- Timeline → badge `timeline.tripAllDay` (*Toute la journée*), pas de créneau erroné

**Réveil** — bascule Timed → All Day inverse dans `persistDueDateTime` :
- [`wakeTripMissionAfterTimedRestore(id)`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/sentinelReconciler.ts) : si `remind_to_leave === 1` (réactivation manuelle) et metadata élastique vide → `resetTripMissionAndRelaunchProbe1` (PROBE1 immédiat)

**Garde-fous** : `sentinelReconciler` et `trafficSchedulerElasticTick` vérifient `isTripAllDay` avant toute activation ou exécution de sonde.

**Sondes API (max 2–3 appels Distance Matrix)** — dispatcher [`trafficSchedulerElasticTick.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/trafficSchedulerElasticTick.ts) :
| Sonde | Rôle |
|-------|------|
| **PROBE1** | `departure_time` prédictif (≥ now+2 min) ; `T_ideal` + `T_pred` → `D` ; deadline ancre `T_arr − T_pred×D` |
| **PROBE2** | Trafic live ; `D_shift = max(D₁, D_live)` ; hystérésis 5 min ; ancrage si `Δ > 5` |
| **PROBE3** | Go/No-Go ; skip API si stable + `< 10 min` avant deadline ; sinon mesure live |

**Planification** : zéro polling. Un `setTimeout` par TRIP sur `sentinel_trips.next_real_scan_at_ms` ([`TrafficSchedulerV4`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/TrafficSchedulerV4.ts)). Background OS ([`SentinelBackgroundService`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/SentinelBackgroundService.ts)) : tick **uniquement** si sonde échue.

**Métadonnées trip** (`metadata_json.trip`) :
- Affichage : `elastic_start_ms`, `elastic_end_ms`, `elastic_buffer_min`, `elastic_shifted`, `elastic_approximate`
- Contrat : `elastic_degradation_ratio` (D), `elastic_predicted_duration_min`, `elastic_anchor_*`, `probe3_skipped` ; `elastic_prudence_alpha` = miroir de D (legacy)
- Technique : `standard_duration_min`, `origin_lat/lng`, `last_traffic_duration`, `next_probe_at_ms`, `next_probe_reason`

**Cache Distance Matrix** : clé inclut un bucket `departure_time` (5 min) pour ne pas servir le trafic « now » sur une requête prédictive PROBE1.

##### 8. UI — Capsule Contrat de Départ

Composant : [`ElasticDepartureCapsule.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/ElasticDepartureCapsule.tsx), résolutions partagées [`tripElasticCapsuleModel.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripElasticCapsuleModel.ts), navigation [`tripNavigation.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripNavigation.ts).

**Contrat props** : `startMs`, `endMs`, `nowMs`, `ratioD`, `onPress`, `variant`, `lateVariant`, `theme`.

**Affichage actif** (`nowMs <= endMs`) :
- Capsule 100 % cliquable (action GPS) avec piste « pill-shaped », labels `HH:mm` aux extrémités, mur vertical deadline à droite.
- Couleur système iOS selon `D` : vert `#34C759` si `< 1.1`, orange `#FF9500` si `< 1.3`, rouge `#FF3B30` sinon.
- Bille animée `react-native-reanimated` sur `(nowMs - startMs) / (endMs - startMs)` ; son centre est aligné sur l’axe Y de la piste.
- Heure basse (`startMs`) quasi invisible quand elle est déjà passée, pour garder l’attention sur la deadline.
- Icône GPS via [`TripNeumorphicOrb.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TripNeumorphicOrb.tsx), taille `compact` (26 px), réutilisable.

**Affichage en retard** (`nowMs > endMs`) :
- En sheet : bouton d’action « Navigation » orange/rouge selon trafic.
- En Timeline (`variant="compact"`, `lateVariant="graphite"`) : uniquement l’orbe GPS graphite `#1C1C1E`, aligné sur le même slot X que l’icône GPS verte.

**Intégrations** :
- [`IntentionDetailSheet.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionDetailSheet.tsx) : capsule pleine largeur sous les adresses TRIP ; refresh `metadata_json` depuis SQLite (patchs Sentinel souvent silencieux) + polling 30 s si surveillance active.
- [`IntentionCard.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionCard.tsx) : remplace le badge texte Timeline quand la mission surveillée est active et qu’une fenêtre élastique est disponible ; sinon conserve CTA setup / scan pending / locked.

**Annulation / reset mission** ([`sentinelTripMission.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/sentinelTripMission.ts)) :
- `cancelTripMission(id)` : clear timers + annule PROBE2/3 planifiées — appelé si suppression TRIP, désactivation `remind_to_leave`, ou destination invalide.
- `suspendTripMissionForAllDay(id)` : All Day → cancel + clear metadata + `remind_to_leave = 0`.
- `resetTripMissionAndRelaunchProbe1(id)` : changement destination avec `pass2_unlocked === 1` → cancel + clear + PROBE1.
- `wakeTripMissionAfterTimedRestore(id)` : retour horaire + remind ON → PROBE1 si metadata vide.

**Dégradation gracieuse** : échec API PROBE2 → ancre / UI inchangées + retry 5 min ; échec PROBE3 → push `sentinel.probe3Unavailable` ; PROBE3 skip → finalisation silencieuse sans API.

##### 9. Notifications — Contrat de Départ (`NotificationService.ts`)

Moteur : [`NotificationService.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/NotificationService.ts), capsule texte [`formatDepartureCapsule.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/formatDepartureCapsule.ts), conformité stores [`dossier_de_soumission.md`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/dossier_de_soumission.md).

**UX Zen** : silence pendant les sondes (probes) ; une seule notification sticky mise à jour (pas de duplication) ; un seul signal sonore au départ.

**Android — ongoing / non-dismissible** (surveillance uniquement) :
- expo-notifications mappe `sticky: true` → `NotificationCompat.Builder.setOngoing(true)` ; `autoDismiss: false` empêche la fermeture au tap.
- Trigger immédiat : `{ channelId: 'departure_contract_silent' }` (pas `null`, évite le canal fallback expo).
- Canal suivi : importance **LOW**, sans son — visible dans le tiroir, pas de heads-up.
- Signaux A/B : `sticky: false`, `autoDismiss: true` — alertes datées dismissibles au swipe.

| Identifiant | Déclenchement | Son | Priorité | Ongoing (Android) |
|-------------|---------------|-----|----------|-------------------|
| `departure_sticky_{tripId}` | Chaque tick Sentinel après PROBE1+ (recalcul ancre) | Non | LOW (Android) / standard (iOS) | Oui (`sticky`) |
| `departure_signal_a_{tripId}` | `elastic_anchor_start_ms` | Oui | Time-Sensitive (iOS), HIGH (Android) | Non |
| `departure_signal_b_{tripId}` | `endMs − safetyReminderOffset` si offset > 0 | Non | HIGH visuelle | Non |

**Capsule Unicode** (`formatCapsule`) : `[🟢 20:53 ———◉———— 21:08]` — emoji selon `D` (🟢 / 🟠 / 🔴), bille `◉` sur `(nowMs − startMs) / (endMs − startMs)`, `🔴` si retard (`nowMs > endMs`).

**Réglage utilisateur** : préférence locale `departure_safety_reminder_offset_min` (minutes avant fin de fenêtre ; défaut **5** ; **0** = Signal B désactivé). Lecture via `loadDepartureUserSettings()`.

**Auto-nettoyage** (`clearAllDepartureNotifications`) :
- Lancement GPS : [`tripNavigation.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripNavigation.ts) (`intentionId`), [`IntentionDetailSheet`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionDetailSheet.tsx), [`IntentionCard`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionCard.tsx).
- Action notif Sentinel « Lancer l'itinéraire » : [`TrafficNotificationService.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/TrafficNotificationService.ts).
- Fin de mission / annulation : [`TrafficSchedulerV4`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/TrafficSchedulerV4.ts) (`done`, `cancelTask`, `refreshTask` hors ACTIVE).

**Sync** : `syncDepartureContractForIntention` appelé depuis `TrafficSchedulerV4.runTick` si `remind_to_leave === 1` et métadonnées `elastic_anchor_*` présentes.

**Handler global** ([`notifications.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/notifications.ts)) : `shouldPlaySound` uniquement pour `kind === 'departure_signal_a'`.

**Coexistence** : `SentinelNotificationManager` (sticky Newton / Go-NoGo probe3) reste distinct ; les mises à jour Contrat de Départ n’émettent pas de son pendant les probes.

Règle UI :
- Si non surveillable : indicateur « infos manquantes » (triangle jaune).
- Si surveillable + PRO : pill créneau élastique sous le switch rappel.

#### Aide visuelle (surveillabilité)
Afficher un indicateur visuel (ex: triangle jaune) dans le bloc “Mission” si des informations manquent pour activer la surveillance trafic.

Contrat d’affichage :
- Indicateur visible si `remind_to_leave` est ON et que `surveillable === false`.
- Tooltip/texte d’aide i18n :
  - `intentionDetail.surveillanceMissingInfo`
  - Message attendu : expliquer ce qui manque (ex: « Ajoute une destination valide et une heure d’arrivée précise. »)

### Critères d’acceptation
- Un trajet fraîchement créé reste en “Niveau 1” sans aucune UI de mission tant que l’utilisateur n’a pas activé “Me prévenir quand partir”.
- Une fois le switch ON (PRO), le bloc Mission apparaît immédiatement.
- La surveillance trafic ne démarre que si destination valide + heure précise sont réunies.
- Un trajet “All Day” ne peut pas lancer les sondes (heure imprécise), et doit afficher l’indicateur “infos manquantes” si Mission activée.

---

## IntentionDetailSheet — Intercalaires (Header à 3 slots) + Peek

Objectif : ajouter une armature d’intercalaires (onglets) dans le header de `IntentionDetailSheet` et une cinématique “peek” après validation de la dictée, sans modifier la logique interne ni le contenu des fiches.

### 1) Intégrité du contenu (contrainte absolue)
- Ne pas modifier le corps de la BottomSheet : tous les contenus existants (Trip, Liste, Projet, Habitude, etc.) restent strictement identiques une fois la sheet déployée.
- Les intercalaires ne sont qu’un header visuel + poignée de tirage, solidaire du haut de la fiche lors du déploiement.
- Les **enrichissements Pass 2** (listes détaillées, jalons projet, etc.) **ne** s’exécutent **pas** en arrière-plan pendant le peek : ils sont **réservés** au flux **`pass2_unlocked: true`** + action utilisateur (voir § Verrou sémantique). D’autres mises à jour non‑Pass‑2 (sync, champs déjà prévus hors enrichissement IA) restent hors périmètre de cette interdiction.

### 2) Structure des intercalaires (armature à 3 slots)
Refonte limitée au **header** de `IntentionDetailSheet` :

- 3 slots d’onglets **fixes** (slot 1/2/3) dans un container horizontal.
- Design : forme arrondie “onglet de navigateur / intercalaire”.
- Slot 1 :
  - Affiche le **nom de la catégorie IA** en texte clair.
  - La catégorie est la valeur existante de l’intention (ex. `category_id`) rendue en label i18n.
- Slots 2 & 3 :
  - Masqués par défaut.
  - Ne s’activent que pour des intentions multiples (multi‑items / multi‑résultats), sans changer la logique des fiches.
  - Règle d’activation : uniquement si une source amont fournit un “multiple” (ex. `draft.data.intents.length > 1` ou équivalent), sinon invisibles.

#### Couleurs (pastels uniquement)
- Utiliser des fonds pastels : Bleu / Vert / Violet.
- Interdits : Rose, Rouge, Orange.
- Le texte doit rester lisible (contraste suffisant).

### 3) Cinématique « Peek » (viewport % + phases Path A / Path B)

**Contrat produit (hauteurs)** : les positions **peek** et **vue validation** ne sont **pas** définies par des constantes en pixels (anciennes hauteurs fixes type bandeau minimal puis panneau validation à hauteur constante). Elles sont **exclusivement** exprimées comme **ratios de la hauteur utile de la fenêtre** (viewport / `window`). Tout plancher ou clamp éventuel côté implémentation ([`capturePeekLayout.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/capturePeekLayout.ts)) sert uniquement la lisibilité ; la **spécification** reste en **%**.

Au moment où la dictée est validée (après le « OK vert »), **avant** la persistance Pass 1 :

- **Path A** : dès `INTENTION_PEEK_SNAPSHOT`, la sheet s’ouvre en **peek** à environ **5 %** de la hauteur viewport (bandeau minimal « index 0 » ; constante `CAPTURE_PEEK_PATH_A_RATIO`), avec une row temporaire `id = 'peek_pending'` (catégorie / type / titre squelette Path A).
- Le header sert de poignée : seul l’intercalaire (slot 1) est mis en avant ; animation `spring` (damping / stiffness existants).

Après **Pass 1 persisté** (`INTENTION_PEEK_FIRST_SAVE`) :

- **Path B** : la sheet **anime** vers environ **25 %** du viewport — **vue validation** (intercalaire + titre clean + 2 boutons), même règle : hauteur cible en **% du viewport**, pas une hauteur fixe en px.
- **Auto-fermeture** : si la sheet reste en Path B **sans** interaction (pas de pan, pas de focus champ, pas de passage full) pendant **4 s**, elle se ferme.
- Annulation du timer : pan utilisateur, swipe vers le **full** (~**95 %** viewport en mode capture), ou `onFocus` sur un `TextInput` du corps de fiche.

#### Interactions attendues
- **Transition Path A → Path B** : uniquement un **ressort** sur la position verticale (nouveau ratio peek) ; **pas** de ré-entrée complète (pas d’opacity à 0 ni sheet renvoyée sous l’écran), pour éviter flash / disparition perçue. La sheet **ne se ferme pas** entre les deux événements sur le même onglet focalisé : `visible` reste vrai, seuls `peekHeightPx`, `peekCapturePhase` et la row passent de `peek_pending` à l’`intentionId` réel.
- Swipe up depuis le peek : déploie la sheet en **full** (mode capture : hauteur max **95 %** viewport pour l’édition).
- Swipe down / fermeture : logique inchangée.

#### Routage des événements peek (unicité `IntentionDetailSheet`)
- `INTENTION_PEEK_SNAPSHOT` est émis **au tout début** de `submitCapturePayload` (Path A : squelette local), **avant** `NetInfo.fetch()` et **avant** toute file offline ou bulk : même cinématique Path A **en ligne et hors ligne** (parité UX). `INTENTION_PEEK_FIRST_SAVE` n’est émis **qu’après** persistance réussie en ligne (callback `onPersisted`) ; en branche **file offline NetInfo**, il n’y a pas de Path B immédiat — pas d’émission `FIRST_SAVE` dans ce cycle (rejeu ultérieur possible). Les deux événements passent par le bus global (`DeviceEventEmitter`, `IntentionContext`).
- `TalkDebugScreen` et `TimelineScreen` montent chacun une `IntentionDetailSheet` : sans garde-fou, deux feuilles pourraient réagir au même événement.
- **Règle** : chaque écran ne traite les listeners peek que si **`useIsFocused()`** est vrai au moment de l’événement (lecture via ref à jour, car les handlers sont enregistrés une fois). Sinon : aucun `setState` ; journalisation `logCaptureFlow` avec `ui_peek_snapshot_skip_unfocused` ou `ui_peek_first_save_skip_unfocused` (payload `screen`: `TalkDebug` | `Timeline`).
- **Fermeture au blur (capture uniquement)** : si l’utilisateur quitte l’onglet pendant un peek capture actif (`peekCapturePhase` ∈ `path_a` | `path_b` ou row `peek_pending`), fermer la sheet sur cet onglet (`ui_peek_capture_dismissed_unfocused_tab`) pour éviter une `Modal` résiduelle au-dessus de l’onglet désormais focalisé (ex. replay offline terminé sur Timeline : seule la Timeline « maître » affiche le peek).
- Les événements **`ui_peek_snapshot`** / **`ui_peek_first_save`** (déjà en place) ne doivent être émis que par l’écran **focalisé** qui applique réellement l’ouverture ou la transition.
- **Peek Path B différé pendant overlay** : si `INTENTION_PEEK_FIRST_SAVE` arrive alors que l’overlay pipeline global est visible, le payload est stocké côté [`useCapturePipelineOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useCapturePipelineOverlay.ts) puis flush via **`CAPTURE_DEFERRED_PEEK_FIRST_SAVE_FLUSH`** à la fermeture de l’overlay ; les écrans focalisés appliquent alors le peek Path B.

#### Calque global micro + overlay pipeline (mai 2026)

- **Montage racine** : [`GlobalCaptureOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/GlobalCaptureOverlay.tsx) est sibling de `AppNavigation`, inside `IntentionProvider` + [`CapturePresentationProvider`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/context/CapturePresentationContext.tsx) ([`App.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/App.tsx)). Calque **absolu** `zIndex: 50` au-dessus de toute la navigation.
- **Micro unique** : une seule instance [`TalkCaptureMicButton`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TalkCaptureMicButton.tsx) — **plus** montée localement dans `TalkDebugScreen` ni `TimelineScreen`.
- **Présentation par écran** : chaque onglet focalisé configure le micro via `useCapturePresentation().setPresentation` (`useFocusEffect`) :
  - **TalkDebug** : `variant: 'talkDebug'`, `dashboardPipelineHost: true`, `compact: false` ; `disabled` synchronisé avec Phoenix (`phoenixSubmitting`).
  - **Timeline** (et défaut) : `variant: 'timeline'`, `compact: true`, `dashboardPipelineHost: false`.
  - **Masquage** : `micHidden: true` sur demande (futur écran sans capture).
- **Quota free** : gate global (`beforeStartCapture`, `micLocked`, `PassProModal`) dans `GlobalCaptureOverlay` — protection identique quel que soit l’écran actif.

#### Dashboard de progression OneTap (Talk — variante `talkDebug` + `dashboardPipelineHost`)

- **Déclenchement** : après validation dictée (**stop** micro), [`TalkCaptureMicButton`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TalkCaptureMicButton.tsx) en variante `talkDebug` avec **`dashboardPipelineHost`** (configuré par TalkDebug via `CapturePresentationContext`) passe en phase **`pipeline_wait`** et [`GlobalCaptureOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/GlobalCaptureOverlay.tsx) affiche [`AIUniversalProgressOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/AIUniversalProgressOverlay.tsx) (`Modal` plein écran : fond opaque type slate, `BlurView`, carte centrale : titre d’étape, **barre 0–100 %** bleue / orange résilience, pourcentage lissé). La courbe est orchestrée par [`useCapturePipelineOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useCapturePipelineOverlay.ts) + [`useAIProgressInertia`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useAIProgressInertia.ts) (**inertie** ease-in-out **0→30 %** puis **30→60 %** sur **2×1,2 s**, **phase 3** asymptotique vers ~95 % en attendant l’IA, **sprint linéaire** **200 ms** jusqu’à 100 % après succès Gemini / fallback persistance).
- **Progression (bus)** : cibles monotones « bump » dérivées des phases **`CAPTURE_PIPELINE_PROGRESS`** (même source que `logCaptureFlow` / `notifyCapturePipelineProgress`) ; bandes produit grossières : **0–10 %** enregistrement audio (`mic_stop_audio_done`), **10–30 %** transport (`mic_submit_invoke`, `submit_enter`, `submit_netinfo`), **30–60 %** transcription / Path A (`peek_snapshot_emit`), **60–100 %** analyse Pass 1 / persistance (`bulk_start`, `chunk_*`, `persist_callback`, `peek_first_save_emit`, fin `submit_return_after_bulk` ou file). Le hook impose un plancher d’inertie sur les deux premiers segments puis fusionne avec ces bumps.
- **Micro « échap »** : le bouton micro global reste visible ; `IntentionSuggestionsBanner` (TalkDebug) se base sur `captureRecordingActive` + `isPipelineOverlayVisible` du contexte ; un appui en **`pipeline_wait`** ferme seulement l’overlay (**pas** d’annulation de `submitCapturePayload` / Gemini — traitement silencieux en arrière-plan).
- **Révélation DealerBoard** : à **100 %** succès hors mode résilience, sprint final barre (**200 ms**), **hold 150 ms**, libellé d’étape i18n **`talkDebug.stepComplete`**, puis fermeture de l’overlay (`Modal` fade) ; les proxies [`DealerBoard`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/DealerBoard.tsx) restent visibles (événements peek déjà émis pendant le pipeline). Logs dev **`[BALLET-PROFILER]`** (`T5_BOOST_START`, `T5_100_REACHED`, `T6_HIDE_START`).
- **Résilience orange** : si file offline NetInfo (`peek_snapshot_offline_queue`), enqueue auto réseau (`bulk_network_resilience_enqueue`) ou `submit_offline_queued` avec **`reason: netinfo_offline`**, barre **orange**, titre i18n **`talkDebug.errorNetwork`** ; après atteinte ~100 %, **fermeture auto à 2 s** + navigation **Timeline** (traitement différé inchangé). i18n associées : `talkDebug.stepTransport`, `stepTranscription`, `stepAnalysis`.

#### DealerBoard — identité visuelle « Matérialisation » (Talk uniquement)

- **Montage** : [`DealerBoard`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/DealerBoard.tsx) est rendu **sous** [`TalkDebugScreen`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TalkDebugScreen.tsx) (calque absolu, `pointerEvents` passifs). **Aucune persistance SQLite** : les cartes sont des **proxies** décoratifs ; la vérité métier reste [`IntentionContext.submitCapturePayload`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/context/IntentionContext.tsx) / ventilé `oneTapPersist`.
- **`INTENTION_PEEK_SNAPSHOT`** : une carte « **fantôme** » (fond transparent, bordure seule, **icône** dérivée de `categoryTag` / `predictedType`) monte lentement (**~1,2 s**, easing sortant) depuis le bas vers le **centre** de l’écran.
- **`INTENTION_PEEK_FIRST_SAVE`** : le bus porte toujours `intentionId` (premier Pass 1) pour la sheet ; en **bulk ventilé**, le payload inclut en plus **`dealerBulkItems`** : une entrée par intention persistée (`intentionId`, `title`, `categoryTag`, `predictedType` dérivés des `PersistOneTapSuccess`). **Ballet géométrique** des contours : 2 cartes = ligne 1 gauche / droite ; 3 = ligne 1 G/D + ligne 2 une carte centrée ; 4 = grille 2×2 ; au-delà = grille centrée (`dealerBalletLayout`). **Matérialisation** après court délai de stabilisation : remplissage bas → haut (couleur catégorie), **mot-clé** (dernier mot du titre via regex), pastille **Ok** discrète. **Portrait** : cible visuelle ~100×140 px mise à l’échelle selon la largeur d’écran.
- **`MICRO_CAPTURE_START`** (`talkndone/micro_capture_start`, émis par [`TalkCaptureMicButton`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TalkCaptureMicButton.tsx) au début d’une capture micro réussie) : annule le timer d’**aspiration** vers le repère NEW (haut droite) et déclenche l’aspiration immédiate des cartes matérialisées ; **haptique** légère à l’arrivée sur le badge. Timer d’aspiration **idle** par défaut **30 s** après la dernière salve peek (tick post–`INTENTION_PEEK_FIRST_SAVE`). Archivage local des proxies à l’aspiration (**sans** mutation intention en base).
- **Mixeur multi-intentions** : `peekDetailRows` / `dealerBulkItems` synchronisés ; sélection d’index (`selectedIntentionIndex`) avec surbrillance carte ; accent stable par titre via `getIntentionColor` ([`intentionColorHash.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/intentionColorHash.ts)) propagé à [`IntentionDetailSheet`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionDetailSheet.tsx) (`intentionMixAccentColor`) ; morph du contenu de fiche lors d’un changement d’intention sélectionnée.

### 4) Critères d’acceptation
- Les hauteurs peek / validation / full capture sont pilotées par des **ratios viewport** (Path A ≈ **5 %**, Path B ≈ **25 %**, full capture ≈ **95 %**), et non par des constantes px imposées côté produit.
- Après validation dictée : Path A (~5 %) visible et stable avec catégorie pastel ; passage Path B **sans** extinction intermédiaire de la modale.
- Après Pass 1 : transition vers Path B (~25 %) + titre + actions (dont Pass 2) ; auto-close 4 s si immobile en Path B.
- Slot 1 : pastels **bleu / vert / violet** selon `category_id` (pas rose / rouge / orange), relief `neumorphicRaised`, coins supérieurs arrondis.
- L’ajout d’intercalaires ne casse aucune feature existante (édition, toggles, itinerary, listes, projets, etc.).

### 5) Verrou sémantique universel (`metadata_json.pass2_unlocked`)

**Contrat** : compteur binaire **`pass2_unlocked`** (nombre entier) à la racine de `metadata_json`.
- **Absent**, **`0`** ou **`false`** (legacy) : fiche **« Zen »** — aucun bloc Pass 2 complexe affiché, **même si** des données existent déjà (liste, jalons, trajet, etc.).
- **`1`** : génération Pass 2 **déjà consommée** — CTA footer **masqué définitivement** (Micro Path B ou Timeline) ; blocs détaillés révélés à l’ouverture.

**Affichage par défaut (tous types, hors vue validation capture Path B)** :
- Intercalaire neumorphique (catégorie + pastel).
- Titre clean (Pass 1).
- Moment (jour • heure) lorsque disponible.
- Mémo / transcript (`memo` ou `content_raw`).

**Consentement explicite (PRO uniquement — voir §6)** : au clic CTA, `patchMetadata` pose **`pass2_unlocked: 1`** (consentement + consommation du bouton). Vue détaillée : **fondu** CTA (`pass2CtaOpacity`, ~220 ms) puis corps (`pass2RevealAnim`, ~320 ms) — ou révélation immédiate si `pass2_unlocked === 1` déjà en base à l’ouverture. **FREE** : ne jamais persister `pass2_unlocked: 1` ni lancer Gemini.

**Overlay progression Pass 2 (LIST / PROJECT)** : [`IntentionDetailSheet`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionDetailSheet.tsx) réutilise [`useAIProgressInertia`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useAIProgressInertia.ts) + [`AIUniversalProgressOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/AIUniversalProgressOverlay.tsx) pendant `geminiEnrichGenericList` : `beginInertia()` au clic, `startFinalSprintTo100()` à la résolution Gemini, fermeture overlay au sprint 100 % + hold **150 ms**, puis `revealPass2DetailedBlocks()`. Libellés i18n dédiés : `pass2.steps_loading` (PROJECT), `pass2.list_loading` (LIST), `pass2.finalizing` (sprint final). Barre : pastel catégorie (bleu / vert / violet).

**Hydratation instantanée** : après chaque `patchMetadata` Pass 2, `applyPass2MetadataLocally` met à jour `listPayload` / `projectPayload`, l’état **`metadataJsonLive`** (source locale pour parser `meta` et piloter `showPass2FooterCta`) et **`onPatchRow`** — items / jalons visibles **sans** fermer la fiche. **Obligatoire** : [`TalkDebugScreen`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TalkDebugScreen.tsx) et [`TimelineScreen`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TimelineScreen.tsx) passent `onPatchRow` pour que `row.metadata_json` reflète `pass2_unlocked: 1` (sinon le CTA peut réapparaître à tort après génération).

**Footer — placement et éligibilité** :
- CTA Pass 2 (néomorphique, pastel) dans **`footerActionsRow`** (Zen) et **`footerRow`** (détaillé), **à gauche** de **Fermer**, aligné à droite.
- **`showPass2FooterCta`** : `row` présent, `row.id !== 'peek_pending'`, **`!isPass2UnlockedMeta(meta)`** (meta dérivée de `metadataJsonLive`), types **TRIP | LIST | PROJECT** uniquement. Pas de CTA pour **TASK** / **HABIT**.
- **Path B (peek ~25 %)** : le bouton principal de validation n’est rendu **que si** `showPass2FooterCta` (même libellés / même verrou).

**Libellés dynamiques (i18n)** — Timeline, Micro Path B et footer sheet :
- `TRIP` → `intentionDetail.actionSetupAlert` (*Me prévenir quand partir ?*).
- `LIST` → `pass2.generateList` (*Générer la liste*).
- `PROJECT` → `pass2.generateSteps` (*Générer les étapes*).
- **`TASK`**, **`HABIT`** (et catégories hors TRIP/LIST/PROJECT éligibles) → **aucun** CTA Pass 2 dans le footer : la fiche reste en mode note / habitude simple sans génération IA supplémentaire à ce stade.

**TRIP — hiérarchie** : en vue **Zen**, Mission et itinéraire précis masqués tant que `pass2_unlocked !== 1`. Passage à la vue riche après CTA **PRO** « Me prévenir quand partir ? » (`intentionDetail.actionSetupAlert`, `pass2_unlocked: 1`) — **sans** activer `remind_to_leave` ni Sentinel : la surveillance démarre **uniquement** via le Big Button « Surveiller le trajet » dans le hub. **`syncSentinelAfterDestinationChange`** lit `remind_to_leave` en **DB** (jamais l’état React) ; sheet s’ouvre avec `remindToLeaveEnabled = false` jusqu’à hydrate DB.

**Exception — capture Talk (Path B, sheet full)** : `gateFullTripBypass` (trajet + `path_b` + full) affiche itinéraire **sans** `pass2_unlocked === 1` ; CTA footer trajet reste visible tant que `pass2_unlocked !== 1`. `pass2RevealAnim` → **1** si `pass2_unlocked === 1` ou bypass.

**Cas `peek_pending`** : même squelette Zen si la sheet est ouverte en plein hors Path B ; le bouton de déverrouillage est masqué (pas d’`id` stable pour persister).

### 6) Gating monétisation Pass 2 (FREE vs PRO)

**Source de vérité** : [`UserSpectrumContext`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/context/UserSpectrumContext.tsx) via **`useUserSpectrum()`** — booléen effectif **`spectrum.isProUser`**. `spectrum.isProUser === false` ⇒ utilisateur **FREE** ; `true` ⇒ **PRO**.

**Objectif produit** : le FREE **voit l’opportunité** (CTA verrouillé) ; le PRO consomme le CTA une fois (`pass2_unlocked: 1`) puis enrichit LIST/PROJECT si applicable — jamais auto après Pass 1.

**Comportement du CTA Pass 2 (footer)** (vue Zen / détaillée ; Path B Talk : libellés `pass2.*` + même persistance via `onPressPass2` / `onPressPeekValidationPrimary`) :

| | **FREE** | **PRO** |
|---|----------|---------|
| **Libellé** | Base i18n + `intentionDetail.pass2LockedSuffix` (🔒). | Libellé i18n seul. |
| **Clic** | Pas de `patchMetadata` `pass2_unlocked` ; pas de Gemini ; redirection `ProSubscription`. | `pass2_unlocked: 1` + overlay inertie (LIST/PROJECT) ou révélation TRIP ; enrichissement Gemini ; items/jalons hydratés localement ; CTA masqué ensuite. |
| **Persistance** | `pass2_unlocked` reste absent / `0`. | `pass2_unlocked: 1` en base ; réouverture fiche → vue détaillée sans CTA. |

**Animation** : après clic **PRO**, conserver une **transition fluide** (fondu / durée cohérente avec l’existant ~300 ms) pour l’apparition des blocs détaillés.

**Intégration** : [`IntentionDetailSheet.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionDetailSheet.tsx) consomme `useUserSpectrum()` (ex. `const { spectrum } = useUserSpectrum()` puis `spectrum.isProUser`) ; pas de duplication de règles dans `IntentionContext` / `oneTapPersist` sauf si un garde-fou serveur ou quota est ajouté plus tard (hors périmètre UI immédiat).

---

## Capture Flash — Pass 1 / Pass 2 (Enrichir vs Terminer)

Objectif : après la dictée, offrir 2 choix clairs : **Enrichir** (Pass 2) ou **Terminer** (fermer), tout en garantissant une persistance immédiate dès le Pass 1.

### 1) Flux Pass 1 (Capture Flash)
- Par défaut, Gemini traite l’intention comme **complète** dès le premier appel :
  - `incomplete: false` (ou équivalent) forcé / attendu côté prompt/contrat.
- Persistance :
  - Sauvegarder l’intention en base immédiatement après la réponse du Pass 1.
  - Le “Pass 1 ready” signifie : catégorie + titre clean disponibles et row persistée (ID stable).
- Audit :
  - L’audit SmartTitle s’exécute **en arrière-plan** et ne doit pas bloquer l’UI.

### 2) UI — Path A (~5 %) puis Path B (~25 %) puis Full (~95 % capture)

Les trois paliers (peek immédiat, vue validation post–Pass 1, plein écran capture) sont des **pourcentages de la hauteur de fenêtre** ; il n’y a **pas** de hauteur peek ou de « vue validation » codée en px comme exigence produit.

#### Path A (immédiat, `INTENTION_PEEK_SNAPSHOT`)
- Row `peek_pending`, hauteur de sheet ≈ **5 %** de la hauteur viewport (bandeau minimal « index 0 » ; ajustable via `CAPTURE_PEEK_PATH_A_RATIO`).

#### Path B (`INTENTION_PEEK_FIRST_SAVE`, Pass 1 prêt)
- Passage fluide vers ≈ **25 %** de la hauteur viewport.
- Vue « Validation » : intercalaire (neumorphique + pastel), **titre clean**, **footer** 2 boutons — toujours pilotée par le **ratio ~25 %**, pas par une hauteur fixe en pixels.
- Auto-close **4 s** en Path B si aucune interaction ; timer annulé par pan, swipe full, ou focus champ.

#### Full (édition capture)
- Swipe up ou tap header : sheet **full** ; en flux capture, hauteur max **95 %** de la hauteur viewport (même logique %).
- Hors flux capture, la hauteur « full » de `IntentionDetailSheet` suit les ratios **0,86** / **0,92** (source étendue) appliqués à la hauteur fenêtre — **sans** plancher minimal en pixels sur la hauteur de la sheet.

### 3) Footer actions (vue Path B)
#### Bouton de mutation (Pass 2 — Enrichir)
- En **fiche timeline / full** : CTA Pass 2 dans le **footer** de `IntentionDetailSheet` (à gauche de **Fermer**), libellés i18n **`intentionDetail.actionSetupAlert`** (TRIP) / **`pass2.generateList`** / **`pass2.generateSteps`** (types **TRIP / LIST / PROJECT** uniquement) ; **gating FREE/PRO** : voir **§6** (`isProUser` via `useUserSpectrum()`).
- **PRO** — Action :
  - Pose **`pass2_unlocked: 1`** via `patchMetadata` (consentement + CTA consommé).
  - **Ensuite uniquement** : enrichissement LIST/PROJECT (`geminiEnrichGenericList`) + overlay inertie dans `IntentionDetailSheet` — **pas** d’enrichissement auto après Pass 1.
  - Déploie la sheet en **plein écran**.
- **FREE** — Action : pas de mutation `pass2_unlocked`, pas d’enrichissement ; redirection souscription Pro (ou log de secours en dev).
- Feedback :
  - Afficher une jauge/loader dans l’intercalaire pendant que le Pass 2 mouline (**PRO** uniquement lorsque l’enrichissement tourne).

#### Bouton secondaire (Terminer)
- Libellé i18n : “Fermer” / “Terminer” (à préciser en i18n).
- Action : ferme la sheet.
- Important : l’intention étant déjà persistée au Pass 1, aucune action supplémentaire n’est requise.

#### Bouton principal contextuel (Talk — Path B uniquement)
- Bouton principal peek : libellés alignés footer Timeline (`intentionDetail.actionSetupAlert` pour **TRIP**, `pass2.*` pour LIST/PROJECT) ; masqué si `pass2_unlocked === 1`. Types **note** : `talkDebug.actionAddNote` (ouvre full sans Pass 2). **TRIP** : `pass2_unlocked: 1` + ouverture hub (itinéraire + Big Button) — **pas** d’activation `remind_to_leave` au clic peek. **LIST / PROJECT** : `onPressPass2` (overlay + enrichissement).
- Bouton secondaire : **Terminer** / fermeture sheet.
- Observabilité : log dev **`[ACTION-ADVISOR]`** lors du choix du libellé / de la route d’action (audit produit).

### 4) Stabilité technique (contrats)
- Fermer la sheet (bouton ou swipe down) ne doit **jamais** annuler l’enregistrement du Pass 1.
- Le Pass 2 est optionnel : son annulation/fermeture n’impacte pas la row persistée.

### 5) Critères d’acceptation
- Après dictée : Path A (~5 %) + intercalaire visible.
- Dès Pass 1 prêt : Path B (~25 %) + titre clean + 2 boutons.
- « Terminer » ferme sans effet secondaire (la row est déjà en base).
- **PRO** : « Enrichir » lance Pass 2 + full screen + loader sur l’onglet.
- **FREE** : le bouton Pass 2 reste **verrouillé** (cadenas) et n’écrit pas `pass2_unlocked` ; le clic mène vers la souscription Pro.

Composants principaux :
- Capture & parsing : [oneTapUniversalCapture.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapUniversalCapture.ts)
- Client réseau Gemini (streaming SSE) : [geminiSemanticLab.ts](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/geminiSemanticLab.ts)
- Persistance intentions : [oneTapPersist.ts](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapPersist.ts)
- Orchestration UI capture : [IntentionContext.tsx](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/context/IntentionContext.tsx)

## Architecture UI & Expérience Timeline

Cette section définit les contrats UI pour la refonte de la Timeline afin de passer d’un pilotage “fonctionnel/dense” à une interface Neumorphique épurée (référence “Image 1”), sans perte de logique, de données, ni de garanties UX.

### 0) Architecture de Thèmes Découplés (TalkThemeRegistry)

**Objectif** : proposer plusieurs directions visuelles interchangeables **sans modifier la logique métier** des composants (Timeline, Sheets, capture micro, etc.), avec **rollback instantané** vers le design actuel.

**Principe** : les couleurs, radius et ombres sont centralisés dans un registre de tokens ; les composants consomment une API identique (`DesignTokens`) quel que soit le thème actif. La logique SQLite, navigation, capture OneTap et comportements UX restent inchangés.

#### Fichiers

| Fichier | Rôle |
|---------|------|
| [`TalkThemeRegistry.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/theme/TalkThemeRegistry.ts) | Registre des variantes, tokens, fusion Paper MD3 |
| [`colors.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/theme/colors.ts) | Palette TellYouTo d’origine (Teal / Orange / Off-white) |
| [`paperTheme.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/theme/paperTheme.ts) | Thèmes React Native Paper light/dark |
| [`neumorphism.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/theme/neumorphism.ts) | Helpers legacy `neumorphicRaised` / `neumorphicInset` (composants non migrés) |
| [`useDesignTokens.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useDesignTokens.ts) | Hook React — tokens du design actif selon le schéma clair/sombre |
| [`ThemeContext.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/context/ThemeContext.tsx) | Hydrate `designVariant` depuis AsyncStorage ; `setDesignVariant` ; fusion Paper MD3 |
| [`DebugScreen.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/DebugScreen.tsx) | Showroom **🎨 EXPLORATION GRAPHIQUE** — sélecteur 6 variantes |

#### Contrôle global, showroom dynamique & rollback

**Showroom runtime (mai 2026)** : la variante active n’est plus une constante figée — elle est **persistée** dans AsyncStorage (`@trankil_debug_theme_variant`) et exposée par `ThemeContext` :

| API | Rôle |
|-----|------|
| `readPersistedDesignVariant()` / `persistDesignVariant()` | Lecture / écriture AsyncStorage ([`TalkThemeRegistry.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/theme/TalkThemeRegistry.ts)) |
| `ThemeContext.designVariant` | Variante courante (réactive) |
| `ThemeContext.setDesignVariant(variant)` | Change la variante + persiste + re-render global |
| `useDesignTokens()` | Tokens du design actif (s’abonne à `designVariant` + clair/sombre) |

**Défaut** : si aucune valeur stockée → `DEFAULT_DESIGN_VARIANT = 'CURRENT'` (filet de sécurité 0 % régression).

**UI Showroom** : onglet **Debug** → section **🎨 EXPLORATION GRAPHIQUE (TEST THÈMES)** (sous « Vider la base ») — grille de 6 boutons tactiles ; bascule **instantanée** sans recompiler. Le panneau consomme lui-même les tokens (`cardBackground`, `cardShadowStyle`, `accentColor`).

**Disposition Timeline (Debug, orthogonal aux skins)** : panneau **Disposition Timeline** sous le showroom — `CURRENT` (cartes plate) vs `EMAIL_HUB` (hub email) ; persisté `@trankil_debug_timeline_layout` via [`timelineLayoutRegistry.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/timelineLayoutRegistry.ts) + `ThemeContext.timelineLayoutMode`. Rollback = **Cartes actuelles**.

**Rollback** : sélectionner **Actuel (TellYouTo)** dans le showroom Debug → retour exact au design d’origine. En mode `CURRENT`, `applyDesignVariantToPaperTheme` reste un **no-op** et les tokens reproduisent `palette` + `paperTheme.ts`.

| Valeur | Ambiance |
|--------|----------|
| `CURRENT` | Design TellYouTo actuel — **0 % régression** (palette `colors.ts` + `paperTheme.ts`) |
| `ZEN_NEUMORPHIC` | Évolution neumorphique : sable, gris perle, ombres douces sculptées |
| `CYBER_MINIMALIST` | Noir OLED, lignes fines, accent néon menthe (`#00FFD5`) |
| `BENTO_MODERN` | Cards blanches, radius 24, style Apple Shortcuts / Linear |
| `NORDIC_FOREST` | Vert sauge, sapin, crème/lin — focus organique |
| `SUNSET_PASTEL` | Violet crépuscule, pêche, corail pastel — bien-être créatif |
| `SPATIAL_CALM_PREMIUM` | Graphite mat `#121316`, cartes flottantes stroke `#2C2D35`, accent indigo `#6366F1`, lueur micro (Linear / Superhuman — Calm Tech 2026) |

#### Structure de tokens (identique pour tous les thèmes)

```typescript
type DesignTokens = {
  variant: DesignVariant;
  backgroundColor: string;   // fond principal (écran)
  cardBackground: string;    // fond tuiles / cartes / intentions
  textPrimary: string;
  textSecondary: string;
  accentColor: string;       // micro, CTA principaux
  borderRadius: number;
  shadowStyle: ViewStyle;    // relief « raised » (boutons, dock)
  cardShadowStyle: ViewStyle; // relief « inset » (cartes, micro inner)
};
```

#### Utilisation dans un composant (migration progressive)

1. Importer le hook :

```typescript
import { useDesignTokens } from '../hooks/useDesignTokens';

const designTokens = useDesignTokens();
```

2. Remplacer les styles en dur par les tokens (sans toucher à la logique) :

```typescript
// Fond d’écran
<View style={{ backgroundColor: designTokens.backgroundColor }} />

// Carte / bouton neumorphique
<View style={[designTokens.shadowStyle, styles.maCarte]} />

// Accent (micro, liens)
<Mic color={designTokens.accentColor} />
```

3. Les composants déjà branchés sur `theme.colors.*` (React Native Paper) bénéficient **automatiquement** des variantes ≠ `CURRENT` via `ThemeContext` — aucune migration requise pour eux tant que la variante est active.

#### Composants migrés (mai 2026)

| Composant | Tokens consommés |
|-----------|------------------|
| [`TimelineScreen.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TimelineScreen.tsx) | `backgroundColor` (fond racine) |
| [`TalkDebugScreen.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TalkDebugScreen.tsx) | `backgroundColor`, Phoenix (`textPrimary`, `cardBackground`, `accentColor`) |
| [`DebugScreen.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/DebugScreen.tsx) | Fond scroll, titres, panneau showroom (`cardShadowStyle`, `cardBackground`, `accentColor`) |
| [`TalkCaptureMicButton.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TalkCaptureMicButton.tsx) | `shadowStyle`, `cardShadowStyle`, `accentColor` (variante Timeline) |
| [`IntentionCard.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionCard.tsx) | `cardShadowStyle`, `cardBackground`, `textPrimary/Secondary`, `accentColor`, `borderRadius` |
| [`IdeaBankModal.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IdeaBankModal.tsx) | Fond modale, cartes rows, arrondis dynamiques ; **actions icône seule** (40×40, libellés commentés en source — visuel validé, nettoyage étape 2) |
| [`IntentionDetailSheet.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionDetailSheet.tsx) | Fond sheet, CTA Pass 2 / validation peek, bouton surveillance TRIP (`accentColor`) |

**Composants candidats** (migration future) : `PilotStatusHeader`, `DealerBoard`, `IntentionCard` pied TRIP (badges métier inchangés).

#### Contraintes contractuelles

- **Ne pas** modifier la logique métier lors d’une migration visuelle (SQLite, capture, filtres, undo 3 s, etc.).
- **Ne pas** supprimer `neumorphism.ts` tant que des composants non migrés l’utilisent encore.
- Les variantes ≠ `CURRENT` sont des **prototypes visuels** : validation produit requise avant bascule production.
- Le mode clair/sombre système (`ThemeContext.resolvedTheme`) reste actif ; `CURRENT` s’adapte light/dark via `currentPalette()`.

### 1) Standard de Design Neumorphique (Image 1)

- Identité visuelle : l’interface utilise exclusivement un style Neumorphique (reliefs doux, ombres portées, surfaces claires), avec une dominante d’ombres type `#F0F0F3` (et variantes de thème) via les helpers neumorphiques existants (ex. `neumorphicRaised`).
- Anatomie de la carte : chaque intention est rendue via une structure fixe et stable visuellement : `[Icône de catégorie] | [Titre + Date/Heure relative] | [Indicateur de statut]`.
- DISPLAY TITLE CONTRACT (strict) : le champ `CONTENT` (ou `display_title`) est un titre d’action purifié, conforme aux règles ci-dessous.
  - Destructive stripping (obligatoire) : supprimer systématiquement tout marqueur de temps/date (jour/date/heure/récurrence), y compris variantes bruitées multi‑langues (ex. “demain”, “ce soir”, “à 19h”, “monday”, “at 7pm”, “ds 2 jours”, “mañana”, “stasera”, “sàbdo”…).
  - Prépositions/articles orphelins (obligatoire) : supprimer toute préposition ou article résiduel en fin de titre après stripping (ex. “at”, “on”, “for”, “to”, “à”, “le”, “el”, “la”, “a las”, “per”, “en”, “sta”…).
  - Corrections évidentes : corriger les typos/abréviations évidentes dans la langue détectée, sans traduction (ex. “pades” → “Padres”, “piza” → “Pizza”, “mdcin” → “Médecin”), et démarrer par une majuscule.
  - Intégrité : ne jamais supprimer l’objet de l’action (ex. “mger des frites ce soir” → “Manger des frites”).
  - Règle d’or : si une info temporelle est déjà structurée (`due_date`, `recurrence`, etc.), elle ne doit pas apparaître dans le titre.
  - Exemples contractuels :
    - “Cena con mis pades el sàbdo a las 21h” → “Cena con mis Padres”
    - “Lunch with Marc on friday” → “Lunch with Marc”
- Contrat Phase 2 (IntentionCard) : l’action et l’identité sont fusionnées. Un unique cercle neumorphique à gauche (taille tactile stable) contient l’icône de catégorie et sert de seul bouton d’action.
- État pending (Undo 3s) : quand `pendingLocalDone` est actif, l’icône de catégorie dans le cercle est remplacée par une coche de validation.
- Largeur & respiration : le conteneur principal de la carte (rectangle neumorphique) ne doit pas être “bord à bord”. Il conserve un retrait horizontal visible (gouttières) pour laisser respirer le texte, et peut être plafonné par un `maxWidth` afin d’éviter les lignes trop longues sur grands écrans.
- Densité & hauteur : la carte Phase 2 doit être plus fine (hauteur visuelle cible **105** pour TASK / HABIT / LIST / PROJECT / NOTE) ; l’espacement vertical entre cartes est géré par le flux (ex. `marginBottom` côté carte) et la respiration horizontale par le parent (ex. wrapper `paddingHorizontal: 16` dans `TimelineScreen`). Les cartes **TRIP** (`metadata_json.trip` présent) peuvent s’étendre en hauteur pour un **pied de carte** dédié (voir § 2.c).
- Titre intelligent (universal) : la ligne 1 affiche `row.title` (source de vérité Gemini). `generateSmartTitle(row.content_raw)` reste un fallback local (offline/heuristique), jamais un nettoyage appliqué sur un titre Gemini.
- Sous-titre temporel (maquette) : la ligne 2 affiche le label au format `{JourLabel} • {Heure}` (point médian), sans répétition d’informations déjà présentes dans le titre.
  - JourLabel : “Aujourd’hui”, “Demain”, sinon nom du jour (ex. “Lundi”, “Jeudi”) calculé en local via `formatYmdLocal` + comparaison à J+0/J+1.
  - Heure : utiliser `dueTimeHm` (ex. “18:30”). Si l’heure est absente, afficher la chaîne i18n “toute la durée”.
  - Alignement types : ce format s’applique uniformément pour TASK et TRIP.
  - TRIP (source de vérité) : l’heure affichée est dérivée de `arrivalDue` (ISO) quand disponible ; sinon fallback sur `dueDateTime`/`dueTimeHm`.
  - Récurrence : si `recurrence` (objet OneTap) ou `recurrence_rrule` (SQLite) est non null/non vide, afficher une icône discrète “repeat” (flèches entrelacées) juste avant le bloc horaire, avec la même couleur grise que le sous-titre.
- Mirroring temporel (réalité actuelle) : `due_date` (SQLite) est un jour clé `YYYY-MM-DD`. L’heure affichée provient de `metadata_json` (`dueTimeHm` / `dueDateTime` / `trip.arrivalDue`) selon le type. L’affichage UI ne doit pas altérer le tri ni les valeurs persistées.

#### 2.c) Carte TRIP — pied de carte ([`IntentionCard.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionCard.tsx))

**Périmètre** : uniquement les lignes avec `metadata_json.trip` (objet non vide). TASK / HABIT / LIST / PROJECT sans bloc `trip` : **aucun** pied de carte ni changement de layout.

**Source d’état** : `isProUser` + `remind_to_leave` + champs élastiques dans `metadata_json.trip` (lecture via [`tripElasticDisplay.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripElasticDisplay.ts) / [`tripTimelineCard.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripTimelineCard.ts) / [`tripTripReadiness.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripTripReadiness.ts)). **Plus de lecture live `sentinel_trips` depuis la carte Timeline.**

| Cas | Condition | UI pied de carte | Action au tap |
|-----|-----------|------------------|---------------|
| **All Day** | `isTripAllDay(meta, trip, due_date)` | **Aucun** footer | — |
| **FREE** | `!isProUser` | CTA `intentionDetail.actionSetupAlertLocked` (*Me prévenir quand partir 🔒*) | Footer → **Paywall direct** ; tap corps → **Sheet hub unifiée** (vitrine + bouton `tripSurveillanceStartLocked`) |
| **B** | PRO + `standard_duration_min` persisté (PROBE1 fait) | Badge : `timeline.elasticDepartureWindow` ; variantes `elasticDepartureApprox` (≈), `elasticDepartureShifted` (⚠️) | Aucun |
| **C1** | PRO + mission active + PROBE1 pending + `next_probe_at_ms > now + 60 s` | Badge `timeline.scanTrafficScheduled` (heure miroir `trip.next_probe_at_ms`) | Aucun |
| **C2** | PRO + mission active + PROBE1 pending + `next_probe_at_ms ≤ now + 60 s` | Badge `timeline.scanTrafficInProgress` (« Scan en cours… ») | Aucun |
| **D** | PRO mais mission inactive ou remind OFF | CTA `intentionDetail.actionSetupAlert` | Sheet **full hub unifiée** (même vue que tap corps) |

**Sheet — hub TRIP unifié** : une seule Bottom Sheet pour tout TRIP ouvert depuis la Timeline (tap corps ou footer PRO setup) : mémo + timing + itinéraire + transport + **Big Button** `tripSurveillanceStart` / `tripSurveillanceActive` (remplace le switch `remind_to_leave`). Le bouton est grisé + toast si champs manquants ; FREE voit `tripSurveillanceStartLocked` → paywall au tap. Garde anti double-tap (`tripSurveillanceBusyRef`) pendant l’activation. Après sélection Places (`onSelect`), sync optimiste locale via `applyTripMetadataLocally` (met à jour `metadataJsonLive` + `onPatchRow` **avant** le reconcile) pour éviter un Big Button grisé alors que SQLite est à jour.

**Champ arrivée** : placeholder i18n + triangle jaune si pas d’adresse SQLite ; **pas** de préremplissage automatique depuis favoris à l’ouverture de la sheet — l’adresse n’apparaît que si `location_address` est persistée ou choisie via autocomplete. Coords invalides (`null`, `0`) rejetées par [`readValidTripCoords`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripTripReadiness.ts).

**Badge scan — rafraîchissement temporel** : libellé via [`tripProbeScheduleDisplay.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripProbeScheduleDisplay.ts) (`resolveProbeScheduleLabel`) ; miroir `trip.next_probe_at_ms` ; bascule C1→C2 quand `next_probe_at_ms ≤ now + 60 s` ; horloge locale [`useProbeScheduleClock`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useProbeScheduleClock.ts) (tick 30 s, cleanup au démontage). **Pas de fallback** `Date.now()` comme fausse heure planifiée.

**Robustesse Sentinel (mai 2026)** : **seul** le tap Big Button « Surveiller » écrit `remind_to_leave = 1` et lance reconcile ; **aucun** `activateSentinelTrip` auto à la capture (`oneTapPersist`). `syncSentinelAfterDestinationChange` (autocomplete / favori) relit **`remind_to_leave` en DB** — no-op si `0`. Sheet : `remindToLeaveEnabled = false` à chaque nouveau `row.id` avant hydrate async. Debounce / mutex / retry : [`sentinelReconciler.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/traffic/sentinelReconciler.ts).

**Règle anti-faux créneau** : aucune fenêtre `[start – end]` n’est calculée ni affichée tant que `standard_duration_min` est absent (pas de `D_std` par défaut en UI).

**Supprimé** : `timeline.elasticDeparturePending`, badge Timeline All Day (`timeline.tripAllDay`).

**Supprimé** : badge « Circulation : X min » et badges scan Newton (`trafficScanConfigured`, `trafficLiveMinutes`).

**Isolation layout** : le `Pressable` du bouton Cas A consomme le toucher (pas de propagation vers l’ouverture « tap carte » générique). Les types non-TRIP conservent la hauteur fixe 105 px.

### 2) Découplage Pilotage / Contenu

- Header minimaliste : le header de la Timeline est fusionné avec la barre de navigation (suppression de la redondance “Timeline” vs “Ma Timeline”). Une seule ligne contient la pilule “Ma Timeline” à gauche ; à droite : **icône imprimante** (Feuille de Route / Pass 3), accès **liste projets**, puis **filtres** (modale).
- TimelineFilterModal : tous les réglages de contexte (`HOME`, `WORK`, `PIGGY`, `ARCHIVES`, etc.), de temps (`timeNav`, incluant la date custom) et de statut (`statusFilter`) sont déportés dans une modale dédiée afin de libérer l’espace visuel.
- Source de vérité : les états de filtrage restent portés par le parent [TimelineScreen.tsx](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TimelineScreen.tsx) (ex. `timeNav`, `contextBubble`, `statusFilter`, `customPickedDate`) ; la modale ne fait que manipuler ces états via callbacks, sans logique de requête.
- Transfert de responsabilité : les indicateurs de pilotage technique (badge Pro, compteurs de quota, notifications, accès Tirelire/Cochon) sont exclus de la Timeline.
- Centralisation : la source de vérité de ces métadonnées techniques est officiellement déplacée vers la page `TalkDebugScreen`.
- Minimalisme garanti : toute réintroduction d’élément de statut technique dans la Timeline (header ou vue principale) est proscrite afin de préserver la charge cognitive.

#### 2.a) Feuille de Route quotidienne (Pass 3)

- **Déclencheur** : icône imprimante dans le header de [TimelineScreen.tsx](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TimelineScreen.tsx).
- **Sas de nettoyage** : overlay plein écran avec flou ; chargement SQL immédiat via `listIntentionsForPass3Cleanup` :
  - intentions **échues non terminées** : `due_date` strictement avant le jour local courant, statut actif ≠ `done`, lignes racine éligibles Timeline (hors archivées / masquages techniques alignés sur le repository),
  - intentions **orphelines** : `due_date` NULL ou chaîne vide.
- **Actions par ligne** : **Valider** (incluse dans le JSON envoyé au modèle), **Reporter** (`due_date` → aujourd’hui via `updateTrankilV2IntentionTemporal`), **Supprimer** (`archiveIntention`).
- **Prompt** : Remote Config Firebase **`prompt_pass3_synth_v1`**, chargé via le singleton [firebaseRemoteConfig.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/firebaseRemoteConfig.ts) (`fetchPass3DailyRoadmapPromptTemplate`, réexporté par [geminiRemoteModelSteering.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiRemoteModelSteering.ts)) ; le **system instruction** final = template RC + suffixe produit (focus journée, logistique Newton / TRIP, Coup de Boost sur `orphan_intentions` les plus anciennes via `age_days`, groupements thématiques, HTML inline sans `<html>`/`<body>`, langue des titres avec repli sur `context.lang` si multilingue).
- **Payload** : JSON compact `{ context: { date, lang }, today_intentions: [...], orphan_intentions: [...] }` construit par [`dailyRoadmapPass3.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/dailyRoadmapPass3.ts).
- **Appel modèle** : [`geminiSemanticLab.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts) — opération **`pass3.daily_roadmap_html`**.
- **Progression** : [`useAIProgressInertia`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/hooks/useAIProgressInertia.ts) + [`AIUniversalProgressOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/AIUniversalProgressOverlay.tsx) après validation du sas (phases i18n `timeline.roadmap.*` ; paliers type capture P1≈60 %, P2≈90 %, sprint final).
- **Stockage** : `INSERT` dans `daily_summaries` ; ouverture du rapport en WebView ; **Partager / Imprimer** : PDF via `expo-print` puis partage natif `expo-sharing` (hors web).
- **Accès secondaire** : sous le sticky header **Aujourd’hui**, lien dédié (`roadmapLink`) pour ouvrir le dernier rapport du jour ou inviter à générer via l’imprimante.

#### 2.b) Box — stock d’idées sans date (remplace le nudge cluster orphelin)

- **Objectif** : séparer l’**exécution du jour** (corps EMAIL_HUB) du **stock à froid** — toutes les intentions **TODO sans `due_date`**, hors **Inbox du jour**, hors catégorie **SHOP** et hors **HABIT** (→ vue Routines).
- **SQL** : [`BOX_STOCK_WHERE`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/api/trankilV2Db.ts) — `listTrankilV2BoxStockIntentions`, `countBoxStockIntentions`, `bulkDeleteTrankilV2IntentionsByIds` ; compteur carrousel `boxCount` dans `getTrankilV2SmartClusterCounts`.
- **Carrousel** : tuile **Box** (libellé hardcodé, sans i18n) dans [`SmartClustersCarousel`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/SmartClustersCarousel.tsx) — ordre **Inbox · À acheter · Box · Routines · Projets** (nudge cluster orphelin et tuile Listes retirés).
- **Vue catégories** : tap **Box** → [`LivingHubCategoryModal`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/LivingHubCategoryModal.tsx) — même rendu bloc/catégorie que le corps hub (`buildLivingHubBlocks` sur `boxStockRows`).
- **Focus modal** : tap bloc → ferme la vue Box puis [`IdeaBankModal`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IdeaBankModal.tsx) pré-filtrée (`ideaBankHubItems` = items du bloc) ; **Tout vider** ciblé par catégorie via la tirelire existante.
- **Purge globale** : bouton **Tout supprimer** en bas de la vue Box → alerte native destructive (`timeline.box.*`) → `bulkDeleteTrankilV2IntentionsByIds` + `reload()`.
- **i18n Box** : `timeline.box.clearAll|clearAllTitle|clearAllBody|clearAllConfirm|empty` ; libellé carrousel **Box** hardcodé (sans i18n).
- **Legacy** : [`clusterEngine.getBestOrphanCluster`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/clusterEngine.ts) conservé en service mais **non branché** au carrousel.

#### 2.b bis) Routines — bibliothèque d'habitudes (Le Gérer)

- **Objectif** : séparer **faire** (hub Aujourd'hui — habitudes JIT via `isHabitRowActiveForDate`) et **gérer** (toutes les routines actives, quel que soit le jour).
- **SQL** : [`ROUTINE_HABIT_WHERE`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/api/trankilV2Db.ts) — `listActiveHabitsForHub`, `countRoutineHabits`, compteur `routinesCount` ; séries via `getHabitCompletionDayKeysByIntentionIds` (`user_activity_logs`, `HABIT_DONE`).
- **Carrousel** : tuile i18n **`timeline.smartClusters.routinesTitle`** (🔁 Routines).
- **Vue catégories** : [`LivingHubCategoryModal`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/LivingHubCategoryModal.tsx) `variant="routine"` — [`buildRoutineHubBlocks`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/buildLivingHubBlocks.ts) + badge série 🔥 / ❄️ Pause ([`habitStreak.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/habitStreak.ts)).
- **Interaction** : tap **ligne** → ferme la vue puis **`openDetail`** / [`IntentionDetailSheet`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionDetailSheet.tsx) — **pas** de purge globale (contrairement à Box).
- **i18n** : `timeline.smartClusters.routinesTitle|routinesSubtitle`, `timeline.routines.title|empty|streakFire|streakPause`.
- **À venir** : bouton pause habitude dans la bottom sheet ; mini-calendrier série dans le détail.

#### 2.c) Living Hub — disposition email (Debug)

- **Objectif** : sous **Aujourd’hui**, remplacer la liste plate de cartes par un **récap email** groupé par **`category_id` Pass 1** (HOME, WORK, HEALTH, …) — miroir direct de la classification IA, sans blocs inventés (Éphéméride / Routine / Reste).
- **Activation** : `timelineLayoutMode === 'EMAIL_HUB'` **et** mêmes filtres que Smart Clusters — vue **Aujourd’hui**, contexte **ALL**, statut **TODO** (`hubEligible` dans [`TimelineScreen.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TimelineScreen.tsx)).
- **Inchangé au-dessus** : barre nav + [`SmartClustersCarousel`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/SmartClustersCarousel.tsx) (**Inbox · À acheter · Box · Routines · Projets**) — l’Inbox reste un sas séparé, le stock sans date vit dans **Box**, les **HABIT** dans **Routines**, zéro double comptage.
- **Agrégation** : [`buildLivingHubBlocks`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/buildLivingHubBlocks.ts) — `groupBy normalizeHubCategoryId(category_id)` sur le pool du jour ; **blocs vides masqués** ; tri catégories via [`hubCategoryRegistry.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/hubCategoryRegistry.ts) ; lignes avec heure inline + marqueur habitude 🔁 ([`formatHubItemLine.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/formatHubItemLine.ts)).
- **Habitudes JIT** : injection virtuelle des HABIT actives (`listActiveHabitsForHub` + [`isHabitRowActiveForDate`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/features/livingHub/habitRecurrenceEvaluator.ts)) dans le groupBy catégorie.
- **Focus modal** : tap bloc → [`IdeaBankModal`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IdeaBankModal.tsx) filtré sur les items du bloc (`onEditItem` / `ideaBankHubItems`).
- **Performance** : `getItemLayout` **désactivé** quand `hubEligible` (hauteurs variables des blocs email).
- **Rollback code** : supprimer `src/features/livingHub/` + branche `hubEligible` ; défaut `CURRENT` = zéro régression.

#### 2.d) Tirelire — actions par ligne (Inbox / hub / cluster)

- **Rangée d’actions** (par intention, statut TODO) : **[Fait ✓] [Planifier 📅] [Modifier ✏️] [Retirer 🗑️]** — boutons **icône seule** 40×40 (`styles.iconBtnIconOnly`) pour tenir sur **une ligne** ; libellés i18n (`timeline.ideaBank.done|schedule|edit|remove`) **commentés en source** (visuel validé mai 2026 — suppression commentaires = étape 2).
- **Accessibilité** : `accessibilityLabel` conservé sur chaque `Pressable` (VoiceOver / TalkBack).
- **Modifier** : prop **`onEditItem(row)`** — séquence **`onClose()`** (ferme la tirelire) puis délégation parent **`openDetail(row)`** → [`IntentionDetailSheet`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/IntentionDetailSheet.tsx) plein écran (catégorie, titre, Pass 2, persistance SQLite) — **pas** de modale sur modale.
- **Planifier projet orphelin** : inchangé — icône calendrier ; si `PROJECT` sans `start_date`, ouvre le sélecteur **Planifier le début** (`cluster.planProjectStart`).

### 3) Séquençage du Flux (Grouping Logic)

- Sticky Headers : la liste est organisée par groupes temporels (Today, Tomorrow, Week) et expose des séparateurs visuels persistants (sticky headers).
- Continuité data : le groupement est purement visuel (client-side) ; il n’altère ni les requêtes SQL, ni les paramètres de pagination (`offset/limit`), ni le moteur de tri chronologique.
- Pagination contractuelle : la mécanique de chargement incrémental (append) demeure inchangée au niveau du modèle de données ; la réorganisation en sections est reconstruite à partir du pool déjà chargé, sans modifier le calcul d’offset.

### 4) Sanctuarisation du Moteur “Undo”

- Règle d’or : le délai de persistance de 3 secondes (`pendingLocalDone`) est immuable.
- Localisation du code : la logique d’undo doit rester au niveau du parent [TimelineScreen.tsx](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TimelineScreen.tsx#L460-L1014) (timers + refs) pour garantir l’intégrité en cas de scroll, virtualisation FlatList, regroupement/sticky headers, ou changement de filtres. Aucun composant de carte (ex. `IntentionCard`) ne doit embarquer de timers ni de persistance différée.

### 5) Performance & Virtualisation

#### 5.c) Gestion des Titres Longs & Virtualisation

- Hauteur fixe : la virtualisation reste basée sur une constante fixe (ex. `CARD_ROW_H = 105`) et `getItemLayout` reste obligatoire pour la performance.
- Priorité visuelle : le titre (ligne 1) utilise un maximum de 2 lignes avant `ellipsizeMode="tail"`.
- Adaptation interne : si le titre prend 2 lignes, le padding vertical interne de la carte peut être réduit pour maintenir la hauteur totale à 105dp sans déborder.
- Contrat de lisibilité : pour les titres qui dépassent cette capacité, l’utilisateur doit pouvoir consulter le texte complet via un appui long ou via une vue détaillée (ex. TalkDebugScreen).

### 6) Contrat Visuel Timeline (Ligne 1 / Ligne 2)

- Principe : la Timeline est une vue “Zen” à charge cognitive minimale.
- Épuration totale : aucun item / jalon / sous-détail (ex. `list_scalable_v1`) ne doit être rendu dans la carte Timeline.
- Hauteur fixe : la carte Timeline conserve une hauteur fixe de 105dp, quel que soit le type d’intention.
- Interaction : tap sur le corps de la carte ouvre la Bottom Sheet de détails (consultation/édition des jalons, liste, etc.).

#### 6.a) Ligne 1 — Titre Purifié (DISPLAY TITLE CONTRACT)

- Source de vérité : utiliser `CONTENT` (Gemini) / `display_title` (SQL Timeline) comme titre principal.
- Interdiction : aucun résidu de date, heure, récurrence ou marqueur temporel ne doit apparaître dans la ligne 1.
- Fallback : si `display_title` est vide, fallback sur `title` (SQLite) ou `content_raw` tronqué, sans enrichir la carte avec des détails secondaires.

#### 6.b) Ligne 2 — Moment ou Badge NEW

- Si l’intention a une heure :
  - Détection : présence d’une heure (`dueTimeHm` / `dueDateTime` / `arrivalDue` / “time slot” selon type).
  - Affichage : `{JourLabel} • {Heure}`.
- Si l’intention n’a pas d’heure ET a été créée aujourd’hui :
  - Remplacer le moment par un badge textuel `NEW` (i18n).
- Si l’intention n’a pas d’heure ET est passée ou future :
  - Afficher `{JourLabel} • Toute la journée` (i18n).

## Détails Intention (Bottom Sheet)

### 1) UI (Bottom Sheet) & Preuve de Source

- Format : la vue détaillée d’une intention s’affiche sous forme de Bottom Sheet (panneau coulissant depuis le bas), fermable par swipe vers le bas (et tap sur le backdrop si applicable).
- Header :
  - Titre principal : `CONTENT` (display_title).
  - Sous-titre : `{JourLabel} • {Heure}` identique à la Timeline (voir contrat “Sous‑titre temporel (maquette)”).
- Gestion “Source / Note” :
  - Icône discrète (style “note”) à droite du titre.
  - Tap sur l’icône : la sheet s’agrandit légèrement et révèle un bloc Source en italique.
  - Le bloc Source est éditable (TextInput multi‑ligne) pour ajouter/modifier la note.
  - Persistance : sauvegarde immédiate dans `metadata_json.memo`.
- Bloc logique “haut de page” (toujours accessible avec clavier) :
  - Sous‑titre date/heure.
  - Adresses (TRIP) en priorité : Départ (📍) + Arrivée (🏁) en champs autocomplétés.
  - Interaction : tap sur “Jour • Heure” ouvre un sélecteur natif Date/Heure (datetime) et persiste immédiatement dans `intentions.due_date`.
  - Option “Toute la journée” : switch qui masque l’horloge et persiste `metadata_json.is_all_day=1` + `due_date=YYYY-MM-DD`.

### 2) Checkboxes (Persistance totale)

- Détection : si le contenu correspond à une liste (items séparés, tirets, puces), la vue génère des lignes avec cases à cocher.
- Persistance : l’état checked/unchecked est sauvegardé en temps réel (UPDATE immédiat) et doit survivre à un redémarrage.
- Stockage (à trancher à l’implémentation) :
  - Option A : table dédiée `intention_check_items` (recommandé pour requêtes/tri).
  - Option B : champ JSON dans `metadata_json` (plus simple, moins queryable).

### 3) TRIP — Créneau élastique & alertes

- **Switch unique** : `remind_to_leave` (*Me prévenir quand partir*) — PRO uniquement pour activer les sondes ; FREE → paywall.
- **État initial** : `remind_to_leave = 0` ; aucune sonde tant que non activé.
- **Calcul fenêtre + alertes** : moteur élastique PROBE1/2/3 (voir § Niveau 3 Mission).
- Indicateur « à valider » en Timeline :
  - Affiché si l’intention est un TRIP (ou une intention complexe) et que les détails n’ont pas été validés.
  - Disparaît dès la première interaction/validation dans la Bottom Sheet (persistée).

### 4) TRIP — Transport & Carbone

- Sélecteur de mode : 3 icônes (Auto, Marche, Vélo). Par défaut : `auto`. Le mode **transit / bus** n’est plus proposé (horaires TC non gérés) ; les valeurs legacy `transit` en base sont normalisées vers `auto`.
- Persistance : le mode de transport doit être persisté en SQLite (champ dédié ou metadata), et un champ DB peut être nécessaire.
- Icône dynamique Timeline :
  - Pour un TRIP, l’icône affichée dans la Timeline doit refléter la colonne SQLite `transport_mode` (auto/walking/bike ; legacy `transit` affiché comme auto).
  - Si `transport_mode` est vide, fallback sur l’icône avion.
  - La mise à jour doit être instantanée dès qu’un mode est sélectionné dans la Bottom Sheet (optimistic UI + persistance).
- UI épurée :
  - Le sélecteur est très espacé et sans libellés (“Trajet/Transport” supprimés).
  - Sous le switch rappel : pill créneau élastique (PRO + données PROBE1).
  - Stabilité : aucun layout shift lors du changement de mode (slot CO2/Eco‑Friendly à hauteur fixe).
- Bloc adresses (juste au‑dessus du bouton “Lancer l’itinéraire”) :
  - **Point de départ** :
    - Valeur par défaut : “Ma position” / “Position actuelle”.
    - Interaction : tap → champ éditable avec autocomplétion (Google Places) pour définir un autre départ.
    - Stockage : dans `metadata_json.trip.origin_address` (et champs associés place_id/lat/lng si disponibles).
  - **Point d’arrivée** :
    - Affichage : si une adresse exacte est connue (favori/validation), afficher l’adresse complète en couleur secondaire ; sinon afficher le nom de lieu extrait par l’IA (ex. `destination_name`) comme indicateur.
    - Interaction : tap → autocomplétion (Google Places) pour valider/affiner l’adresse.
    - Stockage : l’adresse d’arrivée validée est la source de vérité pour les sondes élastiques.
- Recherche contextuelle (Saved information) :
  - À l’affichage, si `destination_name` correspond à un alias enregistré (ex. “Mami”), la vue doit résoudre l’adresse sauvegardée et l’utiliser comme arrivée par défaut.
  - Source : table locale de favoris (ex. `location_favorites`) ou autre stockage équivalent.
- **Auto-apprentissage silencieux (favoris)** :
  - Lors du `onSelect` Google Places sur le champ **Arrivée**, si `metadata_json.trip.destination_name` est renseigné (alias IA, ex. “Jean-Pierre”, “Travail”), exécuter en tâche de fond un `upsertLocationFavorite` (alias → `formattedAddress`, `lat`, `lng`) dans `location_favorites`.
  - **Aucune** alerte ni pop-up utilisateur ; échec silencieux (`catch` sans UI).
- Indicateur carbone :
  - Walking/Bike : badge “Eco‑Friendly”.
  - Auto : texte d’impact estimé (ex. “Impact CO2 standard”).
- **Confort de trajet — créneau élastique (UI épurée)** :
  - Sous le bloc Transport : pill avec fenêtre `[ HH:mm – HH:mm ]` dérivée de `metadata_json.trip` (`elastic_start_ms` / `elastic_end_ms`).
  - Variantes i18n : `comfortElasticDeparture`, `comfortElasticDepartureApprox` (≈), `comfortElasticDepartureShifted` (⚠️), `comfortElasticDeparturePending`.
  - Lecture via [`tripElasticDisplay.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/tripElasticDisplay.ts) — **aucun polling**, **aucune** lecture SQLite `sentinel_trips` depuis la sheet.
- Action : bouton “Lancer l’itinéraire” (`intentionDetail.launchRoute`) :
  - **Actif** si coords **arrivée** valides (`location_lat` / `location_lng`).
  - Origine : `origin_lat` / `origin_address` **ou** « Ma position » (origine vide → Maps/Waze utilisent la position courante).
  - **Désactivé** + hint `launchRouteDisabledHint` + log `[TRIP-NAV] 🚫 Cannot launch: Missing coordinates` si coords destination absentes.
  - Deep link : `origin` si départ précisé, sinon position courante côté app cartes ; `destination` = adresse d’arrivée ; `travelmode` selon mode (auto/walking/bike).
- Deep link universel (sélecteur natif) :
  - Android : utiliser un schéma `geo:0,0?q=` pour déclencher le sélecteur natif si plusieurs apps GPS sont installées.
  - iOS : ouvrir via schémas natifs (Apple Maps / Google Maps / Waze) et afficher un sélecteur natif (ActionSheet) si plusieurs fournisseurs sont disponibles.
  - Les schémas externes (ex. `waze://`, `comgooglemaps://`) nécessitent l’autorisation iOS `LSApplicationQueriesSchemes` dans la config Expo.

#### Règle de visibilité “zéro flags” (robustesse UI)

- Principe : la validation d’une adresse ne repose pas sur un booléen UI mais sur la présence de coordonnées persistées.
- Arrivée (source de vérité) :
  - Lors d’une saisie manuelle dans le champ Arrivée (`onChangeText`) : vider immédiatement `metadata_json.trip.location_lat` / `location_lng` (et champs associés) pour marquer l’arrivée comme non exploitable.
  - Lors de la sélection d’une suggestion Google Places (`onSelect`) : renseigner immédiatement `metadata_json.trip.location_lat` / `location_lng` (+ `location_place_id`, `location_address`) pour marquer l’arrivée exploitable.
  - Condition d’affichage bloc Mission / créneau : `metadata_json.trip.location_lat` présent (indépendant du Départ).
- Départ (deep link uniquement) :
  - Lors d’une saisie manuelle dans le champ Départ : vider `metadata_json.trip.origin_lat` / `origin_lng`.
  - Lors de la sélection Places : renseigner `origin_lat` / `origin_lng` (+ `origin_place_id`, `origin_address`).
  - Affichage par défaut « Ma position » si `origin_address` vide ; **pas** de lecture GPS device dans la sheet pour ce libellé.
- Bouton GPS (GO) — `canLaunchNavigation` :
  - Afficher pour tout TRIP ; **activer** si coords **arrivée** valides.
  - Origine vide = « Ma position » (deep link sans `origin`).
  - **Ne pas** exiger de scan PROBE1 ni coords départ pour activer le bouton.

### 5) Synchronisation (Top‑Down Sync)

- Temps réel : toute modification (heure, mode de transport, switch rappel, checkbox, adresses départ/arrivée) déclenche un UPDATE SQL immédiat via le repository.
- Changement destination avec mission active → `resetTripMissionAndRelaunchProbe1` ; désactivation rappel / suppression → `cancelTripMission`.
- Persistance adresse : toute adresse d’arrivée validée doit être sauvegardée immédiatement dans `intentions.location_address` (en plus du JSON).
- Refresh : la Timeline se rafraîchit automatiquement en arrière‑plan (icône triangle, heure, sous‑titre, etc.).
- Gestion clavier :
  - Utiliser `KeyboardAvoidingView` (ou équivalent) et un footer fixe (bouton itinéraire) pour que les champs Places restent accessibles au‑dessus du clavier.

## OneTap LIST / PROJECT — Pipeline 2-Pass (Classification + Enrichissement à la demande)

### Objectif

- Transformer les intentions de type `LIST` et `PROJECT` en structures actionnables en **deux temps** :
  - **Pass 1** (capture) : classification + Bullet‑Pipe + persistance « Zen ».
  - **Pass 2** : enrichissement **uniquement** après **`pass2_unlocked: true`** et action utilisateur (pas d’enchaînement automatique depuis Pass 1).
- Résultat attendu après Pass 2 (une fois déclenché) :
  - `LIST` : inventaire scalable (quantités / multiplicateur).
  - `PROJECT` : jalonnement temporel (durées estimées + cascade à partir d’une date de départ).

### Pass 1 — Classification

- Format de réponse Gemini : **Few-Shot JSON universel** (`{"intents":[...]}`) — contrat détaillé § **2) Recette du prompt Pass 1**.
- Rôle : détecter le `TYPE`, extraire un titre propre, `category`, `context` ; champs spécifiques TRIP/LIST/HABIT/PROJECT/TASK (voir tableau § 2.d).
- **Transport** : `systemInstruction` (règles + exemples) + user (`NOW` / `SEED` / `INPUT`) — modèle RC Pass 1, `maxOutputTokens: 2048`.
- **Prompt** : `buildOneTapPass1SystemInstruction(now)` + `buildOneTapPass1UserContent(transcript, seedLine, now)`.

### Pass 2 — Enrichissement (LIST / PROJECT)

- **Déclenchement** : uniquement après `pass2_unlocked: true` + action CTA PRO — voir § Verrou sémantique.
- **Prompt & transport** : voir § **Prompt Pass 2 — enrichissement LIST / PROJECT** (texte intégral inline, paramètres API, post-traitement unités).
- **Implémentation** : [`geminiEnrichGenericList`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts) depuis `IntentionDetailSheet` uniquement.
- Sorties attendues :
  - `LIST` : JSON strict conforme au schéma `list_scalable_v1` (inventaire).
  - `PROJECT` : JSON strict conforme au schéma `project_milestones_v1` (jalons + durées, sans dates).
- Fusion :
  - `LIST` : persister sous `metadata_json.list_scalable_v1` via `buildListMetadataPatch`.
  - `PROJECT` : persister sous `metadata_json.project_milestones_v1` (et `metadata_json.project.start_date`).
- Standardisation “Hidden Persona” :
  - Contrat : chaque jalon généré (Pass 2 PROJECT) doit inclure `expert_persona` (obligatoire).
  - Si le contexte est général : utiliser `"Assistant Personnel"`.
  - Stockage : persister `expert_persona` en SQL au niveau jalon (colonne dédiée si disponible, sinon via `metadata_json.project_milestones_v1.milestones[].expert_persona` + patch SQL).

### Prompt Pass 2 — enrichissement LIST / PROJECT

**Source** : [`geminiEnrichGenericList`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts) · constantes `PASS2_LIST_INLINE_PROMPT` / `PASS2_PROJECT_INLINE_PROMPT`.

##### Architecture transport (état mai 2026)

| Paramètre | Valeur |
|-----------|--------|
| **Modèle** | `getActivePass2ModelId()` → RC `gemini_pass2_model_id` (défaut compilé `gemini-pro-latest`) |
| **systemInstruction** | **absent** — tout le prompt est inline dans le message user |
| **Transcript** | injecté dans le bloc `Transcription:` du prompt (max 10 000 car.) |
| **Operation** | `lab.list_enrich_generic` |
| **generationConfig** | `temperature: 0.18` · `maxOutputTokens: 2048` · **sans** `responseMimeType` |
| **Pré-appel** | `ensureFreshPassModelsFromRemoteConfig()` + `logPass2ModelSteeringDiagnostics` |

> **Régression corrigée** : split system/user + `maxOutputTokens: 1536` tronquait les listes recette. Version validée = prompt inline unique + 2048 tokens.

##### Prompt LIST (`PASS2_LIST_INLINE_PROMPT`) — texte intégral

```
Tu es un expert en logistique et planification. Ton rôle est de décomposer une intention en une liste structurée et actionnable.

Consignes strictes :
Miroir Linguistique (CRITIQUE) : Réponds impérativement dans la même langue que la dictée de l'utilisateur (Français, Anglais, Espagnol, etc.).
Analyse le domaine :
- Si c'est une recette : décompose en ingrédients (Boucherie, Légumes, etc.).
- Si c'est une étude/examen : décompose en chapitres ou sessions.
- Si c'est un objectif/projet : décompose en jalons ou étapes clés.
Unités adaptatives : Détecte l'unité la plus pertinente (kg, jours, chapitres, séances).
Scalabilité : scalable=true pour les items dont la quantité dépend de la cible (ex: ingrédients pour X personnes).
Format : Réponds uniquement par un objet JSON pur suivant le schéma list_scalable_v1. Ne mets aucune explication avant ou après.

Transcription:
"""<transcript>"""

Schéma attendu (JSON pur, clés exactement comme ci-dessous) :
{"title": string, "baseCount": number, "unitLabel": string, "categories": [{"name": string, "items": [{"name": string, "baseQuantity": number, "unit": string, "scalable": boolean}]}]}
```

**Sémantique JSON LIST** :
- `baseQuantity` = quantité **par personne** (ou par unité cible) ; UI multiplie par `baseCount` si `scalable: true`.
- `unitLabel` = libellé de la cible (ex. `personne`, `personnes`).
- Catégories = rayons logiques (Boucherie, Épicerie sucrée, …).

##### Prompt PROJECT (`PASS2_PROJECT_INLINE_PROMPT`) — texte intégral

```
Tu es un expert en planification de projets. Ton rôle est de décomposer une intention en jalons/étapes clés.

Consignes strictes :
Miroir Linguistique (CRITIQUE) : Réponds impérativement dans la même langue que la dictée de l'utilisateur.
INTERDICTION : ne fournis aucune date (pas de YYYY-MM-DD, pas de "lundi", pas de "demain", pas d'horaires).
À la place, fournis pour chaque jalon une durée estimée.
Pour chaque jalon, identifie l'expert métier le plus qualifié (ex: Électricien, Acousticien, Diététicien, Wedding Planner). Si le contexte est général, utilise "Assistant Personnel".

Transcription:
"""<transcript>"""

Schéma attendu (JSON pur, clés exactement comme ci-dessous) :
{"title": string, "milestones": [{"title": string, "estimated_duration": number, "unit": "hours|days|weeks", "expert_persona": string}]}
```

##### Post-traitement réponse Pass 2

1. **Parse JSON** : [`parseGeminiListInventoryJson`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/listIntentionModel.ts) / [`parseGeminiProjectMilestonesJson`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/projectMilestonesModel.ts) — strip fences markdown · isolation entre première `{` et dernière `}`.
2. **Unités LIST** (`normalizeUnit`) :
   - **Conservées telles quelles** : `g`, `kg`, `ml`, `cl`, `l`, et unités libres (`sachets`, `pincées`, `cuillères`, …).
   - **`unités` / `units` / `unité`** → chaîne vide `""` (affichage « 20 Œufs » sans « unités »).
   - **`pcs` / `pièces`** → `piece` · inconnu → `piece`.
3. **Persistance** : `geminiJsonToStoredPayload` → `metadata_json.list_scalable_v1` ou `project_milestones_v1`.
4. **Logs dev** : [`logAiInteraction`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/logAiInteraction.ts) pass 2 / `REASONING` · `RAW RESPONSE` même en échec parse.

**Cible migration** : porter les blocs ci-dessus en `systemInstruction` proxy ; corps user = `Transcription:` seule.

### Données projet (metadata_json)

- Pour `PROJECT`, `metadata_json` doit contenir :
  - `project.start_date` : `YYYY-MM-DD` (nullable) — “top départ” utilisateur.
  - `project_milestones_v1` : payload jalons.
- **Replan depuis `start_date`** : [`replanProjectMilestonesFromStartDate`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/projectMilestonesModel.ts) recalcule les `pivot_date` des jalons à partir d’une date de début (utilisé par la fiche projet et par la Tirelire / cluster orphelin).
- Les durées estimées remplacent le mécanisme de quantités (multiplicateur réservé à `LIST`).

## ARCHITECTURE IA (Latence)

Objectif : **réduire la latence** (TTFB, temps jusqu’aux cartes peek / Pass 1), **le coût en tokens** sur le rôle utilisateur, et la taille des payloads réseau, en séparant clairement **ce qui est stable** (règles métier) **de ce qui est dynamique** (temps de référence + transcript).

### Contrat `systemInstruction` (Firebase / proxy) vs client

- **Pass 1 et Pass 2** : l’intégralité des « prompts » métier (segmentation Bullet‑Pipe, contrats TRIP / DISPLAY TITLE, enrichissements LIST / PROJECT, logistique & entités, etc.) doit être **déclarée et versionnée côté serveur** — [`functions/src/index.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/functions/src/index.ts) (proxy Firebase) et/ou couches Vertex associées — sous forme de **`systemInstruction`** (une SI par rôle Pass 1 / Pass 2, ou jeux SI par mode si besoin). **Aucun** de ces blocs ne doit plus être reconstruit ou embarqué dans le binaire comme corps « user » volumineux pour chaque capture.
- **Application cliente** : pour l’appel d’extraction principal (dictée → modèle), le rôle **utilisateur** transporte :
  - **`NOW`** : horodatage local formaté `YYYY-MM-DD HH:mm` (heure locale, jamais UTC) + fuseau + jour de semaine + index ISO,
  - **`SEED`** : squelette Path A sérialisé (hint chrono-node local),
  - **`INPUT`** : texte final de la dictée (max 12 000 chars, triples guillemets collapsés).
- **Pass 2 hors capture automatique** : **aucune** chaîne « Pass 1 terminé → lancer Pass 2 ». Le Pass 2 n’est invoqué **qu’après** **`pass2_unlocked: true`** (et action utilisateur). Côté transport, l’app n’envoie **pas** les blocs de règles Pass 2 : **uniquement** des données minimales (identifiant intention, transcript ou mémo déjà stocké, sortie Pass 1 persistée si nécessaire) ; les **règles** restent en **`systemInstruction`** sur le **proxy Firebase**.
- **Pass 2 à la demande — SLA latence** : même déclenché **plus tard** (réouverture fiche, longtemps après Pass 1), l’appel doit réutiliser la **même architecture** (modèle + SI dédiée côté Firebase) et viser une **réponse exploitable en moins de 3 secondes** (charge utile courte, pas de re‑injection des prompts longs côté client).

> **État actuel (pont)** : Pass 1 — bloc contractuel assemblé dans [`oneTapUniversalCapture.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapUniversalCapture.ts) (`systemInstruction` + user compact `NOW` / `SEED` / `INPUT`). Pass 2 LIST/PROJECT — prompt inline dans [`geminiSemanticLab.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts) (restauré mai 2026 après régression `maxOutputTokens: 1536` + split system/user). La migration consiste à **déplacer** ces blocs vers les SI déployées avec le proxy.

### Protocole de pré‑warming (session Gemini)

- **Déclencheur** : dès que **`isMicActive === true`** (micro prêt à capter — ex. [`TalkCaptureMicButton.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TalkCaptureMicButton.tsx) après permissions / entrée en écoute STT), l’app doit **initialiser ou réattacher** une **session vers le proxy / Gemini** (handshake HTTP/TLS, éventuellement première négociation modèle, réutilisation de connexion keep‑alive, ouverture de canal SSE si le protocole le permet).
- **Contenu** : appel **léger** autorisé (ping, `generateContent` minimal, ou endpoint dédié `warm` / health) **sans** transcript final ni charge utile lourde — uniquement ce qui suffit à établir la session et à charger côté Google les **SI déjà attachées** au modèle ou au cache explicite.
- **Mesure** : la baisse attendue se lit sur **stop micro → premier byte SSE** (ou TTFB) et sur **stop → première carte peek** ; à instrumenter en prod / debug.

### 1) Pass 1 — Segmentation (classification + Bullet‑Pipe)

- **System instruction (proxy)** : contient toutes les règles aujourd’hui injectées dans le prompt Pass 1 (miroir linguistique, contrats TRIP / titre affichable, mapping catégories, format de sortie strict, exceptions multi‑intentions `**`, etc.).
- **Corps utilisateur (client)** : uniquement **`Reference Time`** + **`Transcript`** (schéma texte libre ou JSON minimal selon contrat proxy — pas de duplication des règles).
- **Effets attendus** : moins de tokens « user », charge réseau réduite, TTFB et apparition des cartes **plus rapides**.
- **`maxOutputTokens` (Pass 1)** : dimensionner pour le **pire cas** dicté (ex. **4 intentions** en sortie Bullet‑Pipe + marge). Les valeurs actuelles dans [`geminiSemanticLab.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts) (souvent `512` sur certains appels « lab ») doivent être **revues** si des troncatures apparaissent sur multi‑intentions ; viser une marge explicite documentée après QA.

### 2) Pass 2 — Logistique, entités et enrichissements (à la demande)

- **Garde produit** : le Pass 2 ne part **jamais** seul après Pass 1 ; il est **strictement conditionné** à **`pass2_unlocked: true`** + action utilisateur (détail dans § OneTap LIST/PROJECT et Douane de persistance).
- **Paramètres validés (LIST/PROJECT, mai 2026)** : `temperature: 0.18`, `maxOutputTokens: 2048`, pas de `responseMimeType` forcé (le JSON mode natif + plafond `1536` avait provoqué des troncatures `Unexpected end of input` sur listes recette).
- **System instruction dédiée (cible proxy / Firebase)** : toute la logique d’**extraction / structuration fine** (règles JSON LIST / PROJECT, etc.) doit migrer vers une **seconde** `systemInstruction` côté serveur ; **aujourd’hui** le prompt complet reste inline côté client (voir § *Prompt Système Gemini (Pass 2)*).
- **Corps utilisateur (cible)** : transcript seul ; **aujourd’hui** : règles + `Transcription:` dans un seul message user.
#### Parallélisation réservée (`Promise.all`)

- La parallélisation **ne s’applique que** si (a) l’utilisateur dispose d’un bouton **« Enrichir tout »** (futur) qui lance explicitement un lot d’enrichissements Pass 2, **ou** (b) l’utilisateur **déverrouille plusieurs intentions en une seule action simultanée** (même geste / même transaction produit). **Sinon**, le traitement Pass 2 reste **unitaire** : **une** intention déverrouillée → **un** appel enrichissement à la fois (pas de `Promise.all` implicite). Dans tous les cas, cela **ne** remplace **pas** la règle séquentielle **chunk N → DB** du séquenceur de **capture** (dictée multi‑chunks).
- **Alignement** : les prompts LIST / PROJECT (§ *Prompt Système Gemini (Pass 2)*) sont la **référence** à fusionner dans ces `systemInstruction` côté serveur.

### 3) Firebase, proxy et Context Caching (Vertex)

- **Objectif** : exploiter le **Context Caching** de Vertex AI (contenu système / préambule réutilisable facturé ou servi à coût réduit) lorsque l’API et les SDK utilisés par le projet l’exposent.
- **Contrainte actuelle** : l’app appelle Gemini **via** le proxy Firebase ([`functions/src/index.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/functions/src/index.ts)) avec `{ modelId, systemInstruction, request }`. Toute stratégie de cache explicite (resource `cachedContent`, TTL, etc.) doit être **implémentée ou relayée** dans ce proxy (ou migrer vers un chemin SDK serveur Vertex/Firebase AI **si** équivalent sécurité + auth). Tant que le proxy ne transmet qu’un corps texte sans cache ID, le bénéfice reste limité au **cache implicite** éventuel côté Google.
- **Livrable** : documenter dans le dépôt (commentaire proxy ou doc technique) le choix **implicite vs explicite** + métriques (`usageMetadata`, coût) une fois branché.

### 4) Monitoring, debug et verbosité

- **[`logAiInteraction`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/logAiInteraction.ts)** (`__DEV__`) : blocs audit Pass 1 / Pass 2 (modèle, latence, config, tokens, prompt, **`RAW RESPONSE` même en échec parse** — affiché avant `ERROR` pour diagnostiquer JSON tronqué ou bavard).
- **`[GeminiDebug]`** (ex. [`oneTapUniversalCapture.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapUniversalCapture.ts) — log `FULL_PROMPT_SENT`, [`geminiSemanticLab.ts`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts)) : ne plus journaliser des **milliers de tokens** de consignes désormais portées par `systemInstruction`. Journaliser uniquement :
  - les **données dynamiques** (référence temps, en-tête de transcript, hash ou longueur, identifiants trace),
  - les **latences** (TTFB, durée totale, durée persistance DB),
  - les **compteurs tokens** renvoyés sur l’événement SSE `done` (déjà contractuels côté proxy),
  - en mode verbeux optionnel : un **extrait court** de la sortie modèle (déjà partiellement pratiqué pour les erreurs Bullet‑Pipe).
- **Alignement** : rester cohérent avec [`docs/STABILITY_SPEC_ONETAP_GEMINI.md`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/docs/STABILITY_SPEC_ONETAP_GEMINI.md) (`VERBOSE_DEBUG` hors prod).

### 5) Critères d’acceptation (implémentation future)

- [ ] Pass 1 : corps user = **Reference Time** + **Transcript** ; règles = `systemInstruction` (proxy).
- [ ] Pass 2 : **aucun** déclenchement auto après Pass 1 ; uniquement si **`pass2_unlocked: true`** ; corps user minimal ; règles = SI dédiée (Firebase) ; latence cible **moins de 3 secondes** ; `Promise.all` **uniquement** si bouton **« Enrichir tout »** (futur) ou déverrouillage **multi‑intentions simultané** explicite — **sinon** enrichissement **séquentiel / unitaire** par intention déverrouillée.
- [ ] Pré‑warming micro : mesurable en baisse du délai stop → première carte / premier byte SSE (à tracer).
- [ ] Aucune régression sur troncature : sorties complètes pour dictées **jusqu’à 4 intentions** (ajustement `maxOutputTokens` + tests).
- [ ] Logs debug sans dump de prompt complet en prod ; latences et tokens toujours visibles pour l’équipe.

## Pipeline Unique — “Micro as a Bulk(1)”

### Objectif

- Unifier définitivement la qualité de traitement : une dictée micro est traitée exactement comme un Bulk de taille 1.
- Supprimer les divergences de validation/ventilation : la “Douane” Bulk devient la source de vérité pour Micro.
- Garantir un `category_id` non nul partout (via normalisation systématique).

### 1) Unification du matériel (UI)

- **Calque global** : le micro et l’overlay pipeline sont montés **une fois** dans [`GlobalCaptureOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/GlobalCaptureOverlay.tsx) ([`App.tsx`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/App.tsx)), au-dessus de la navigation. TalkDebugScreen et TimelineScreen **ne montent plus** de `TalkCaptureMicButton` local.
- TalkDebugScreen ne doit contenir **aucune logique maison** de capture audio / STT (permissions, enregistrement, STT, orchestration overlay).
- Les écrans configurent la **présentation** via [`CapturePresentationContext`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/context/CapturePresentationContext.tsx) (`variant`, `dashboardPipelineHost`, `compact`, `micHidden`, `disabled`).
- Contrat : permissions, STT natif, enregistrement audio, animation et logs capture restent centralisés dans `TalkCaptureMicButton` ; comportement identique Debug/Timeline selon la config de présentation.

#### 1.a) Correction manuelle du transcript STT (optionnelle)

- **Objectif** : permettre à l’utilisateur de corriger la transcription STT **avant** l’envoi au proxy Gemini (Pass 1), pour maximiser la fidélité au sens voulu. La correction reste **optionnelle** : sans action sur le crayon, le flux inchangé (STT brut → `submitCapturePayload`).
- **UI** — [`TalkCaptureMicButton`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/TalkCaptureMicButton.tsx) (Talk Debug + Timeline) :
  - Pendant la dictée (`phase === 'recording'`), barre d’actions standard : **Corbeille** · **Pause** · **Crayon** (`Pencil`) · **Envoyer** (`SendHorizontal`).
  - Clic **Crayon** : `LayoutAnimation` (easeInEaseOut) → `isEditingTranscription = true` ; snapshot STT figé (`sttSnapshotRef`) ; le flux STT **n’écrase plus** le texte ; `TextInput` (`CaptureTranscriptEditor`, `autoFocus`).
  - **Mode édition — barre de validation** (remplace Pause/Crayon) :
    - **Poubelle** (gauche) : `Keyboard.dismiss()` puis annulation capture (`cancelRecording`, comportement poubelle habituel).
    - **Check** (droite) : validation du texte — `Keyboard.dismiss()`, `isEditingTranscription = false`, puis arrêt audio/STT + `submitCapturePayload` (texte corrigé).
  - **Remontée clavier** : le bloc capture entier (transcript + barre) est translaté via `translateY` animé, piloté par `keyboardWillShow` / `keyboardWillHide` (iOS) ou `keyboardDidShow` / `keyboardDidHide` (Android), avec décalage `hauteurClavier − safeArea.bottom + 20px` (hébergé dans le calque global en variante TalkDebug).
  - Clic **Envoyer** (hors mode édition) : arrêt audio/STT, nettoyage (`cleanTranscriptText`), puis `submitCapturePayload` avec le texte **final** (STT ou corrigé).
- **Pipeline** — [`IntentionContext.submitCapturePayload`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/context/IntentionContext.tsx) :
  - Paramètre optionnel `transcriptOriginal` : transcript STT nettoyé **avant** correction manuelle.
  - `transcript` (champ principal) = **source de vérité** pour Path A, bulk Gemini et file offline.
  - Si `transcriptOriginal` est fourni et diffère du final : `userEditedRef` positionné ; logs **`[CAPTURE_FLOW]`** phase `transcript_manual_edit` + **`[MIC] ✏️`** en `__DEV__` avec `transcript_original` vs `transcript_final`.
- **Overlay progression** — [`AIUniversalProgressOverlay`](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/components/AIUniversalProgressOverlay.tsx) : expose les mêmes primitives (`CaptureTranscriptEditor`, props transcript optionnelles) pour réutilisation ; l’édition produit se fait **avant** l’overlay Pass 1 (pendant la dictée), pas pendant `pipeline_wait`.

### 2) Unification du cerveau (IntentionContext)

**Contrat absolu : il n’existe plus qu’un seul chemin de traitement/persistance dans `IntentionContext`.**  
`submitCapturePayload` est un wrapper **mince** autour du séquenceur `runGeminiBulkSequence` (micro = Bulk de 1) et **doit** `await` la fin du séquenceur avant de retourner (pas de « fire-and-forget »). Il retourne **`Promise<boolean>`** : `true` lorsque la capture est considérée comme **sûrement persistée ou file offline** (y compris enqueue NetInfo « offline » ou enqueue auto réseau après échec chunk) ; `false` si l’utilisateur peut encore perdre la donnée (ex. Alert `proposeOfflineFallback` sans action, annulation de séquence `seq`).

#### 2.a) Wrapper “Micro = Bulk(1)” (submitCapturePayload)

- Toute capture unitaire (micro **ou** saisie texte) est routée vers `await runGeminiBulkSequence`, même si le transcript ne contient pas `**`.
- Mécanique : forcer `chunks=[cleanedTranscript]` pour imposer le chemin “Séquenceur” (CHUNK 1/1), sans heuristique de split.
- Paramètres obligatoires à transporter jusqu’au bulk :
  - `transcript` (string) : texte final “clean” (trim + nettoyage des suffixes UI si nécessaire) — **source de vérité** pour Gemini / offline (y compris après correction manuelle STT).
  - `transcriptOriginal` (string optionnel) : snapshot STT nettoyé avant correction crayon ; sert aux logs `transcript_manual_edit` uniquement.
  - `audioUri` (string|null) : si micro, le chemin du mémo ; sinon `null`.
  - `lang` (BCP47 optionnel) : langue session STT (si connue).
  - `traceId` (string optionnel) : identifiant de trace micro (logs).
- Peek / Validation UI (hauteurs **% viewport** — Path A ~**5 %**, Path B ~**25 %**, full capture ~**95 %** ; voir § IntentionDetailSheet / Capture Flash) :
  - `submitCapturePayload` émet `INTENTION_PEEK_SNAPSHOT_EVENT_NAME` **avant** `NetInfo.fetch()` et **avant** l’appel bulk (snapshot Path A : catégorie/type/titre) — y compris lorsque la suite ira en file offline.
  - `submitCapturePayload` émet `INTENTION_PEEK_FIRST_SAVE_EVENT_NAME` **après** persistance confirmée (branche en ligne uniquement), via callback `onPersisted(outcomes)` en remontant un `intentionId` réel.
- Valeur de retour : le booléen sert notamment au **rejouage** `analyzeLatestOfflineAudio` : ne pas appeler `markOfflineAudioAsDone` sur la ligne `offline_audio_queue` tant que `submitCapturePayload` n’a pas retourné `true`.

#### 2.b) Séquenceur unique (runGeminiBulkSequence)

- Le séquenceur reste **séquentiel** : pour chaque chunk, enchaînement « Gemini (non-stream) → `persistOneTapDraftVentilated` → succès DB » avant d’entamer le suivant.
- **Verrou strict** : si `persistOneTapDraftVentilated` retourne `!ok` ou lève une exception pour le chunk *i*, la boucle s’interrompt (`break`) — **aucun chunk *i+1*** tant que le chunk *i* n’a pas été persisté avec succès — **sauf** si un enqueue offline auto (réseau/serveur) a pris le relais pour le reste du contenu (voir §2.c).
- Persistance : **toute persistance passe par `persistOneTapDraftVentilated`** (ventilation = source de vérité), y compris pour le micro (Bulk(1)).
- **Zoom jalon projet** : `triggerJalonZoom` réutilise le bulk avec **`allowAutoOfflineQueue: false`** pour éviter d’enfiler le prompt interne de décomposition dans la file utilisateur en cas d’erreur réseau.
- Contrat NOTE_FALLBACK :
  - En mode Bulk (dont micro-as-bulk), le séquenceur passe `allowNoteFallback: false` et préfère :
    1) log d’échec chunk,
    2) **enqueue auto** vers `offline_audio_queue` si l’erreur est classée réseau/serveur (voir §2.c),
    3) sinon Alert `proposeOfflineFallback` si aucun chunk n’a pu être persisté **et** aucun enqueue auto n’a réussi.

#### 2.c) Offline-first (invariant)

- **Ordre** : Path A + `INTENTION_PEEK_SNAPSHOT` → `NetInfo.fetch()` → branche offline **ou** `runGeminiBulkSequence` (jamais d’inversion peek / réseau).
- **NetInfo « en ligne » (SPEC v34)** : `online = isConnected === true && isInternetReachable !== false` (`isNetInfoConsideredOnline` dans [offlineStability.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/offlineStability.ts)) : `isInternetReachable === null` **autorise** le chemin Gemini (évite faux négatifs plateforme) ; seul **`false`** force la file offline. Un log **`[OFFLINE-STABILITY] phase=netinfo_online_null_reachable`** est émis lorsque ce chemin « en ligne » est pris avec `isInternetReachable == null` (`submitCapturePayload` et listener NetInfo de rejouage).
- **Métadonnées NOTE file** : toute intention créée par `queueOfflineAudioCapture` / `queueOfflineTextCapture` porte dans `metadata_json` au minimum `source: 'offline_audio_queue'`, **`persistence_label`: `'NOTE_FALLBACK'`**, **`tag`: `'NOTE_FALLBACK'`** (harmonisation sémantique avec le vocabulaire retry / Timeline). Le filtre « NOTE technique masquée » (`isHiddenTechnicalNoteFallbackRow`) **n’applique pas** ce masque lorsque `metadata_json.source === 'offline_audio_queue'` : la note reste **visible** sur la Timeline.
- Si l’app est offline (NetInfo), `submitCapturePayload` ne doit **pas** tenter Gemini :
  - il enfile immédiatement la capture via `queueOfflineAudioCapture` / `queueOfflineTextCapture`,
  - insère une NOTE `is_pending_ai=1`,
  - émet `INTENTIONS_CHANGED_EVENT_NAME`,
  - retourne **`true`** (donnée file côté SQLite).
- **En ligne**, échec réseau/serveur **pendant** un chunk : `runGeminiBulkSequence` enfile automatiquement le **reste** des chunks (texte) ou le **transcript complet + audio** si aucun chunk n’avait encore été persisté (`queueOfflineTextCapture` / `queueOfflineAudioCapture`), puis retourne un indicateur **`safeToDrainOfflineReplaySource`** consommé par `submitCapturePayload` pour le booléen global. La phase **`bulk_network_resilience_enqueue`** est journalisée (`logCaptureFlow` / `notifyCapturePipelineProgress`) pour corrélation UI (dashboard orange Talk).
- **Rejouage file** : `analyzeLatestOfflineAudio` appelle `submitCapturePayload` **sans** marquer la ligne `done` avant succès ; `markOfflineAudioAsDone` n’est invoqué que si le booléen retourné est `true`.

#### 2.d) Suppression des chemins redondants (simplicité = stabilité)

- `IntentionContext` ne doit plus contenir de chemin alternatif qui appelle directement :
  - `refineOneTapWithGeminiCompressed(...)` **en dehors** du séquenceur bulk (le séquenceur reste le seul orchestrateur Gemini côté contexte),
  - `persistOneTapDraft(...)` (hors `persistOneTapDraftVentilated`).
- Les helpers « streaming UI » (pré-save optimiste par intention, `confirm` modal, etc.) ne font plus partie du contexte : le bulk ventilé suffit.

#### 2.e) Schéma offline + « stream global » parasite (contrat)

- La table `offline_audio_queue` et ses index sont créées au **bootstrap** SQLite (`initTrankilV2Schema`) ; les services de queue ne redéclarent pas le DDL.
- Heuristique **réseau / serveur** (enqueue auto, logs `[OFFLINE-STABILITY]`) et **gating NetInfo** (`isNetInfoConsideredOnline`) : [offlineStability.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/utils/offlineStability.ts).
- Interdiction : aucun déclenchement Gemini « parallèle » pendant la dictée en contournant le séquenceur (`oneTap.wire.stream` réservé à des usages internes hors `IntentionContext` si un jour réactivé).
- `geminiStartedRef` ne doit être manipulé que par le chemin `submitCapturePayload → runGeminiBulkSequence`.
- Le log `[MIC] ⏳ SKIP Gemini (already started)` doit disparaître (plus de compétition de verrous).

### 3) Instrumentation Pass 2 (visibilité)

- Ajouter des logs explicites pour confirmer l’enrichissement Pass 2 **à la demande** (après `pass2_unlocked`) :
  - `LOG [Pass2] 🚀 START_ENRICHMENT | ID: {id} | Type: {type}`
  - `LOG [Pass2] ✅ SUCCESS_ENRICHMENT | ID: {id}`

### 4) Sécurité catégorie & contexte (SQLite)

- Contrat : toute persistance doit passer par `normalizeDomainCategoryId(...)` (oneTapPersist) et `normalizeIntentionCategoryId(...)` (repository) pour produire un `category_id` non-null.
- En cas de code inconnu : fallback explicite `PERSO`.
- `context_tag` : alimenté depuis `draft.contextTag` (Pass 1) ; normalisé via `normalizeOneTapContextTag` ; nullable en base si l’IA n’a rien fourni.
- Log post-insert : `[DATABASE] ✅ Intention sauvée avec succès | Category: … | Context: …`.

## Bottom Sheet PROJECT — “Temporalitas” (V3 — Flat / Drive)

### 1) Header — Bloc “Temporalitas”

- Design : à plat, sans neumorphisme (pas d’ombres “inset/raised”).
- Structure :
  - Titre projet : en haut (typographie standard, noir pur, poids moyen) — éditable inline (V3.2).
  - Séparateur : ligne fine sous le titre (1px).
  - Ligne dates : date de début (cliquable) + date de fin (statique) sur une seule ligne.
- Date de départ :
  - Affichage : texte cliquable simple (souligné ou couleur primaire).
  - Interaction : tap ouvre un DatePicker (date seule).
- Date de fin (dynamique) :
  - Calculée : `end_date = start_date + Σ(durées_jalons)` (selon le mode calendrier décrit ci-dessous).
  - Affichage : texte statique à côté de la date de départ (ou “—” si pas de start_date).

### 2) Corps — Ligne de vie (Cascade tactîle)

- Objectif : lisibilité et scannabilité (style Google Drive), rail graphique invisible.
- Règle de mise en page :
  - Les cercles de gauche doivent être verticalement alignés (effet “rail” implicite).
  - Whitespace suffisant entre les lignes ; pas de connecteur dessiné.
  - Séparation par bordure fine entre jalons (`border-b` 1px) plutôt que par ombres.

#### Structure d’une ligne (jalon)

- Colonne gauche (actionnable) :
  - Cercle fin discret (stroke 1px).
  - Toggle “fait” : au clic, le cercle se remplit avec un check et passe en couleur “success”.
- Colonne centrale (texte) :
  - Titre : noir pur, poids moyen, taille standard.
  - Sous-titre : gris clair, petite taille, durée relative (ex. `+2j`, `+1sem`).
- Colonne droite (menu) :
  - Icône `more-vert` (3 points verticaux).
  - Interaction (V3.0) : `console.log('Open Modal')` uniquement.

### 2.b) Skeleton (Pass 2)

- Pendant `list_enrich_status === 'pending'` :
  - Remplacer titres + sous-titres par des skeletons à plat : formes grises arrondies, pulsantes (style Drive/YouTube).
  - Le skeleton remplace le contenu texte, sans déplacer la structure (cercle gauche + séparateurs inchangés).

### 2.c) Zoom IA (appui long) — Décomposition hiérarchique

#### Déclencheur UI (Power Gesture)

- Sur chaque ligne de jalon (milestone), ajouter `onLongPress`.
- Feedback : vibration légère lors de l’appui long.
- Action : afficher une modale de confirmation épurée (style Drive) :
  - Texte : “Voulez-vous que l’IA décompose cette étape en sous-tâches ?”
  - CTA : Annuler / Décomposer

#### Arborescence (accordéon)

- Objectif : permettre l’affichage de sous-jalons sous un jalon parent (V3.1).
- UI :
  - Indentation : +16px vers la droite pour chaque niveau enfant.
  - Connecteur : ligne fine en “L” entre parent et groupe d’enfants (vertical discret + retour horizontal).
  - Badge de zoom : si un jalon possède des enfants, afficher un badge `+N` à droite du titre.
  - Interaction badge : tap replie/déplie l’accordéon.

#### Pipeline contextuel (Quadruple verrou)

- Implémenter `triggerJalonZoom(jalonId)` qui prépare le contexte IA :
  - `original_intent` : texte brut de l’intention (stocké dans `memo`).
  - `project_title` : titre global du projet.
  - `parent_jalon_title` : titre du jalon à décomposer.
  - `parent_jalon_duration` : durée du jalon (valeur + unité).
  - `parent_jalon_expert_persona` : métier fantôme du jalon (obligatoire, fallback "Assistant Personnel").

#### Prompt Zoom (expert-first)

- Le prompt Zoom doit commencer par :
  - `Tu es un [expert_persona]. Ton objectif est de décomposer cette étape en sous-tâches chirurgicales et concrètes, en tenant compte du projet global : [TITRE PROJET] et de l'intention initiale : [MEMO].`

#### Architecture “Urbanisation Totale” (réutilisation des outils)

- Principe : détourner le Bulk et traiter le Zoom comme une capture “Bulk(1)” injectée dans une branche enfant.
- Contraintes :
  - Zéro nouveau validateur : réutiliser la Douane.
  - Zéro nouveau séquenceur : réutiliser `runGeminiBulkSequence`.

##### 1) Réutilisation de la Douane (validation)

- Sortie IA attendue : une liste d’intentions enfants de type `TASK` (titres actionnables, durée cohérente si fournie).
- Validation : la Douane Bulk valide la structure (titre non vide, types supportés, champs temporels cohérents).

##### 2) Réutilisation du Séquenceur (Bulk)

- Ajout d’un mode Zoom :
  - `runGeminiBulkSequence({ ..., isZoomMode: true, parent_id, parent_jalon_uid })`
  - Le texte injecté est un unique chunk construit par `triggerJalonZoom`.
- Règle : si `parent_id` est présent, la persistance route les résultats vers une branche “enfant” (relation hiérarchique) au lieu de créer uniquement des entrées racines.

##### 3) Réutilisation de Pass 2 (fractal)

- Même une sous-tâche peut être de type `LIST` / `PROJECT` :
  - L’**enrichissement Pass 2** (`list_enrich_generic` ou équivalent) ne s’applique **qu’après** le même **verrou** utilisateur que pour une intention racine : **`pass2_unlocked: true`** sur la fiche concernée + action explicite — **pas** d’enrichissement automatique dès la détection `LIST`/`PROJECT` sur un enfant.

##### 4) Normalizer & hiérarchie

- Étendre le Normalizer commun pour accepter un `parent_id` (et/ou `parent_jalon_uid`) et le transporter jusqu’à la persistance.
- Contrat : les sous-tâches générées par le zoom doivent être liées au jalon parent (jalonId/uid) de manière stable.
- Persistance SQL stricte :
  - Insertion immédiate en base à réception des intentions enfants.
  - Log : `[SQL_TRACE] ✅ Persistance sous-jalons (N) pour Parent ID: [ID]`.

#### Simulation de chargement

- Pendant la génération IA :
  - Afficher des skeletons indentés sous le jalon parent (même style Drive/YouTube).
  - Le parent reste visible ; les children apparaissent progressivement (si streaming) ou d’un bloc (si non-stream).

#### Badge & synchronisation SQL

- Le badge `+N` doit refléter le nombre réel de lignes enfants en base (`parent_id` + `zoom_parent_jalon_uid`), pas un compteur UI local.

### 2.d) V3.2 — Édition du titre projet (Direct Manipulation)

#### Composant UI (Editable Title)

- Dans la BottomSheet PROJECT, rendre le titre éditable inline :
  - Composant : `TextInput` stylisé (ou `EditableText`) qui ressemble à un `Text` normal.
  - Interaction : tap → focus + curseur ; pas d’icône crayon.
  - Feedback focus : bordure inférieure fine (1px) pendant l’édition.

#### Validation & persistance SQL

- Déclencheur : persister sur `onSubmitEditing` (Entrée) ou `onBlur`.
- Validation :
  - Interdire titre vide.
  - Si l’utilisateur efface tout puis valide/perd le focus, restaurer l’ancien titre (modif ignorée).
- Action SQL :
  - Appeler `trankilV2Db.updateIntention(id, { content: newTitle })` (colonne content/titre uniquement).
  - Ne pas toucher à `memo` / `gemini_universal_draft` / contenu IA (rappel critique : l’intention originale doit rester intacte pour les prochains zooms).

#### Refresh UI

- Après update SQL : la Timeline doit refléter immédiatement le nouveau titre (refresh event / invalidation) dès fermeture de la sheet.

#### i18n

- Placeholder (si champ vide temporairement) : `t('project.title_placeholder')`.

#### Polissage V3.2 — Flux “Double‑Mode” (Modale progressive + arrière‑plan) + i18n

##### 1) Modale Zoom IA (progressif)

- État initial (onLongPress) :
  - Titre : `t('project.zoom_confirm_title')`
  - Boutons : `t('common.cancel')` et `t('project.zoom_action_start')`
- État “génération en cours” (après clic sur Décomposer) :
  - Remplacer le texte par `t('project.zoom_generating_status')` + animation de points de suspension.
  - Ajouter un bouton : `t('project.zoom_background_action')` (ferme la modale, traitement continue).
- État “arrière‑plan” :
  - Si l’utilisateur a envoyé en arrière‑plan : fermer la modale.
  - Sur le jalon parent (liste) : afficher `t('project.status_processing')` à la place du sous‑titre.
  - Verrouillage : désactiver l’interaction (tap / long press / menu) sur ce jalon tant que la génération est en cours.
- État “fin de génération” (si la modale est restée ouverte) :
  - Texte : `t('project.zoom_success_count', { count: N })`
  - Bouton : `t('project.zoom_view_steps')` (ferme la modale + déploie l’accordéon automatiquement).

##### 2) Badge dynamique & focus unique

- Badge (dans la ligne jalon) : `t('project.step_count', { count: N })` (ex: “5 sous‑tâches”).
- Focus unique : ouvrir un accordéon replie automatiquement tout accordéon déjà ouvert dans la BottomSheet.

##### 3) Règle i18n (strict)

- Toutes les nouvelles chaînes UI doivent être définies dans les fichiers de traduction sous `project.*` (et `common.*` existant), aucune chaîne en dur dans l’UI.

#### V3.4 — Rendu “Things‑like” des sous‑jalons (BottomSheet)

##### 1) Logique de rendu (mode focus unique)

- Un seul jalon parent peut être déplié à la fois.
- Interaction : cliquer sur le badge ou le titre d’un jalon B replie automatiquement le jalon A.
- Source de données :
  - Les sous‑jalons affichés sont les lignes SQL dont `parent_id` correspond à l’ID du jalon sélectionné.

##### 2) Design encart (inspiré Things 3)

- Lorsqu’un jalon est déplié :
  - Afficher ses sous‑jalons dans un encart avec fond légèrement grisé (ex: `rgba(0,0,0,0.03)`).
  - Titre jalon parent : passer en gras (`fontWeight: '600'`).
  - Sous‑jalons :
    - Typo légèrement réduite (ex: 14px).
    - Indentation : 20px.
    - Connecteur : “L” inversé discret (trait fin gris) devant chaque sous‑jalon.

##### 3) État & interactions

- Checkboxes :
  - Chaque sous‑jalon a sa checkbox circulaire.
  - Cocher/décocher déclenche un update SQL immédiat (sans fermer la BottomSheet).
- Barre de progression :
  - Ajouter une micro‑barre (hauteur 2px) sous le titre du jalon parent déplié.
  - Valeur : `% sous‑jalons complétés`.
- Animation :
  - Ouverture / fermeture fluide via `LayoutAnimation` ou `Animated` (Expo / React Native).

##### 4) i18n (badge)

- Si N=0 : afficher `t('project.add_steps')` (ex: “+”).
- Si N>0 : afficher `t('project.step_count', { count: N })` (ex: “5 étapes”).

#### V3.4.1 — UX magique + SQL robuste + persistance d’état (Zoom IA)

##### 1) SQL robuste (abandon JSON LIKE)

- Ajouter une colonne dédiée dans `intentions` :
  - `zoom_parent_jalon_uid TEXT` (nullable).
- Indexer pour requêtes rapides :
  - `CREATE INDEX IF NOT EXISTS idx_intentions_parent_zoom_uid_created_at ON intentions (parent_id, zoom_parent_jalon_uid, created_at);`
  - (optionnel) `CREATE INDEX IF NOT EXISTS idx_intentions_parent_zoom_uid_status ON intentions (parent_id, zoom_parent_jalon_uid, status);`
- Migration :
  - `ALTER TABLE intentions ADD COLUMN zoom_parent_jalon_uid TEXT;` (si absent)
  - Backfill (best‑effort) : si `metadata_json` contient `"zoom_parent_jalon_uid":"<uid>"`, copier dans la colonne (puis le JSON peut rester tel quel, mais le filtering doit utiliser la colonne).
- Toutes les requêtes “zoom children” passent exclusivement par :
  - `WHERE parent_id = ? AND zoom_parent_jalon_uid = ?`

##### 2) UX magique (post‑décomposition)

- À la fin de la décomposition (bouton “Voir les étapes” ou auto‑succès) :
  - Fermer la modale.
  - Auto‑open l’accordéon du jalon parent (focus unique).
  - Auto‑scroll : caler le jalon parent en haut du viewport (ou au plus proche), pour que l’encart soit visible immédiatement.

##### 3) Persistance d’état (dernier jalon ouvert)

- Mémoriser le dernier jalon déplié :
  - Option A (recommandé) : `metadata_json.project.last_open_milestone_uid = <uid>` via `patchMetadata(..., { silent: true })`.
  - Option B : store local (si on ne veut pas polluer metadata).
- À la ré‑ouverture de la BottomSheet :
  - Si `last_open_milestone_uid` existe et a des children → rouvrir l’accordéon et charger les children depuis SQL.

##### 4) Skeleton UI (préchargement optimiste)

- Lors d’un open accordéon (tap badge/titre ou auto‑open post‑zoom) :
  - Ouvrir l’encart immédiatement avec skeletons (perception instantanée).
  - Remplacer par les children SQL dès la requête terminée.

### 3) Logique — Calcul & scalabilité

- Mode “Flottant” :
  - Si aucune `start_date` n’est fixée (et aucun pivot), les jalons affichent des durées relatives : `+2j`, `+1h`, etc.
- Mode “Calendrier” :
  - Dès qu’une date est fixée (début ou pivot), tous les jalons suivants affichent la date calendaire réelle.
- Effet domino :
  - Tout changement de date sur un jalon intermédiaire recalcule l’amont et l’aval pour maintenir une cohérence logique.
  - Le détail exact de la règle d’amont (recalcule rétroactif vs ancrage) est à préciser à l’implémentation, mais l’objectif est la cohérence globale.

### 4) Contrat technique — Persistance

- UID stables :
  - Chaque jalon possède un identifiant unique stable (plus de gestion par index).
  - Les mutations ciblent le jalon par `uid` (toggle terminé, note, pivot, suppression).
- Metadata :
  - Toute update passe par `patchMetadata(row.id, ..., { silent: true })` :
    - statut terminé/non terminé,
    - note,
    - date pivot,
    - suppression/édition de jalon,
    - start_date.
- Skeleton loading :
  - Pendant `is_generating: true` (Pass 2), remplacer le spinner par un skeleton (formes pulsantes) cohérent avec les pilules.

### Correction de visibilité (critique)

- Lors de l’insertion d’une intention (tout type), `category_id` ne doit **jamais** être `NULL`.
- Règle : `category_id = normalizeDomainCategoryId(draft.categoryTag)` pour éviter que l’item soit masqué par les filtres de contexte de la Timeline.
- `context_tag` : persisté depuis Pass 1 (`draft.contextTag` / intent `context`) pour filtrage ou affichage futur (lieu d’exécution : `BUREAU`, `VOITURE`, etc.).

### Refresh

- Une fois le Pass 2 terminé et persisté, déclencher un refresh UI (invalidate / event) pour que la Timeline ré-affiche la liste complète sans action utilisateur.

## Écran Projets & Listes (ProjectListScreen)

### Objectif

- Ajouter un écran dédié à la gestion approfondie des intentions `LIST` et `PROJECT`.
- Offrir une édition native via BottomSheet (édition inline, accordéon, autosave).

### Points à surveiller (implémentation Cursor)

- Structure & flux :
  - Uniformisation : `LIST` et `PROJECT` utilisent le schéma `list_scalable_v1` dans `metadata_json`.
  - Mutation sécurisée : chaque modification suit le cycle Lecture → modification partielle → réécriture complète du JSON (préserve les clés annexes).
  - Réactivité : toute écriture doit déclencher `notifyIntentionsChanged` (ou équivalent) pour rafraîchir la Timeline sans rechargement forcé.
- Ergonomie “Trankil” :
  - Accordéon intelligent : auto-focus (un item ouvert ferme le précédent) pour limiter la charge visuelle.
  - Zéro friction : persistance sur `onBlur` + `BottomSheetTextInput` (pas de CTA “Valider”).
  - État génération : `metadata_json.is_generating` doit désactiver l’édition + afficher un loader pour éviter les conflits IA/édition.
- Navigation & système :
  - Android BackHandler : le bouton retour ferme d’abord la BottomSheet avant de quitter l’écran.
  - Filtrage dynamique : la liste n’affiche que les items actifs (`is_archived = 0`).

### 1) Structure de l’écran (ProjectListScreen.tsx)

- Layout : `FlatList` de cartes étroites.
- Source données : requête SQLite filtrant `type IN ('LIST','PROJECT')` et `is_archived = 0`, tri par `created_at DESC`.
  - SQL :
    - `SELECT * FROM intentions WHERE type IN ('LIST', 'PROJECT') AND is_archived = 0 ORDER BY created_at DESC`
- Design cartes :
  - Titre projet/liste (ex. “Refaire la cuisine”, “Courses Hebdo”).
  - Indicateur de progression à droite (ex. `4/20`).
  - Style épuré : bordures fines, pas d’ombre excessive.

### 2) Navigation & BottomSheet intelligente

- Trigger : tap sur une carte → ouvrir une BottomSheet occupant ~95% de la hauteur.
- Implémentation : `@gorhom/bottom-sheet` (ou équivalent déjà présent).
- Contenu BottomSheet :
  - Header : titre modifiable inline (tap → TextInput, persistance sur `onBlur`).
  - Corps (accordéon) :
    - `LIST` : items de liste (cases cochées + détails).
    - `PROJECT` : jalons (milestones) (cases cochées + détails).
  - Comportement d’accordéon :
    - Par défaut : items rétractés (titre + checkbox).
    - Tap sur item : déployer détails (note/commentaire + échéance).
    - Auto‑focus : ouvrir un item ferme automatiquement le précédent.

### 3) Édition native & champs

- Checkbox : toggle done (UPDATE SQLite immédiat).
- Inline editing :
  - Tap sur texte → édition directe.
  - Persistance sur `onBlur` (pas de bouton “Enregistrer”).
- Champ Notes : TextInput multi‑ligne par item/jalon pour les détails.

### 4) Logique de données (SQLite)

- Requêtes :
  - Nouvelle fonction `getProjectsAndLists()` dans `trankilV2Db.ts` (ou équivalent).
- Persistance :
  - Ajouter/étendre des fonctions DB pour :
    - mettre à jour `intentions.title` (projet/liste),
    - mettre à jour les notes et le statut de complétion des items individuels (LIST/PROJECT).
  - Les items LIST doivent continuer à utiliser `metadata_json` (clé `list_scalable_v1`) comme source de vérité.
  - Pour `PROJECT`, utiliser le même schéma JSON que `list_scalable_v1` à l’intérieur de `metadata_json` (uniformisation), en ajoutant un champ optionnel `due_date` par item.
- Sync UI :
  - Utiliser le mécanisme existant (`notifyIntentionsChanged`) ou react-query/event emitter si présent pour répercuter instantanément les modifications.

### 5) Fonctionnalités spéciales — Scalabilité

- Si l’intention contient une liste scalable (items `scalable: true` dans `list_scalable_v1`) :
  - Afficher un contrôle `[-] / [+]` en haut de la BottomSheet (multiplier).
  - Le changement ajuste le multiplicateur et recalcul les quantités affichées, avec persistance immédiate.

### 6) Spécifications complémentaires (UX & Navigation)

- Android — BackHandler :
  - Si la BottomSheet est ouverte, le bouton retour physique doit fermer la BottomSheet en priorité (et ne pas quitter l’écran).
- Deep link / navigation :
  - Permettre l’ouverture directe d’un projet/liste via un paramètre de route (ex. `ProjectListScreen?id=123`).
- Inline editing :
  - Lors de l’édition d’un titre, afficher un bouton `X` (clear) à droite du TextInput.
  - Désactiver le scroll de la BottomSheet pendant que le clavier est ouvert (ex. `keyboardBlurBehavior="restore"`).
- Progression :
  - Calcul dynamique `doneCount/totalCount` via parse `metadata_json` (JS), en ignorant les items dont `name` est vide.
- Notes :
  - Le champ note/commentaire doit s’agrandir automatiquement avec le texte (`multiline` + auto-height).
- Archivage :
  - Ajouter un bouton “Archiver” discret dans le Header de la BottomSheet.
  - Action : passer `is_archived = 1` (SQLite) puis fermer la BottomSheet.
- Feedback persistance :
  - Après un `onBlur` réussi, afficher un indicateur discret “Saved” (micro-animation) en haut de la BottomSheet.

### 7) Précisions techniques (Mutation JSON, clavier, génération)

- Mutation JSON (LIST/PROJECT) :
  - Pour mettre à jour un item (note, checkbox, échéance), le code doit :
    - lire le `metadata_json` courant,
    - modifier uniquement l’item ciblé dans l’array (par `uid`),
    - réécrire le JSON complet via `UPDATE` en préservant toutes les autres clés (ex. `categoryTag`, `trip`, `gemini_universal_draft`, etc.).
  - Ne jamais écraser `metadata_json` avec un JSON partiel.
- Clavier & BottomSheet :
  - Utiliser `BottomSheetTextInput` (`@gorhom/bottom-sheet`) au lieu de `TextInput` standard pour garantir que la feuille s’ajuste et que le champ en édition reste visible.
- État “Génération en cours” :
  - Si `metadata_json.is_generating === true` :
    - afficher un `ActivityIndicator` (spinner) à la place de la liste d’items dans la BottomSheet,
    - afficher le message : `L'IA prépare votre projet...`,
    - désactiver l’édition tant que la génération n’est pas terminée.

## Pile technique

## MASTER SPECIFICATION — Projets & Coach Habitude

### 1) Architecture système & abonnement (Freemium)

- Boot-Sync (Local First, Offline-safe) :
  - Au démarrage : utiliser immédiatement la valeur SQLite (navigation instantanée, sans réseau).
  - En parallèle : tenter une mise à jour Firebase en arrière-plan (silent sync).
  - Si le statut change : mettre à jour SQLite puis propager à l’UI via event (hot update).
- Niveau Gratuit :
  - Accès à la Timeline et à l’écran “Projets & Listes” basique.
  - Les habitudes apparaissent comme des tâches simples dans la Timeline, sans coaching.
- Niveau Premium :
  - Débloque un onglet dédié “Coach Habitude” (i18n : `Habit Coach`).
- Hot-Update (achat in-app) :
  - Après achat validé, émettre un événement qui force la mise à jour SQLite + UI sans rechargement.
- Sécurité Firebase :
  - Remote Config : quotas (ex. `max_coaching_per_day`).
  - Cloud Functions : sécuriser les appels Gemini (pas de clé côté client).

### 2) Écran — Projets & Listes (ProjectListScreen.tsx)

- Gestion approfondie des intentions `LIST` et `PROJECT`.
- Structure :
  - `FlatList` de cartes étroites + indicateur progression dynamique `doneCount/totalCount`.
  - Filtrage : `is_archived = 0`.
- Interface :
  - Sheet Maison occupant 95% hauteur.
  - Accordéon intelligent : un item ouvert ferme le précédent (auto-focus).
- Édition native :
  - Persistance sur `onBlur` (titre et notes) via `BottomSheetTextInput` quand disponible ; sinon champ équivalent compatible Expo.
- Mutation JSON :
  - Principe : mise à jour via **patch (deep merge)**, jamais via remplacement brut.
  - Utiliser une fonction de type `updateMetadata(uid, partialData)` :
    - lire le `metadata_json` actuel en base,
    - fusionner profondément les clés (préserve les clés tierces : `categoryTag`, `trip`, `gemini_universal_draft`, etc.),
    - réécrire le JSON fusionné (UPDATE).
  - Objectif : éviter d’écraser des écritures concurrentes (ex. enrichissement IA en arrière-plan).

### 3) Écran — Coach Habitude (HabitCoachScreen.tsx)

- Service premium de coaching comportemental basé sur des signaux locaux et des prompts IA sécurisés.
 - Appels IA sécurisés : la Cloud Function doit recevoir un contexte structuré construit localement (ne pas “deviner” côté serveur).

#### A) HabitProfiler (local)

- Règles d’état (calcul local, sans API) :
  - `STREAK_LOW` : 1–7 jours (amorçage).
  - `STREAK_HIGH` : 21+ jours (ancrage).
  - `DANGER_ZONE` : 2 échecs consécutifs ou succès < 50% sur 7 jours.
  - `PLATEAU` : succès constant mais stagnation de l’engagement.

#### B) Les 10 piliers du coaching IA (Premium)

- Micro-Engagement : étape < 2 minutes.
- Variable Reward : loot box aléatoire (15%).
- Habit Stacking : greffer sur une routine existante.
- Identity Shift : félicitations centrées sur l’identité.
- Proof of Work (Vision) : défi photo + analyse Vision.
- Scripts Si-Alors : script de secours.
- Bounce Back : valorisation du retour après échec.
- Haptique Pavlovienne : vibration heavy rythmée à la validation.
- Time-Boxing : suggestion créneau basé sur stats.
- Social Mirroring : bilan hebdo au “nous”.

### 4) Logique données & UX système

- Table `habit_logs` :
  - Colonnes : `intention_id`, `date`, `status`, `proof_url`.
- Compression image :
  - Réduction locale (max 720p) avant envoi à Gemini Vision.
- Android BackHandler :
  - Priorité à la fermeture de la Sheet Maison sur le bouton retour physique.
- État “Génération” :
  - Spinner et édition bloquée si `metadata_json.is_generating === true`.
- Feedback persistance :
  - Micro-animation “Saved” après chaque persistance réussie.

- Payload Cloud Function (coaching) :
  - Envoyer un objet structuré, ex. :
    - `{ promptType: 'DANGER_ZONE', stats: { success_rate: 0.4, trend: 'decreasing', missed_days: 2 }, userIdentity: 'Apprenti' }`
  - Le serveur ne doit pas recalculer le profil : il exécute le prompt choisi et renvoie la réponse.

- Sécurité anti-boucle (cooldown coach) :
  - Stocker un `last_coaching_timestamp` dans `metadata_json` (ou table dédiée).
  - Interdire deux interventions proactives à moins de `X` heures d’intervalle, même si les conditions sont réunies.

- Robustesse “Deep Merge” (conflits d’écriture) :
  - Les mises à jour `metadata_json` doivent être sérialisées via une file d’attente (queue) côté client.
  - Toute fonction `updateMetadata(...)` doit :
    - s’enregistrer dans la queue,
    - relire l’état le plus récent au moment de l’exécution,
    - fusionner (deep merge) puis écrire,
    - garantir un ordre strict (évite d’écraser une écriture serveur arrivée entre lecture et write).

- IA Vision — fallback de bienveillance :
  - Si l’analyse Vision est incertaine, ne jamais bloquer la validation de l’habitude.
  - Réponse attendue : valider l’action et demander une précision de façon encourageante (motivation first).

- Reset habitude (timezone & midnight) :
  - Ajouter `metadata_json.day_offset` (par défaut `0`) pour définir une “fin de journée” personnalisée (ex. journée se termine à 02:00).
  - Le calcul des streaks doit utiliser `day_offset` pour éviter de casser un streak en cas de coucher tardif ou voyage.

- Robustesse day-offset (logique temporelle) :
  - Utiliser une librairie de calcul de dates robuste (ex. `date-fns` ou équivalent déjà présent) pour éviter les erreurs de bord (DST, fuseaux).
  - Règle métier : si `day_offset = 2` (fin de journée à 02:00), une validation à `01:30` le mardi est comptée dans la journée “métier” de lundi (J-1), afin de préserver le streak.

- Charge IA (throttling) :
  - Le recalcul `HabitProfiler` doit être debounced (ne pas recalculer à chaque ouverture/fermeture frénétique d’écran).
  - Règle métier : ne déclencher un appel Cloud Function (coaching) que si :
    - l’état local a changé (nouvelle validation/échec, nouvelles stats), ou
    - `last_coaching_timestamp` est plus vieux que `X` heures (cooldown dépassé).

- Intégrité file d’attente (journaling) :
  - Pour les écritures critiques (ex. validation habitude), utiliser un “journal” SQLite :
    - écrire l’action dans une table de logs avant la fusion dans `metadata_json`,
    - au redémarrage, rejouer les entrées non fusionnées pour éviter la perte en cas de crash.

- Guerre des timezones (streaks robustes) :
  - `habit_logs` doit stocker les timestamps en ISO 8601 **avec offset local** (ex. `2026-05-04T22:00:00+02:00`) plutôt qu’en UTC pur.
  - Objectif : recalculer les streaks selon “l’horloge biologique” au moment de l’action, indépendamment du fuseau actuel.

- Journaling vs performance :
  - Les écritures critiques doivent être atomiques via **une transaction SQLite unique** (journal + update minimal pour l’UI optimiste).
  - La fusion lourde / deep merge de `metadata_json` est déportée après animations (`InteractionManager.runAfterInteractions`) ou tâche de fond pour éviter des freezes sur Android low-end.

- Payload Gemini (mémoire courte) :
  - Ajouter `last_coach_message_summary` au payload Cloud Function afin d’éviter les répétitions et maintenir une continuité conversationnelle.
  - Limite : 140 caractères maximum ou un format compact (3 mots-clés / attributs de contexte).

- UI optimiste :
  - À la validation d’une habitude, l’UI doit refléter le succès immédiatement (optimistic update).
  - En cas d’erreur rare de persistance/sync : rollback visuel + notification courte “Oups”.

- UX “génération” (anti feuille blanche) :
  - Pendant `is_generating === true`, afficher des messages de chargement qui tournent (neuro-actifs), ex. :
    - “Analyse de ta plasticité cérébrale…”
    - “Calcul du prochain petit pas…”
    - “Préparation d’un plan anti-friction…”

- Sécurité types après merge :
  - Après chaque `readMetadata` / merge, valider la structure via un schéma (type guards ou validation runtime).
  - Ne jamais exécuter HabitProfiler / UI sur des données non validées (évite crash si array devient `null`).

### Blindage temporel (Habit Logs & Streaks)

- Principe : traiter le temps comme 2 entités distinctes :
  - **Instant précis** (technique) : timestamp complet.
  - **Journée métier** (humaine) : date `YYYY-MM-DD` dérivée via `day_offset`.

#### 1) Règle d’or du stockage (`habit_logs`)

- Interdit : stocker des dates en UTC pur (`Z`) pour les logs d’habitudes.
- Format imposé : ISO 8601 **avec offset local** `YYYY-MM-DDTHH:mm:ss±HH:mm`.
- Consigne : ne jamais utiliser `new Date().toISOString()` ; utiliser une fonction de formatage qui force l’offset local (ex. `format(new Date(), "yyyy-MM-dd'T'HH:mm:ssXXX")`).

#### 2) Business Date (Journée métier)

- Créer une utilitaire `getBusinessDate(dateTimeLocalIso, dayOffset)` :
  - Si `day_offset = 2`, toute validation entre `00:00:00` et `01:59:59` appartient à la date du jour précédent (`date - 1 jour`).
- Recommandation : calculer la `business_date` au moment de l’écriture et la stocker dans une colonne dédiée de `habit_logs` pour simplifier les requêtes SQL (streaks, stats).

#### 3) Algorithme de streak

- Ne jamais utiliser les heures pour la série : uniquement les `business_date`.
- Étapes :
  - récupérer la liste des `business_date` distinctes (par habitude), triées décroissant,
  - vérifier si la plus récente est “aujourd’hui” (selon `day_offset`),
  - parcourir la liste : si `differenceInCalendarDays(DateN, DateN-1) === 1`, le streak continue ; si `> 1`, streak brisé.
- Voyage : le changement d’offset ne doit pas casser le streak si l’utilisateur a validé une fois par “journée métier”.

#### 4) Manipulation dates (DST-safe)

- Utiliser exclusivement `date-fns` (ou équivalent) pour les comparaisons/calculs calendaires.
- Interdit : opérations manuelles sur timestamps (ex. `+ 86400000`).
- Commande : utiliser `differenceInCalendarDays` pour gérer correctement DST (heure d’été/hiver).

#### Payload temps (HabitProfiler)

- Le payload du `HabitProfiler` doit inclure :

```json
{
  "now_local": "2026-05-04T22:00:00+02:00",
  "day_offset": 2,
  "history": [
    { "business_date": "2026-05-04", "status": "done" },
    { "business_date": "2026-05-03", "status": "done" }
  ]
}
```

### Consigne d’implémentation (SOLO)

- Basculer l’accès au Coach Habitude sur la valeur SQLite persistée au boot.
- Utiliser `HabitProfiler` local pour sélectionner le prompt (parmi les 10 piliers) avant un appel Gemini via Cloud Functions.
- Standard UI : privilégier la Sheet Maison pour stabilité Expo SDK 54.

### Client (app Expo / React Native)
- Framework : Expo SDK (voir [app.json](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/app.json)) + React Native
- Navigation : React Navigation (stack + tabs)
- UI : React Native Paper + composants maison (neumorphism, modales)
- i18n : i18next + react-i18next, fichiers de traductions dans [src/locales](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/locales)
- Audio / voix :
  - capture audio (expo-av),
  - reconnaissance vocale (expo-speech-recognition),
  - transcription locale potentielle (whisper.rn) + services associés
- Stockage local : expo-sqlite (intentions locales, cache), AsyncStorage
- Réseau / état : @react-native-community/netinfo
- Places / géoloc :
  - Google Places côté client (autocomplete, détails)

Variables d’environnement principales (Expo public) :
- Firebase : `EXPO_PUBLIC_FIREBASE_*`
- Proxy Gemini : `EXPO_PUBLIC_GEMINI_PROXY_URL`
- Google Places : `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY`

### Backend (Firebase / Cloud)
- Auth : Firebase Auth (dont mode anonyme) côté client + vérification côté serveur
- Données : Firestore (sync/remote selon modules), plus mécanismes de synchronisation
- Fonctions : Firebase Functions Gen2 / Cloud Run (proxy sécurisé)
  - Code proxy : [functions/src/index.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/functions/src/index.ts)
  - Dépendances runtime : firebase-functions, firebase-admin (voir [functions/package.json](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/functions/package.json))
  - Secrets : la clé Gemini est un secret Functions (`defineSecret('GEMINI_API_KEY')`) et n’est jamais exposée au client : [index.ts:L8-L9](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/functions/src/index.ts#L8-L9).
  - Auth côté proxy : extraction `Bearer <token>` + `admin.auth().verifyIdToken(token)` ; sinon `401 unauthorized` : [index.ts:L18-L66](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/functions/src/index.ts#L18-L66).
  - SSE : le proxy force `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, puis envoie `delta/done/error` : [index.ts:L72-L108](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/functions/src/index.ts#L72-L108).
  - Usage metadata (tokens) : l’événement SSE `done` doit inclure les métriques de tokens renvoyées par Gemini **sous deux formes** :
    - `usageMetadata` : `{ promptTokenCount, candidatesTokenCount, totalTokenCount }` (format natif Gemini)
    - champs “app” attendus : `tokens_prompt`, `tokens_completion`, `tokens_total` (mêmes valeurs, prêtes à persister côté client)
    - Si ces champs sont absents, c’est un bug proxy (et non un “null acceptable”) et le monitoring coût/perf côté app reste vide.
  - Payload : le proxy accepte `{ modelId, systemInstruction, request }` ; si `request` est absent, il reconstruit une requête à partir de `prompt` : [index.ts:L10-L40](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/functions/src/index.ts#L10-L40).
  - Sanitisation : pas de validation/sanitisation applicative du `body` côté proxy au-delà du contrôle méthode + auth ; le proxy forwarde `request` tel quel vers Gemini.
  - Gestion d’erreur : en cas d’échec Gemini, l’événement SSE est `{ type:'error', code:'gemini_failed', error:'gemini_failed', details:<message Google> }` ; log serveur `[geminiProxyStream]`. Côté app, `readProxySse` lève `details` en priorité.
  - **Fallback modèles (app)** : `callGeminiProxyStream` enchaîne `[modelOverride, …getGeminiCandidateModelIds()]` quand un `modelOverride` est fourni (Pass 2, One-Tap, etc.) — repli automatique sur la shortlist compilée si le modèle principal échoue.

### IA (Gemini, via proxy)
- **Stratégie long terme** : instructions système + charge utile minimale + pré‑warming + Context Caching Vertex lorsque disponible — voir **« ARCHITECTURE IA (Latence) »** plus haut dans ce document.
- **Steering modèle** : Remote Config (`gemini_pass1_model_id`, `gemini_pass2_model_id`, `gemini_model_fallbacks`) + override Debug Pass 2 + blacklist session — voir § **0.b) Steering modèle Gemini (RC)**.
- Modèles : routés côté client (`getGeminiCandidateModelIds`) mais appelés uniquement via proxy ; défaut compilé `gemini-3.1-flash-lite`.
- Client n’embarque pas de clé Gemini : la clé (`GEMINI_API_KEY`) reste côté serveur (Secret Manager)
- Objectif : extraction structurée low‑latency en streaming (SSE)
- Headers client : l’app envoie `Authorization: Bearer <Firebase ID token>` et accepte SSE/JSON ([geminiSemanticLab.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts)).
- Refresh token : si `401/403`, l’app force un refresh du token puis retente une fois.
- **Verrou steering** : tout appel passe par `awaitGeminiSteeringBeforeNetworkCall()` (timeout 2 s).
- **Fallback modèles** : liste ordonnée (`getGeminiCandidateModelIds`) ; avec `modelOverride`, chaîne `[override, …shortlist]` ; sur 404/503 → `excludeGeminiModelForSession` puis candidat suivant ; succès fallback → session mémoire uniquement.
- Échec complet : si tous les candidats échouent, l’appel lève une erreur (propagée au `try/catch` UI qui déclenche le offline queue).
