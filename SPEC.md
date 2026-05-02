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
- Proxy Gemini & routage modèles : [MODELS_ROUTING_STRATEGY.md](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/docs/MODELS_ROUTING_STRATEGY.md)
- Contrat de stabilité OneTap : [STABILITY_SPEC_ONETAP_GEMINI.md](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/docs/STABILITY_SPEC_ONETAP_GEMINI.md)

## Architecture fonctionnelle (OneTap)

Le pipeline OneTap est “dual‑path” :
- Path A (local) : heuristiques synchrones (type, dates, signaux) pour un squelette immédiat.
- Path B (Gemini via proxy) : classification/structuration unitaire d’un chunk, puis fusion dans le squelette.

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

#### Verrou de persistance (Persistence Lock)

Ce verrou garantit que le séquenceur ne lance jamais le chunk N+1 tant que la persistance du chunk N n’est pas confirmée.

- Contrat de résolution : [persistOneTapDraftVentilated](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapPersist.ts) est une fonction async (Promise). Elle ne “libère” le séquenceur qu’après confirmation d’écriture dans le stockage persistant.
- Gestion du flux : le séquenceur UI attend strictement `await persistOneTapDraftVentilated(...)` avant de passer au chunk suivant.
- Sécurité : un `finally` doit garantir que les drapeaux de traitement (ex. `isProcessing` / index de progression) ne restent jamais bloqués en cas d’erreur mineure.
- Feedback de verrou : un log système doit signaler la confirmation de persistance (ex. `[DATABASE] ✅ Persistance confirmée pour <ID>`).

### 2.b) Standardisation base de données (Trankil-v2)

- Schéma : la source de vérité est la table SQLite `intentions` (Trankil‑v2). Les noms de colonnes sont stabilisés, notamment `due_date` (à utiliser partout côté Douane / insertions pour éviter tout conflit futur).
- Mode de persistance : l’écriture est locale (SQLite `trankil_v2.db`) et une réplication systématique est effectuée dans `via_production.db` (table `core_intentions`) après succès.

### 3) Feedback utilisateur (UI/UX)

L’interface doit refléter la progression du séquenceur (ex. “Création de 2/5…”).

- Succès : progression incrémentale + feedback au fur et à mesure des confirmations DB.
- Échec : message/log contextualisé sur le chunk concerné (sans stopper la boucle).

### 4) Nettoyage du code mort

Le flux OneTap doit éviter toute complexité liée au parsing de streaming multi-intentions côté IA.

- Les marqueurs de protocole IA (ex. `[[NEXT]]`, `[[COMPLETE]]`) et les stratégies de split “côté modèle” ne font plus partie du contrat.
- Le système revient à de la classification unitaire simple (1 chunk → 1 requête Gemini → 1 persistance).

### 5) Protocole de logging (harmonisé)

- Les logs bulk (séquenceur) utilisent un gabarit visuel aligné avec les captures unitaires (bannières + tags `[SEQUENCER]`, `[DATABASE]`, `[GeminiAPI]`, `[DOUANE]`), afin de garder une observabilité homogène entre OneTap simple et bulk.
- Les mentions de protocoles temporaires (purge auto, debug-only) ne font pas partie de l’état stable.

Composants principaux :
- Capture & parsing : [oneTapUniversalCapture.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapUniversalCapture.ts)
- Client réseau Gemini (streaming SSE) : [geminiSemanticLab.ts](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/geminiSemanticLab.ts)
- Persistance intentions : [oneTapPersist.ts](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/oneTapPersist.ts)
- Orchestration UI capture : [IntentionContext.tsx](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/context/IntentionContext.tsx)

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

### IA (Gemini, via proxy)
- Modèles : Gemini (flash/pro) routés côté client (fallback) mais appelés uniquement via proxy
- Client n’embarque pas de clé Gemini : la clé (`GEMINI_API_KEY`) reste côté serveur (Secret Manager)
- Objectif : extraction structurée low‑latency en streaming (SSE)
