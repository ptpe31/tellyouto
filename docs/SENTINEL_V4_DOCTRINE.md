# SENTINEL V4 — DOCTRINE (“Stabilité Zen”)

## 0) Intention stratégique
Sentinel V4 ne cherche pas la précision maximale en continu. Il cherche la stabilité perçue.

- **Produit** : on vend une **fenêtre de départ serein** (un créneau), pas une “heure exacte” qui hésite.
- **Technique** : la “vérité interne” peut évoluer (ticks + extrapolation), mais l’UI doit rester stable et n’évoluer que lorsque l’on a une preuve (scan réel) ou lorsque l’écart devient significatif.

---

## 1) Notions de vérité

### 1.1 Fenêtre de confort
Sentinel travaille avec une fenêtre de départ :

- `W = [tOptimiste ; tPessimiste]`

Interprétation :
- `tOptimiste` : début du créneau où partir devient pertinent.
- `tPessimiste` : fin du créneau confortable ; au-delà, on entre en zone critique.

### 1.2 Vérité interne vs vérité affichée
- **Vérité interne** `W_internal` : fenêtre recalculée localement (toutes les 60s) via extrapolation, sans appels réseau.
- **Vérité affichée** `W_displayed` : fenêtre réellement montrée à l’utilisateur (notification sticky / UI). Elle est **strictement paresseuse** et ne bouge que sur des conditions de rupture.

Objectif UX : si l’utilisateur consulte son téléphone à 5 minutes d’intervalle, il doit voir la même fenêtre, sauf événement majeur.

---

## 2) Calcul base : Newton window
À partir de l’arrivée cible `arrivalAtMs` et de la durée trafic `durationTrafficSec` :

- `tPessimisteMs = arrivalAtMs - durationMs - 5min`
- `tOptimisteMs = tPessimisteMs - 0.15 * durationMs`

Cette fenêtre “Newton” sert de base aux statuts :
- BLEU si `now < tOptimiste`
- ORANGE si `tOptimiste <= now < tPessimiste`
- ROUGE si `now >= tPessimiste`

---

## 3) Dégradation inter-scans : V_flow (extrapolation)

### 3.1 Paramètres figés
- Tick interne : 60s
- Affichage paresseux : mise à jour uniquement si dérive > 5 minutes
- `CRITICAL_BUFFER_MIN = 5`
- Dégradation initiale : 10s/min
- Cap de dégradation : 30s/min max
- Scan 2 : obligatoire

### 3.2 Définition
Entre deux scans réels, on simule une dégradation progressive du trafic en “resserrant” la fenêtre, sans API.

On définit un coefficient auto-adaptatif `V_flow` à partir de deux points de mesure (Scan 1 et Scan 2) :

- `V_flow = (ΔDuréeTrafic) / (ΔTempsRéel)`
- Clamp `V_flow` dans `[0 ; 1]`

Dans l’implémentation, on manipule généralement une forme “sec/min” :
- `degradationSecPerMin = clamp( computedSecPerMin, 0, 30 )`

Notes :
- Si le trafic s’améliore, on ne “rend” pas du confort sans preuve : on borne `ΔDuréeTrafic >= 0`.

### 3.3 Application
Sans scan réel, on applique :
- `tPessimisteDegradedMs = tPessimisteBaseMs - degradation(elapsedRealTime)`

On ne remonte jamais `tPessimiste` sans scan réel (monotonie).

---

## 4) Garde-fous de robustesse (G1 à G4)

### G1 — Fenêtre jamais dans le passé
- `tPessimisteDegradedMs >= nowMs`
- `tOptimisteBaseMs` clampé pour éviter des valeurs manifestement incohérentes.

### G2 — Largeur minimale
Empêcher un intervalle quasi nul / inversé.
- si `tPessimiste - tOptimiste < windowWidthMinMs` alors on force une largeur minimale ou on bascule en alerte rouge explicite.

