# Architecture — Intention & Remote Steering

Ce document décrit le flux **Dual-Path** (one-tap), le pilotage du **modèle Gemini** (Remote Config, sentinelle Cloud, self-healing), et la **lecture des métriques** sur l’écran Debug. Le détail d’implémentation est aussi documenté en JSDoc dans les modules concernés.

## Dual-Path : squelette local vs affinage Gemini

### Objectif

Après une dictée **Quick**, l’utilisateur doit voir une intention exploitable **sans attendre le réseau** (Path A), puis bénéficier d’un **affinage** par le modèle quand la réponse arrive (Path B).

### Path A — squelette local

- **Fichier** : `src/services/oneTapUniversalCapture.ts` — fonction `inferOneTapSkeletonFromTranscript`.
- **Comportement** : heuristiques sur le texte (type LIST, TASK, etc.), titre, **chrono-node** pour dates/heures, données par défaut par type. **Aucun appel HTTP**.
- **Côté UI** : dans `TalkDebugScreen`, le squelette est appliqué puis la modale s’ouvre tout de suite après la fin de capture.

### Path B — affinage Gemini

- **Fichier** : `src/services/oneTapUniversalCapture.ts` — `refineOneTapWithGeminiCompressed`.
- **Comportement** : le squelette est sérialisé en une **ligne compacte** `KEY:value|…` (`wireLineFromSkeleton`), injectée dans un prompt court avec la dictée. Le modèle renvoie la même « grammaire » ; l’UI peut être mise à jour en **streaming** (`onPartial` + `parsePartialWireLine`).
- **Choix du modèle** : les appels passent par `geminiSemanticLab` → URL `generateContent` / `streamGenerateContent` avec l’ID résolu par `getActiveGeminiModelId()` (voir section suivante).

### Chaînage Talk (référence)

1. **T0** — fin de capture (`[OneTapPerf] T0_CAPTURE_END`).
2. Squelette local + ouverture modale.
3. **T1** — début du traitement async (`T1_DUAL_PATH_BACKGROUND`) : pre-save optimiste, puis stream Gemini.
4. **T3** — fin (`T3_REFINE_DONE`) : remplacement draft, émission de l’événement debug avec `oneTapPerfMs`.

Il n’y a **pas de repère T2** dans le payload : le coût réseau du modèle est isolé dans **`geminiMs`**.

### Traçabilité terminal (Metro / CLI)

Pas d’agrégateur UI dédié : la chaîne se lit dans **les logs Metro**.

| Préfixe | Où | Contenu |
|--------|-----|---------|
| **`[GeminiAPI]`** | `geminiSemanticLab` — `postGenerateContent` / `postStreamGenerateContent` | Chaque fin de requête : `🚀 CALL_SUCCESS` ou `❌ CALL_ERROR` (modèle, latence ms, `FallbackUsed` YES/NO, `Version: v1beta`, `Operation: …`). |
| **`[OneTapPerf] 🏁 END_TO_END_CHAIN`** | `oneTapUniversalCapture` — fin de `refineOneTapWithGeminiCompressed` | Uniquement si `chainPerf: { t0, t1 }` est passé (ex. Talk) : T0→T1, durée **affinage Gemini** (Path B pur), `TOTAL_LATENCY`, `RESULT_CAT` (tag catégorie). |
| **`[GeminiSteering] 🛠️ SELF_HEALING_TRIGGERED`** | `geminiRemoteModelSteering` — `tryRecoverFromListModels` | Après `listModels` : nombre de modèles trouvés, `New Local Choice` (id retenu). |

## Cloud Function « Sentinelle » et Remote Config

### Remote Config

- **Clé** : `active_gemini_model` (constante `REMOTE_CONFIG_KEY_ACTIVE_GEMINI_MODEL` dans `src/services/geminiRemoteModelSteering.ts`).
- **Rôle** : valeur centralisée du **modèle Gemini** utilisé par l’app pour les appels REST (Flash, etc.), lue après `fetchAndActivate`.

### Sentinelle (`geminiModelSentinel`)

