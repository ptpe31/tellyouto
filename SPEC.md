# SPEC — Dev-trankil-v34 (TalknDone)

## Objectif produit

Dev-trankil-v34 est une application mobile orientée “one‑tap capture” : l’utilisateur dicte une pensée (tâche, déplacement, note, habitude, liste) et l’app la transforme immédiatement en intentions structurées, prêtes à être enregistrées.

Le flux OneTap vise :
- une capture très rapide (UI réactive en streaming),
- une extraction structurée déterministe (contrats de format),
- un fonctionnement multilingue (détection de langue + i18n),
- une continuité offline‑first (fallback quand le réseau/IA est indisponible).

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
- Probe “health check” multi‑modèles : l’écran Debug sonde une shortlist de modèles (ordre = candidats actuels) avec un prompt minimal `ok`, et retient le premier modèle répondant en HTTP 200. Voir [geminiModelHealthCheck.ts:L12-L53](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiModelHealthCheck.ts#L12-L53).
- Shortlist + fallback de candidats côté client : la liste de candidats provient de [geminiRemoteModelSteering.ts:L34-L52](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiRemoteModelSteering.ts#L34-L52) et [geminiRemoteModelSteering.ts:L239-L255](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiRemoteModelSteering.ts#L239-L255). Si la shortlist est vide, le fallback hardcodé retombe sur `gemini-1.5-flash`.
- Script de smoke test proxy : un script Node appelle le proxy avec `modelId: 'gemini-1.5-flash'` et consomme le flux SSE. Voir [testGeminiProxyStream.mjs:L1-L66](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/scripts/testGeminiProxyStream.mjs#L1-L66).
- Observabilité par requête : le client journalise pour chaque appel (et fallback éventuel) le modèle utilisé et la latence. Voir [geminiSemanticLab.ts:L33-L60](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts#L33-L60) et [geminiSemanticLab.ts:L228-L316](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/geminiSemanticLab.ts#L228-L316).

“Test hallucinations” (réel) : il n’existe pas de routine dédiée. La protection implémentée est structurelle : parsing strict / tolérance limitée + refus implicite via fallback (voir Douane) quand la sortie ne respecte pas le contrat de forme.

#### 1) Dual-Path (synchronisation des flux)

- Path A (heuristique locale) : extraction immédiate (signaux/regex + chrono-node) du type d’intention et de dates relatives simples afin de produire un placeholder UI (brouillon exploitable) sans réseau.
- Path B (Gemini unitaire) : envoi d’un chunk unique au proxy Gemini. Path B enrichit/rectifie les champs issus de Path A, sans casser les identifiants de suivi (l’ID d’intention généré côté app et les repères de progression restent stables).
- Autonomie réelle en cas de panne réseau/proxy : l’UI pose d’abord le squelette (Path A), puis tente Path B dans un `try/catch`. Si l’appel Gemini échoue, la capture est mise en file offline (texte ou audio) pour traitement ultérieur. Voir [IntentionContext.tsx:L420-L552](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/context/IntentionContext.tsx#L420-L552).
- Cycle de vie du titre (critique) :
  - Path A (heuristique locale) : génère un titre “bruit” (brut ou via heuristiques simples) uniquement pour l’affichage immédiat.
  - Path B (Gemini) : fournit le Smart Title définitif via son champ `CONTENT`.
  - Règle de conflit : dès que Path B répond, `CONTENT` devient la source de vérité absolue. Le client ne fait aucun nettoyage lexical/regex sur `CONTENT` (à part formatage de surface : trim/majuscule) ; si le titre est “sale”, on corrige le prompt, pas le code.

#### 2) Recette du prompt system (instructions immuables)

Le prompt OneTap réellement envoyé au modèle est construit dans [oneTapUniversalCapture.ts:L998-L1055](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapUniversalCapture.ts#L998-L1055) à partir :
- d’un `seed` (squelette Path A sérialisé en `P:...|K:...|T:...|...`) via [wireLineFromSkeleton](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L450-L493),
- d’une détection de langue heuristique locale (FR/EN) via [detectLangForOneTapPrompt](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L921-L934).

Instructions système critiques (texte exact, condensé) incluses dans le prompt :
- UNIVERSAL TEMPORAL ANCHOR (STRICT) :
  - `Today is: <WEEKDAY_EN>, <NOW_ISO> (Local Time: <TZ>)`
  - `Current Human Time: <WEEKDAY_EN> at <DUE_TIME_HM>`
  - `RULE: If user mentions "<WEEKDAY_EN>" (today) without "next", set DUE_DATE to TODAY (J+0).`
- DETECTED LANGUAGE DISCIPLINE (ABSOLUTE) :
  - “Identify the language (EN, FR, ES, IT, etc.)”
  - “Output strings ONLY in that language”
  - `CRITICAL: ZERO TRANSLATION. Keep the user's verbs and nouns.`
  - “The DISPLAY TITLE CONTRACT applies UNIVERSALLY to all languages”
- CATEGORY CONTRACT (ABSOLUTE) :
  - catégories autorisées exactement : `HOME, WORK, PERSO, HEALTH, FINANCE, TRAVEL, SOCIAL, SHOP, LEARN, OTHER`
  - interdiction de traduire/inventer ; fallback `PERSO` si doute.
- TRIP CONTRACT (ABSOLUTE) :
  - “Any mention of movement ... MUST be classified as TRIP”
  - dictionnaire de déclencheurs (FR/EN/extra) injecté tel quel.
- Reference time :
  - `Current Reference Time: [ISO: ... (tz)]` pour résoudre “demain”, etc.
- Format de sortie :
  - “Reply ONLY with Bullet-Pipe lines starting with ">".”
  - “No JSON. No markdown. No explanations.”
  - forme : `> TYPE | CONTENT | CATEGORY_CODE | DUE_DATE`.
  - Types sémantiques autorisés (vision 2026) :
    - `TASK` : action simple et unique.
    - `TRIP` : action impliquant un déplacement (logistique).
    - `LIST` : inventaire / liste de courses simple.
    - `PROJECT` : objectif complexe nécessitant plusieurs étapes (déclenche Pass 2).
    - `HABIT` : action récurrente / routine.
  - Règles de décision (côté Gemini) :
    - Utiliser impérativement `HABIT` si l’utilisateur mentionne une récurrence (chaque jour, hebdomadaire, etc.) ou une routine claire.
    - Utiliser `PROJECT` pour les objectifs larges nécessitant plusieurs étapes.

#### 3) Traitement de sortie (Douane & normalisation)

La “Douane” OneTap est distribuée sur deux étages réels :

1) Douane de parsing (côté capture, avant persistance) — [oneTapUniversalCapture.ts](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts)
- Parse de la sortie modèle :
  - Bullet‑Pipe : [parseBulletPipeIntentsFromBuffer](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L319-L380)
  - JSON fallback (si le modèle renvoie un objet) : [parseJsonIntentsFromBuffer](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L382-L439) avec parse best‑effort (`tryParseJsonObjectBestEffort` padding de `}`) : [oneTapUniversalCapture.ts:L572-L592](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L572-L592).
- Normalisation de catégorie : unknown → `PERSO` via [normalizeOneTapCategoryCode](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L120-L127).
- Fusion réelle Path B → Path A :
  - fusion d’une liste d’intents dans le squelette : [mergeIntentArrayIntoOneTapSkeleton](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L747-L850)
  - titre affichable (strict) : le titre final est `CONTENT` (nettoyé par l’IA via prompt) et ne subit pas de post-processing lexical/regex côté client (seulement trim/majuscule).
  - normalisation temporelle (dueDateTime ISO, recurrence null si vide, logisticsPotential) : [normalizeUniversalTemporalInData](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L165-L220).
  - Top-Down Sync (Gemini patron) : si Path B met à jour `dueDateTime` (ou `arrivalDue`), le client doit recalculer et écraser `dueDateYmd` + `dueTimeHm` à partir du timestamp ISO afin d’éviter toute divergence avec les heuristiques Path A (chrono-node).
- Si aucune intention n’est extraite : le brouillon final reste le squelette Path A (pas de NOTE_FALLBACK à ce stade), avec logs debug éventuels : [refineOneTapWithGeminiCompressed](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L1236-L1378).

2) Douane de persistance (côté DB) — [persistOneTapDraftVentilated](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapPersist.ts#L893-L1281)
- Entrée : `draft.data.intents` (si présent) ou les champs “mono‑intention” (`data.list`, signaux temporels, logistique…).
- Traitement : boucle `intents[]` + mapping type→draft (TASK/TRIP/HABIT/LIST/PROJECT) + persistance SQLite (et dual write) avec logs `[DOUANE]` si `DEBUG_MODE_DOUANE=true` (valeur actuelle : true) : [oneTapPersist.ts:L62-L65](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapPersist.ts#L62-L65) et [oneTapPersist.ts:L908-L1166](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapPersist.ts#L908-L1166).
- Enrichissement Pass 2 (LIST / PROJECT) :
  - Si `TYPE` est `LIST` ou `PROJECT`, lancer systématiquement `geminiEnrichGenericList` (Pass 2) même si aucun item n’est extrait au premier tour.
  - Pendant l’enrichissement : écrire `metadata_json.is_generating = true` et `metadata_json.list_enrich_status = 'pending'`.
  - Après succès : écrire `metadata_json.is_generating = false` et `metadata_json.list_enrich_status = 'done'` + payload `list_scalable_v1`.
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
- Fallback NOTE automatique (selon `allowNoteFallback`) : si Gemini ne parvient pas à produire d’intentions persistables, `persistOneTapDraftVentilated` peut créer une intention `NOTE_FALLBACK`. Ce fallback est activé par défaut, mais le séquenceur bulk le désactive explicitement (`allowNoteFallback: false`) et préfère alors un échec de chunk + mécanisme offline au niveau séquenceur. Voir [oneTapPersist.ts:L1167-L1186](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapPersist.ts#L1167-L1186) et [IntentionContext.tsx:L600-L607](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/context/IntentionContext.tsx#L600-L607).
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
- Stratégie anti-deadlock : sérialiser explicitement les écritures côté JS (queue) pour éliminer les race conditions (ex. `metadata_json`) et garantir l’atomicité des mutations multi-origines (UI, IA, jobs).

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

Composants principaux :
- Capture & parsing : [oneTapUniversalCapture.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapUniversalCapture.ts)
- Client réseau Gemini (streaming SSE) : [geminiSemanticLab.ts](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/geminiSemanticLab.ts)
- Persistance intentions : [oneTapPersist.ts](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapPersist.ts)
- Orchestration UI capture : [IntentionContext.tsx](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/context/IntentionContext.tsx)

## Architecture UI & Expérience Timeline

Cette section définit les contrats UI pour la refonte de la Timeline afin de passer d’un pilotage “fonctionnel/dense” à une interface Neumorphique épurée (référence “Image 1”), sans perte de logique, de données, ni de garanties UX.

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
- Densité & hauteur : la carte Phase 2 doit être plus fine (hauteur visuelle cible 105) ; l’espacement vertical entre cartes est géré par le flux (ex. `marginBottom` côté carte) et la respiration horizontale par le parent (ex. wrapper `paddingHorizontal: 16` dans `TimelineScreen`).
- Titre intelligent (universal) : la ligne 1 affiche `row.title` (source de vérité Gemini). `generateSmartTitle(row.content_raw)` reste un fallback local (offline/heuristique), jamais un nettoyage appliqué sur un titre Gemini.
- Sous-titre temporel (maquette) : la ligne 2 affiche le label au format `{JourLabel} • {Heure}` (point médian), sans répétition d’informations déjà présentes dans le titre.
  - JourLabel : “Aujourd’hui”, “Demain”, sinon nom du jour (ex. “Lundi”, “Jeudi”) calculé en local via `formatYmdLocal` + comparaison à J+0/J+1.
  - Heure : utiliser `dueTimeHm` (ex. “18:30”). Si l’heure est absente, afficher la chaîne i18n “toute la durée”.
  - Alignement types : ce format s’applique uniformément pour TASK et TRIP.
  - TRIP (source de vérité) : l’heure affichée est dérivée de `arrivalDue` (ISO) quand disponible ; sinon fallback sur `dueDateTime`/`dueTimeHm`.
  - Récurrence : si `recurrence` (objet OneTap) ou `recurrence_rrule` (SQLite) est non null/non vide, afficher une icône discrète “repeat” (flèches entrelacées) juste avant le bloc horaire, avec la même couleur grise que le sous-titre.
- Mirroring temporel (réalité actuelle) : `due_date` (SQLite) est un jour clé `YYYY-MM-DD`. L’heure affichée provient de `metadata_json` (`dueTimeHm` / `dueDateTime` / `trip.arrivalDue`) selon le type. L’affichage UI ne doit pas altérer le tri ni les valeurs persistées.

### 2) Découplage Pilotage / Contenu

- Header minimaliste : le header de la Timeline est fusionné avec la barre de navigation (suppression de la redondance “Timeline” vs “Ma Timeline”). Une seule ligne contient la pilule “Ma Timeline” à gauche et le bouton filtre à droite.
- TimelineFilterModal : tous les réglages de contexte (`HOME`, `WORK`, `PIGGY`, `ARCHIVES`, etc.), de temps (`timeNav`, incluant la date custom) et de statut (`statusFilter`) sont déportés dans une modale dédiée afin de libérer l’espace visuel.
- Source de vérité : les états de filtrage restent portés par le parent [TimelineScreen.tsx](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/screens/TimelineScreen.tsx) (ex. `timeNav`, `contextBubble`, `statusFilter`, `customPickedDate`) ; la modale ne fait que manipuler ces états via callbacks, sans logique de requête.
- Transfert de responsabilité : les indicateurs de pilotage technique (badge Pro, compteurs de quota, notifications, accès Tirelire/Cochon) sont exclus de la Timeline.
- Centralisation : la source de vérité de ces métadonnées techniques est officiellement déplacée vers la page `TalkDebugScreen`.
- Minimalisme garanti : toute réintroduction d’élément de statut technique dans la Timeline (header ou vue principale) est proscrite afin de préserver la charge cognitive.

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

### 3) TRIP — Newton & Alertes

- Newton switch : interrupteur “Activer Newton”.
  - État initial : `false`.
  - Calcul fenêtres de tir + alertes de départ : activé uniquement si l’utilisateur active Newton manuellement.
- Indicateur “à valider” en Timeline :
  - Affiché si l’intention est un TRIP (ou une intention complexe) et que les détails n’ont pas été validés.
  - Disparaît dès la première interaction/validation dans la Bottom Sheet (persistée).

### 4) TRIP — Transport & Carbone

- Sélecteur de mode : 4 icônes (Auto, Transit, Walking, Bike). Par défaut : `auto`.
- Persistance : le mode de transport doit être persisté en SQLite (champ dédié ou metadata), et un champ DB peut être nécessaire.
- Icône dynamique Timeline :
  - Pour un TRIP, l’icône affichée dans la Timeline doit refléter la colonne SQLite `transport_mode` (auto/transit/walking/bicycle).
  - Si `transport_mode` est vide, fallback sur l’icône avion.
  - La mise à jour doit être instantanée dès qu’un mode est sélectionné dans la Bottom Sheet (optimistic UI + persistance).
- UI épurée :
  - Le sélecteur est très espacé et sans libellés (“Trajet/Transport” supprimés).
  - Newton : ligne dédiée “Activer Newton” + Switch sous le sélecteur.
  - Stabilité : aucun layout shift lors du changement de mode (slot CO2/Eco‑Friendly à hauteur fixe).
- Bloc adresses (juste au‑dessus du bouton “Lancer l’itinéraire”) :
  - **Point de départ** :
    - Valeur par défaut : “Ma position” / “Position actuelle”.
    - Interaction : tap → champ éditable avec autocomplétion (Google Places) pour définir un autre départ.
    - Stockage : dans `metadata_json.trip.origin_address` (et champs associés place_id/lat/lng si disponibles).
  - **Point d’arrivée** :
    - Affichage : si une adresse exacte est connue (favori/validation), afficher l’adresse complète en couleur secondaire ; sinon afficher le nom de lieu extrait par l’IA (ex. `destination_name`) comme indicateur.
    - Interaction : tap → autocomplétion (Google Places) pour valider/affiner l’adresse.
    - Stockage : l’adresse d’arrivée validée est la source de vérité pour Newton.
- Recherche contextuelle (Saved information) :
  - À l’affichage, si `destination_name` correspond à un alias enregistré (ex. “Mami”), la vue doit résoudre l’adresse sauvegardée et l’utiliser comme arrivée par défaut.
  - Source : table locale de favoris (ex. `location_favorites`) ou autre stockage équivalent.
- Indicateur carbone :
  - Walking/Bike : badge “Eco‑Friendly”.
  - Auto : texte d’impact estimé (ex. “Impact CO2 standard”).
- Action : bouton “Lancer l’itinéraire” ouvrant un deep link vers Google Maps/Waze avec :
  - `origin` si le départ a été précisé,
  - `destination` = adresse d’arrivée exacte,
  - `travelmode` selon le mode sélectionné (auto/transit/walking/bike).
- Deep link universel (sélecteur natif) :
  - Android : utiliser un schéma `geo:0,0?q=` pour déclencher le sélecteur natif si plusieurs apps GPS sont installées.
  - iOS : ouvrir via schémas natifs (Apple Maps / Google Maps / Waze) et afficher un sélecteur natif (ActionSheet) si plusieurs fournisseurs sont disponibles.
  - Les schémas externes (ex. `waze://`, `comgooglemaps://`) nécessitent l’autorisation iOS `LSApplicationQueriesSchemes` dans la config Expo.

#### Règle de visibilité “zéro flags” (robustesse UI)

- Principe : la validation d’une adresse ne repose pas sur un booléen UI mais sur la présence de coordonnées persistées.
- Arrivée (source de vérité) :
  - Lors d’une saisie manuelle dans le champ Arrivée (`onChangeText`) : vider immédiatement `metadata_json.trip.location_lat` / `location_lng` (et champs associés) pour marquer l’arrivée comme non exploitable.
  - Lors de la sélection d’une suggestion Google Places (`onSelect`) : renseigner immédiatement `metadata_json.trip.location_lat` / `location_lng` (+ `location_place_id`, `location_address`) pour marquer l’arrivée exploitable.
  - Condition d’affichage “Confort de trajet” (Transport + Newton) : afficher uniquement si `metadata_json.trip.location_lat` est présent et non nul (indépendant du Départ).
- Départ (impact uniquement sur le bouton GPS) :
  - Lors d’une saisie manuelle dans le champ Départ : vider `metadata_json.trip.origin_lat` / `origin_lng`.
  - Lors de la sélection Places : renseigner `origin_lat` / `origin_lng` (+ `origin_place_id`, `origin_address`).
  - Condition d’affichage du bouton GPS (GO) : afficher/activer uniquement si Départ ET Arrivée ont des coordonnées.

### 5) Synchronisation (Top‑Down Sync)

- Temps réel : toute modification (heure, mode de transport, switch Newton, checkbox, adresses départ/arrivée) déclenche un UPDATE SQL immédiat via le repository.
- Persistance Newton : toute adresse d’arrivée saisie/validée doit être sauvegardée immédiatement dans la colonne SQLite `intentions.location_address` (en plus du JSON), afin d’être exploitable par le calcul trafic.
- Refresh : la Timeline se rafraîchit automatiquement en arrière‑plan (icône triangle, heure, sous‑titre, etc.).
- Gestion clavier :
  - Utiliser `KeyboardAvoidingView` (ou équivalent) et un footer fixe (bouton itinéraire) pour que les champs Places restent accessibles au‑dessus du clavier.

## OneTap LIST — Pipeline 2-Pass (Classification + Enrichissement)

### Objectif

- Transformer les intentions de type `LIST` en listes actionnables (courses, projets, révisions) via un pipeline en **2 passes**.

### Pass 1 — Classification (inchangé)

- Format de réponse Gemini : **Bullet‑Pipe** uniquement (lignes `> TYPE | CONTENT | CATEGORY_CODE | DUE_DATE`).
- Rôle : détecter `TYPE === LIST` et extraire un `CONTENT` propre (DISPLAY TITLE CONTRACT) + catégorie.

### Pass 2 — Enrichissement (LIST uniquement)

- Déclenchement : si Pass 1 détecte `TYPE === LIST`, lancer immédiatement `enrichGenericList(content)`.
- UI feedback : la LIST est insérée en base dès Pass 1 avec un état temporaire visible (ex. titre/ligne “Génération en cours…” ou flag dans `metadata_json`) afin que l’utilisateur voie l’item pendant l’enrichissement.
- Sortie attendue : un **JSON strict** conforme au schéma `list_scalable_v1` (voir `LIST_METADATA_KEY = list_scalable_v1`).
- Fusion : injecter le JSON enrichi dans `metadata_json.list` (ou la clé dédiée `list_scalable_v1` selon le modèle effectif) et persister en SQLite.

### Prompt Système Gemini (Pass 2)

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
```

### Correction de visibilité (critique)

- Lors de l’insertion d’une intention `LIST`, `category_id` ne doit **jamais** être `NULL`.
- Règle : `category_id = normalizeDomainCategoryId(draft.categoryTag)` (ex. `SHOP` doit tomber dans le contexte Maison si c’est la convention de mapping) pour éviter que l’item soit masqué par les filtres de contexte de la Timeline.

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
  - Sanitisation : pas de validation/sanitisation applicative du `body` côté proxy au-delà du contrôle méthode + auth ; le proxy forwarde `request` tel quel vers Gemini (et renvoie un `gemini_failed` générique en cas d’erreur).
  - Gestion d’erreur : en cas d’échec Gemini, l’événement SSE renvoyé est `{type:'error', error:'gemini_failed'}` (pas d’exception détaillée) : [index.ts:L105-L108](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/functions/src/index.ts#L105-L108).

### IA (Gemini, via proxy)
- Modèles : Gemini (flash/pro) routés côté client (fallback) mais appelés uniquement via proxy
- Client n’embarque pas de clé Gemini : la clé (`GEMINI_API_KEY`) reste côté serveur (Secret Manager)
- Objectif : extraction structurée low‑latency en streaming (SSE)
- Headers client : l’app envoie `Authorization: Bearer <Firebase ID token>` et accepte SSE/JSON : [geminiSemanticLab.ts:L248-L269](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts#L248-L269).
- Refresh token : si `401/403`, l’app force un refresh du token puis retente une fois : [geminiSemanticLab.ts:L258-L270](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts#L258-L270).
- Fallback modèles : une requête est tentée sur une liste ordonnée de candidats (`getGeminiCandidateModelIds()`), en avançant sur les erreurs HTTP non‑OK : [geminiSemanticLab.ts:L235-L282](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts#L235-L282).
- Échec complet : si tous les candidats échouent, l’appel lève une erreur (propagée au `try/catch` UI qui déclenche le offline queue) : [geminiSemanticLab.ts:L302-L316](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts#L302-L316).