### G3 — Monotonie (effet Zen)
Entre deux scans réels :
- `tPessimisteDegradedMs` ne peut que décroître (ou rester stable).
- La fenêtre affichée ne s’améliore jamais sans preuve.

### G4 — Cap de dégradation (anti panique)
Même si `V_flow` est très agressif :
- `degradationSecPerMin <= 30`

---

## 5) Scans “Sniper” (3 scans max)
Objectif : viser 2 à 3 scans maximum par trajet, en remplaçant la cadence fixe par des déclencheurs.

### Scan 1 (initial) — obligatoire
- Calage initial de la durée trafic (Distance Matrix) et calcul de `W_base`.
- Snapshot GPS origin figé.

### Scan 2 (entrée ORANGE) — obligatoire
Déclenchement :
- `now >= tOptimisteBaseMs`
But :
- mesurer la dynamique réelle, calculer `V_flow` crédible.
Tolérance :
- retry unique si échec (pas de boucle).

### Scan 3 (sécurité) — conditionnel
Déclenchement :
- si `bufferSafetyMin <= CRITICAL_BUFFER_MIN` via extrapolation interne
But :
- recalibrage ultime pour éviter faux positifs / faux “départ immédiat”.
Si échec :
- bascule **Mode Sécurité** (message explicite), sans supprimer la sticky.

---

## 6) Snapshot GPS & cache (économie)

### 6.1 Snapshot origin unique
L’origin est figée au Scan 1 pour stabiliser le segment et rendre le cache pertinent.

### 6.2 Cache segment 15 minutes
Pour un segment `{originSnapshotRounded, destination, mode}` :
- aucun appel API redondant pendant 15 minutes
- exceptions autorisées uniquement pour Scan 2 (pivot) et Scan 3 (sécurité)

---

## 7) Stabilité d’affichage (“Strictement paresseux”)
La notification sticky / UI ne bouge que si :
- un scan réel a eu lieu, ou
- la dérive entre `W_internal` et `W_displayed` dépasse 5 minutes, ou
- seuil critique atteint (buffer <= 5 min) : rupture volontaire pour alerter.

---

## 8) Cohérence & versionning d’état (anti race conditions)

### 8.1 Scheduler maître unique
- Le `TrafficScheduler` est l’unique autorité qui décide quoi afficher.
- Le NotificationManager n’exécute que des ordres (render commands).

### 8.2 Versionning
Chaque publication UI porte :
- `tripTaskId`
- `stateVersion` (monotone)
- `W_displayed` (start/end)
- `W_internal` (start/end) pour debug

Le NotificationManager ignore toute commande dont la version est inférieure à la dernière appliquée.

---

## 9) Logs stratégiques (exigences d’audit)
Logs par trajet (format recommandé, sans PII) :
- **État UI** : `W_displayed` (ex: `08:10-08:35`)
- **Vérité interne** : `W_internal` (pour mesurer le delta)
- **Indicateurs de flux** : `V_flow`, `mode = REAL|EXTRAPOLATED`, `flowCalibrated`
- **Planification** : `nextRealScanAt`, `reason = SCAN1|SCAN2|SCAN2_RETRY|SCAN3_CRITICAL`
- **Économie** : `apiCallsTotal`, `apiCallsAvoidedCache`, `apiCallsAvoidedExtrapolation`

---

## 10) Implémentation de référence (code)
Le comportement V4 décrit ici correspond à l’implémentation actuelle :

- Orchestrateur principal : `TrafficSchedulerV4`  
  `src/services/traffic/TrafficSchedulerV4.ts`
- Notifications sticky (exécution des ordres + anti out-of-order) : `SentinelNotificationManager`  
  `src/services/traffic/TrafficNotificationService.ts`
- Cartographie trafic : `DistanceMatrixMapsService` (Google Distance Matrix + cache TTL 15 min)  
  `src/services/traffic/DistanceMatrixMapsService.ts`
- Snapshot GPS (foreground) : `SentinelLocationService`  
  `src/services/traffic/SentinelLocationService.ts`