- **Fichiers** : `functions/src/geminiModelSentinel.ts`, planification dans `functions/src/index.ts`.
- **Rôle** : job planifié (quotidien, Europe/Paris) qui appelle l’API **`listModels`**, choisit un id préféré (priorité modèles flash stables), puis **publie** la valeur dans le template Remote Config pour la clé `active_gemini_model`.
- **But** : éviter qu’une app en production reste bloquée sur un **nom de modèle déprécié** lorsque Google renomme ou retire des endpoints.
- **Logs** : après publication du template, la function écrit une ligne JSON structurée (`ANCIEN_MODELE`, `NOUVEAU_MODELE`, `transition`, `did_change`) pour filtrer dans Cloud Logging si la sentinelle a réellement modifié la valeur par défaut RC.

### Self-healing côté client

Documenté en détail dans le JSDoc de `geminiRemoteModelSteering.ts` :

1. **Au démarrage / après refresh RC réussi** : la valeur **Remote Config** est toujours appliquée au cache ; le fichier AsyncStorage de secours est **vidé** (plus d’override silencieux au boot).
2. Sur erreur **404 / 503** (ou équivalent) sur `generateContent`, **listModels** + shortlist + mise à jour du cache **mémoire** + persistance disque (traçabilité / TTL) jusqu’au prochain refresh RC.
3. Si Firebase / RC lève une exception : défaut **`GEMINI_SAFE_DEFAULT_MODEL_ID`** + tentative `listModels` avec la clé API (sans relire AsyncStorage comme source de vérité).

## Logs de performance — page Debug

### Source des données

- **Événement** : `TALK_CAPTURE_DEBUG_EVENT` (`src/constants/talkCaptureDebug.ts`).
- **Payload** : `TalkCaptureDebugPayload`, avec `oneTapPerfMs` pour le mode Quick one-tap.

### Champs affichés (i18n `debug.oneTapPerf*`)

| Champ | Sens |
|--------|------|
| **t0** | Instantané `performance.now` à la fin de capture (T0). |
| **t1** | Instantané au début du lot async (pre-save + Gemini). |
| **t3** | Instantané à la fin du lot async. |
| **geminiMs** | Durée approximative de la phase **streaming Gemini** seule. |
| **totalFromT1Ms** | `t3 - t1` : tout le travail arrière-plan après l’ouverture de la modale. |

Les logs console `[OneTapPerf]` dans `TalkDebugScreen` reprennent les mêmes repères pour corrélation sans ouvrir l’app Debug.

## Maintenance — changer de modèle manuellement

1. **Console Firebase — Remote Config**  
   Publier ou modifier la valeur du paramètre **`active_gemini_model`** (ex. `gemini-2.0-flash-latest`). Déployer le template. Sur l’app, utiliser l’action **rafraîchir** le modèle RC (écran Debug) pour forcer `fetchAndActivate` via `forceRefreshGeminiRemoteConfig`.

2. **App — écran Debug**  
   - **Rafraîchir Remote Config** : recharge la valeur RC et met à jour l’affichage « modèle effectif » / « dernier RC résolu ».  
   - **Vérification santé IA** (`runGeminiModelHealthCheck`) : probes sur une shortlist ; le gagnant est appliqué avec `applyGeminiLocalModelOverride` (cache + disque pour la session). Un **rafraîchissement RC** réussi réaligne l’app sur la valeur RC et vide ce secours.

3. **Clé API**  
   La clé utilisée pour les appels directs est celle prévue par la config app (souvent `EXPO_PUBLIC_GEMINI_API_KEY` — voir `env.example`). La sentinelle côté Cloud utilise un **secret** dédié (`GEMINI_API_KEY` dans les functions), distinct du client.

4. **Dépannage rapide**  
   Si un modèle renvoie **404** : le client tente le self-heal ; en dernier recours, corriger **`active_gemini_model`** dans Remote Config ou lancer un check santé depuis Debug.

---

Pour le détail des paramètres T0/T1/T3 et du Dual-Path, voir le bloc JSDoc en tête de `src/services/oneTapUniversalCapture.ts` et le type `OneTapPerfMsSnapshot` dans `src/constants/talkCaptureDebug.ts`.
