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

#### 2) Recette du prompt system (instructions immuables)

Le prompt OneTap réellement envoyé au modèle est construit dans [oneTapUniversalCapture.ts:L998-L1055](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapUniversalCapture.ts#L998-L1055) à partir :
- d’un `seed` (squelette Path A sérialisé en `P:...|K:...|T:...|...`) via [wireLineFromSkeleton](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L450-L493),
- d’une détection de langue heuristique locale (FR/EN) via [detectLangForOneTapPrompt](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L921-L934).

Instructions système critiques (texte exact, condensé) incluses dans le prompt :
- LANGUAGE CONTRACT (ABSOLUTE) :
  - `Your output must be in the same language as lang=...`
  - `CRITICAL: ZERO TRANSLATION. Do not translate the user's wording.`
  - `If lang=en ... Never output French words.`
  - `If lang=fr ... Never output English words.`
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

#### 3) Traitement de sortie (Douane & normalisation)

La “Douane” OneTap est distribuée sur deux étages réels :

1) Douane de parsing (côté capture, avant persistance) — [oneTapUniversalCapture.ts](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts)
- Parse de la sortie modèle :
  - Bullet‑Pipe : [parseBulletPipeIntentsFromBuffer](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L319-L380)
  - JSON fallback (si le modèle renvoie un objet) : [parseJsonIntentsFromBuffer](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L382-L439) avec parse best‑effort (`tryParseJsonObjectBestEffort` padding de `}`) : [oneTapUniversalCapture.ts:L572-L592](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L572-L592).
- Normalisation de catégorie : unknown → `PERSO` via [normalizeOneTapCategoryCode](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L120-L127).
- Fusion réelle Path B → Path A :
  - fusion d’une liste d’intents dans le squelette : [mergeIntentArrayIntoOneTapSkeleton](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L747-L850)
  - normalisation temporelle (dueDateTime ISO, recurrence null si vide, logisticsPotential) : [normalizeUniversalTemporalInData](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L165-L220).