- Runtime global : `startSentinelRuntime()` + `SentinelBootstrap`  
  `src/services/traffic/sentinelRuntime.ts`, `src/components/SentinelBootstrap.tsx`, `App.tsx`
- Réconciliation Newton / mutations : `reconcileSentinelForIntentionId()`  
  `src/services/traffic/sentinelReconciler.ts`
- Background task (best-effort, sans scans payants) : `SentinelBackgroundService`  
  `src/services/traffic/SentinelBackgroundService.ts`
- Activation DB Sentinel : `activateSentinelTrip()` (écrit la base + initialise le cycle Scan 1)  
  `src/services/traffic/sentinelActivation.ts`

Note : `TrafficScheduler.ts` est un scheduler legacy. V4 se fait via `TrafficSchedulerV4.ts`.

---

## 11) Source de vérité & versionning (contrat technique)

### 11.1 Scheduler maître unique
Le scheduler (V4) est l’unique autorité qui décide :
- la fenêtre interne (`W_internal`)
- la fenêtre affichée (`W_displayed`)
- quand “briser” la stabilité (dérive > 5 min, scan réel, seuil critique)
- la planification du prochain scan réel
- l’économie (compteurs d’appels)

Le NotificationManager n’effectue aucun calcul : il reçoit un ordre de rendu complet (fenêtre, statut, plan).

### 11.2 Anti race conditions : stateVersion
Chaque rendu sticky possède un `stateVersion` (monotone par `tripTaskId`).
- Si un ordre arrive en retard (version inférieure à la dernière appliquée), il est ignoré.
- Objectif : éviter un affichage qui “revient en arrière” suite à des timers concurrents ou une reprise d’app.

---

## 12) Détection de mutations & reset (priorité stabilité)

### 12.1 Fingerprint (référence)
Une mutation structurante doit relancer un cycle complet (Scan 1).
Dans l’implémentation, un `fingerprint` encode :
- destination coords (lat/lng arrondies)
- heure d’arrivée (`arrivalAtMs`)
- mode transport (`transport_mode`)

### 12.2 Mutations structurantes
Le cycle est reset si l’un des éléments suivants change :
- destination (placeId/lat/lng/adresse validée)
- horaire arrivée
- mode de transport

Conséquence :
- `scanCount = 0`
- `V_flow = 10 sec/min` (initial)
- `flowCalibrated = false`
- origin snapshot sera reprise au prochain Scan 1
- `stateVersion++`

---

## 13) Algorithme V4 (référence exécutable)

### 13.1 Constantes V4
- Tick interne : `INTERNAL_TICK_MS = 60_000`
- Stabilité UI : `UI_LAZY_DRIFT_MS = 5 * 60_000`
- Critique : `CRITICAL_BUFFER_MIN = 5`
- Dégradation initiale : `VFLOW_INIT_SEC_PER_MIN = 10`
- Cap dégradation : `VFLOW_CAP_SEC_PER_MIN = 30`
- Cache TTL : 15 min

### 13.2 Fenêtre base (Newton)
À partir du dernier scan réel (durée trafic `durationTrafficSec`) :
- `W_base = [tOptimisteBaseMs ; tPessimisteBaseMs]` via Newton window

### 13.3 Fenêtre interne (extrapolée)
Sans scan réel, à chaque tick :
- `elapsedMin = (now - lastRealScanAt)/60_000`
- `degradationSec = elapsedMin * vFlowSecPerMin`
- `tPessimiste_internal = tPessimisteBase - degradationSec*1000`
Puis application G1/G3 :
- G1 : `tPessimiste_internal >= now`
- G3 : `tPessimiste_internal <= previousInternalTPessimiste` (monotonie)

### 13.4 Mise à jour affichage (strictement paresseux)
L’UI (sticky) ne bouge que si :
- un scan réel vient d’avoir lieu, ou
- `max(|Δstart|, |Δend|) >= 5 min`, ou
- `bufferSafetyMin <= 5` (rupture critique)

---

## 14) V_flow auto-adaptatif (Scan 2 obligatoire)

