# AI_ARCHITECT_MAP — mémoire projet (binôme IA)

Document **interne** : reprendre le contexte produit / technique sans relire tout le dépôt. Chemins relatifs depuis la racine `Dev-trankil-v3/`.

---

## 1. Vision & core philosophy

- **Dev-trankil-v3** : pipeline **dictée → intention structurée → action** (one-tap, Talk Quick, etc.). L’utilisateur parle ; l’app propose tout de suite un brouillon exploitable (tâche, liste, note, habitude, anniversaire, …).
- **Règle d’or** : **l’UX prime** — latence perçue minimale, **Path A synchrone** avant tout réseau ; le cloud affine, il ne bloque pas l’ouverture de l’UI.
- **i18n** (`.cursorrules`) : aucune chaîne utilisateur en dur dans les TSX — `i18n.t('key')` + clés FR/EN maintenues.

---

## 2. Dual-Path (`src/services/oneTapUniversalCapture.ts`)

| Chemin | Rôle | Détail |
|--------|------|--------|
| **Path A (local)** | Squelette **immédiat** | `inferOneTapSkeletonFromTranscript` : regex + `chrono-node` + données par défaut par type. **0 appel HTTP**. Utilisé pour ouvrir la modale Talk sans attendre Gemini. |
| **Path B (Gemini)** | Affinage **async** | `refineOneTapWithGeminiCompressed` : ligne compacte `KEY:value|…` (seed depuis Path A), prompt court, `geminiStreamOneTapCompressedLine` / non-stream ; `onPartial` + `parsePartialWireLine` pour UI optimiste. |

Orchestration Talk : `src/screens/TalkDebugScreen.tsx` (`stopCapture`) — enchaîne squelette → modale → lot async (pre-save + stream + replace draft).

---

## 3. Pilotage modèle (« The Brain »)

### Sentinelle + Remote Config

- **Cloud Function** : `functions/src/geminiModelSentinel.ts` + cron `functions/src/index.ts` — `listModels` → choix d’un id flash stable → publication template **Remote Config** clé **`active_gemini_model`**.
- **Client** : `src/services/geminiRemoteModelSteering.ts` — `fetchAndActivate` + `getValue` ; priorité **RC au refresh réussi** ; vidage du fichier AsyncStorage de secours à ce moment (pas d’override silencieux au boot sur la valeur RC).
- **Logs sentinelle** : JSON structuré post-publish (`ANCIEN_MODELE`, `NOUVEAU_MODELE`, `transition`, `did_change`) — voir aussi `ARCHITECTURE.md`.

### Self-healing (404 / 503 côté `generateContent`)

- Appelants (`geminiSemanticLab`, etc.) → `recoverGeminiModelViaListModels` : **listModels** côté client, shortlist (`geminiModelCatalog`), persistance TTL **24h** + mise à jour cache mémoire pour la session.
- **RC** : reste la source de vérité au prochain refresh réussi ; pas de relance « disque d’abord » au démarrage.
- **Logs Metro** : `[GeminiSteering] 🛠️ SELF_HEALING_TRIGGERED` (nombre de modèles listés + nouveau choix local) ; chaque appel API Gemini → `[GeminiAPI] CALL_SUCCESS|CALL_ERROR` ; fin de chaîne one-tap avec `chainPerf` → `[OneTapPerf] 🏁 END_TO_END_CHAIN`.

### Gemini général (lab / expert)

- Stratégie **ListModels + fallback court** (max 3–4 modèles), **404 → modèle suivant** ; `candidateCount = 1`, génération légère — voir `.cursorrules`.

---

## 4. Glossaire KPIs perf (one-tap Quick)

Repères `performance.now()` **arrondis** sauf mention ; type `OneTapPerfMsSnapshot` dans `src/constants/talkCaptureDebug.ts` ; logs `[OneTapPerf]` dans `TalkDebugScreen`.

| Marqueur | Nature | Définition |
|----------|--------|-------------|
| **T0** (`t0`) | Instantané absolu | Fin de capture (micro / reco arrêtés). Début du funnel « utilisateur voit l’état post-capture ». |
| **T1** (`t1`) | Instantané absolu | Entrée du **traitement async** Dual-Path (après squelette local + ouverture modale). |
| **T2** | *Non instrumenté* | **Aucun champ `t2`** dans le payload. Pour diagnostiquer la « phase du milieu » (hors Gemini) : utiliser **`totalFromT1Ms - geminiMs`** ≈ pre-save Firestore + replace draft + marge ; ne pas chercher un `T2` dans le JSON. |
| **T3** (`t3`) | Instantané absolu | Fin du lot async (refine stream terminé + persistance / replace draft). |
| **`geminiMs`** | Durée | `gemEnd - gemStart` — phase streaming Gemini seule. |
| **`totalFromT1Ms`** | Durée | `t3 - t1` — tout l’arrière-plan après T1. |

Régressions vitesse : comparer `geminiMs` (réseau / modèle) vs `totalFromT1Ms - geminiMs` (client + Firestore).

---

## 5. Points de vigilance (dette / risques)

| Sujet | Détail |
|--------|--------|
| **IndexedDB absente (RN / Hermes)** | Le SDK JS **Remote Config** choisissait IndexedDB si `typeof indexedDB === 'object'` (piège `null`). Garde-fou : `src/api/firebaseIndexedDbGuard.ts` + import très tôt dans `index.ts` et tête de `src/api/firebase.ts` ; imports steering : **`firebase` avant `firebase/remote-config`**. Persistance RC = **mémoire** (acceptable mobile). |
| **IAM Remote Config** | La sentinelle (compte de service Functions) doit avoir les droits de **lecture/écriture** template Remote Config (ex. rôles Firebase / `firebase.remoteconfig.*` selon votre org). Sinon publish silencieux ou erreur côté Cloud. |
| **fetch RC** | Échecs plateforme / IDB : repli silencieux sur defaults locaux + pas de spam `console.warn` pour erreurs « benign » (`geminiRemoteModelSteering`). |
| **Auth Firestore** | `ensureFirebaseAnonymousAuth` avant écritures ; règles `request.auth != null`. |

### Fonctionnalités connexes (hors cœur Dual-Path)

- **Talk Deep** : autre mode capture / analyse (payload `geminiFullJson` dans debug).
- **Debug** : `DebugScreen` — santé modèle IA, refresh RC, affichage perf one-tap (`debug.oneTapPerf*`).
- **Trafic / SQLite / navigation** : hors carte « intention IA » — ne pas supposer qu’ils suivent les mêmes contraintes latence.

---

_Fichiers d’architecture humains : `ARCHITECTURE.md`. Code détaillé : JSDoc dans `oneTapUniversalCapture.ts`, `geminiRemoteModelSteering.ts`, `geminiSemanticLab.ts`._