- Si aucune intention n’est extraite : le brouillon final reste le squelette Path A (pas de NOTE_FALLBACK à ce stade), avec logs debug éventuels : [refineOneTapWithGeminiCompressed](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapUniversalCapture.ts#L1236-L1378).

2) Douane de persistance (côté DB) — [persistOneTapDraftVentilated](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapPersist.ts#L893-L1281)
- Entrée : `draft.data.intents` (si présent) ou les champs “mono‑intention” (`data.list`, signaux temporels, logistique…).
- Traitement : boucle `intents[]` + mapping type→draft (TASK/TRIP/HABIT/LIST/NOTE) + persistance SQLite (et dual write) avec logs `[DOUANE]` si `DEBUG_MODE_DOUANE=true` (valeur actuelle : true) : [oneTapPersist.ts:L62-L65](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapPersist.ts#L62-L65) et [oneTapPersist.ts:L908-L1166](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapPersist.ts#L908-L1166).
- Gestion du vide / malformé (NOTE_FALLBACK) :
  - Si `intents[]` existe mais qu’aucune entité n’a pu être persistée : si `allowNoteFallback !== false`, création d’un draft NOTE avec `memo = transcript` et persistance sous label `NOTE_FALLBACK` : [oneTapPersist.ts:L1167-L1186](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapPersist.ts#L1167-L1186).
  - Si aucun résultat n’a été persisté après les branches list/temporal/trip : même fallback NOTE_FALLBACK : [oneTapPersist.ts:L1261-L1277](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapPersist.ts#L1261-L1277).

#### 4) Format de persistance final

- Les champs persistés doivent impérativement être alignés sur le schéma SQLite Trankil‑v2 (ex. `due_date`).
- `due_date` est stocké en ISO 8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`).

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
- Multi-intentions par chunk : si Path B renvoie un tableau d’intentions pour un seul chunk, le verrou de persistance attend la sauvegarde de l’ensemble du tableau (toutes les écritures SQLite + réplication) avant de libérer le séquenceur.
- Gestion du flux : le séquenceur UI attend strictement `await persistOneTapDraftVentilated(...)` avant de passer au chunk suivant.
- Sécurité : un `finally` doit garantir que les drapeaux de traitement (ex. `isProcessing` / index de progression) ne restent jamais bloqués en cas d’erreur mineure.
- Feedback de verrou : un log système doit signaler la confirmation de persistance (ex. `[DATABASE] ✅ Persistance confirmée pour <ID>`).
- Gestion des erreurs (persistance) : pas de timeouts applicatifs codés en dur dans la persistance (pas de `setTimeout(12s)` masquant une panne). La persistance remonte l’erreur réelle (SQLite, contraintes, etc.) et le séquenceur applique le mécanisme de survie.

### 2.b) Standardisation base de données (Trankil-v2)

- Schéma : la source de vérité est la table SQLite `intentions` (Trankil‑v2). Les noms de colonnes sont stabilisés, notamment `due_date` (à utiliser partout côté Douane / insertions pour éviter tout conflit futur).
- Format : le format de `due_date` en base est strictement ISO 8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`) pour assurer la compatibilité avec le moteur de tri de la Timeline.
- Initialisation atomique : interdire l’exécution du schéma SQL en un seul bloc géant via `execAsync`. L’initialisation doit exécuter les opérations séquentiellement (table par table, index par index) afin de limiter les timeouts au premier démarrage.
- Auto-réparation (healthcheck) : exécuter un test d’écriture/lecture `System Ready` immédiatement après l’ouverture/initialisation. Si ce test échoue (timeout natif, `NativeDatabase.prepareAsync` rejeté / NPE), lever une exception bloquante plutôt que de laisser le séquenceur tourner à vide.
- Mode de persistance : l’écriture est locale (SQLite `trankil_v2.db`) et une réplication systématique est effectuée dans `via_production.db` (table `core_intentions`) après succès.
- Sécurité production : aucune suppression du fichier DB (ex. `deleteDatabaseAsync`) n’est exécutée au démarrage. Toute purge de données éventuelle doit rester une action explicite (debug/outils), jamais un comportement automatique.
- Migrations vs purge : le bootstrap DB peut exécuter des `DROP TABLE ...` uniquement dans des chemins de migration/normalisation de schéma (ex. contraintes `ARCHIVED`, ajout du type `LIST`) et non comme “purge périodique”. Voir [trankilV2Db.ts:L774-L843](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/api/trankilV2Db.ts#L774-L843) et [trankilV2Db.ts:L936-L1005](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/api/trankilV2Db.ts#L936-L1005).
- Hard Reset manuel (debug) : un “factory reset” existe et efface SQLite + préférences + notifications sur action utilisateur confirmée (double confirmation). Implémentation : [factoryReset.ts:L7-L18](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/factoryReset.ts#L7-L18). Déclenchement UI : [DebugScreen.tsx:L153-L173](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/screens/DebugScreen.tsx#L153-L173) puis exécution [DebugScreen.tsx:L133-L151](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/screens/DebugScreen.tsx#L133-L151).
- Instance singleton & re-open : l’instance SQLite est maintenue en singleton côté JS. En cas de `NativeDatabase.prepareAsync` rejeté (ou NPE natif), le système invalide l’instance courante et force une réouverture propre de la connexion avant de retenter l’opération.
- Stabilité Android (New Architecture) : le bootstrap SQLite ne doit jamais bloquer l’UI. En cas de stall SQLite au démarrage, l’app continue à afficher l’interface, et l’initialisation DB reste best-effort en arrière-plan.
- Stratégie anti-deadlock : aucune file d’attente JS de sérialisation SQLite (pas de verrou sur un verrou). La sérialisation est laissée à la couche native expo-sqlite ; les accès DB côté JS restent directs.

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
- Contrat Phase 2 (IntentionCard) : l’action et l’identité sont fusionnées. Un unique cercle neumorphique à gauche (taille tactile stable) contient l’icône de catégorie et sert de seul bouton d’action.
- État pending (Undo 3s) : quand `pendingLocalDone` est actif, l’icône de catégorie dans le cercle est remplacée par une coche de validation.
- Mirroring temporel : l’affichage de date doit être relatif (ex. “Aujourd’hui”, “Demain”) suivi de l’heure précise, dérivée du champ `due_date` (stocké en ISO 8601 côté SQLite Trankil‑v2). L’affichage UI ne doit pas altérer le tri ni la valeur persistée.

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

## Pile technique

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
  - SSE : le proxy force `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, puis envoie `delta/done/error` : [index.ts:L72-L108](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/functions/src/index.ts#L72-L108).
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