### 14.1 Avant Scan 2
`vFlowSecPerMin = 10` (prudente).

### 14.2 Calcul après Scan 2
Après Scan 2, à partir de deux points de mesure :
- `ΔDuréeTraficSec = max(0, durationScan2 - durationScan1)`
- `ΔTempsRéelMin = max(0.1, (t2 - t1)/60_000)`
- `computedSecPerMin = ΔDuréeTraficSec / ΔTempsRéelMin`
- `vFlowSecPerMin = clamp(computedSecPerMin, 0, 30)`

Le clamp à 30 sec/min (G4) est un verrou d’UX : jamais de fermeture “hystérique”.

### 14.3 Retry unique Scan 2
Si le scan 2 échoue :
- un retry unique est autorisé (pas de boucle)
- si le retry échoue aussi : on reste sur `10 sec/min` et on garde la stabilité UI (pas de spam)

---

## 15) Stratégie Sniper (3 scans max)

### Scan 1 — Initial (obligatoire)
- Capture origin snapshot (foreground)
- Appel Distance Matrix
- Calcul Newton window base
- Publie immédiatement `W_displayed = W_internal = W_base`
- Programme Scan 2 à l’entrée ORANGE (`now >= tOptimisteBase`)

### Scan 2 — Entrée ORANGE (obligatoire)
- Appel Distance Matrix
- Recalage Newton window base
- Calcul `V_flow` (pivot crédibilité)
- Pré-calcule un `nextRealScanAtMs` estimé pour Scan 3 (sécurité)

### Scan 3 — Sécurité (conditionnel)
Déclenchement :
- si `bufferSafetyMin <= 5` d’après l’extrapolation

Si Scan 3 échoue :
- bascule “Mode Sécurité” (sticky conservée, message explicite)

---

## 16) Cache & économie (réduction drastique d’appels)

### 16.1 Cache segment (Distance Matrix)
Le cache s’applique à la clé :
- `{originSnapshotRounded, destinationLatLngRounded, mode}`

Politique :
- TTL 15 minutes
- compteur `apiCallsAvoidedCache++` si résultat issu du cache
- compteur `apiCallsTotal++` uniquement si requête réseau réelle

### 16.2 Extrapolation = “appels évités”
Lorsque la fenêtre interne bouge sans scan réel et que l’UI reste stable :
- compteur `apiCallsAvoidedExtrapolation++` (mesure de l’économie réalisée par la doctrine)

---

## 17) Logs (format implémenté)
Les traces sont envoyées dans `user_activity_logs` avec `action_type = SENTINEL_TRACE`.

Payload (`meta_json`) :
- `tripTaskId`
- `uiWindow` (ex: `08:10-08:35` ou null si non défini)
- `internalWindow` (ex: `08:07-08:32`)
- `vFlowSecPerMin`
- `flowMode` (`REAL` ou `EXTRAPOLATED`)
- `nextRealScanAt` (HH:mm ou null)
- `nextRealScanReason`
- `apiCallsTotal`
- `apiCallsAvoidedCache`
- `apiCallsAvoidedExtrapolation`

Stratégie de volume :
- persistance échantillonnée (toutes les 10 minutes par trajet) et forcée sur événements majeurs
- log console en plus si `EXPO_PUBLIC_VERBOSE_DEBUG=1`

---

## 18) i18n (contrat UX)
Le sticky V4 utilise des clés i18n (au minimum fr/en) :
- `sentinel.notifDepartureWindow`
- `sentinel.notifNextRealUpdateAt`
- `sentinel.notifModeSafety`
- `sentinel.notifTitle`
- `sentinel.notifUpdatedAt`
- `sentinel.notifStatusBlue|Orange|Red|Static`

---

## 19) Variables d’environnement (API)
Distance Matrix attend :
- `EXPO_PUBLIC_GOOGLE_DISTANCE_MATRIX_API_KEY`

Fallback de compatibilité :
- si non présent, la clé Places `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` est utilisée (à restreindre côté GCP si cette option est conservée).

