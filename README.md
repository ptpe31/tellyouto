# TellYouTo

Application mobile **Expo / React Native** pour structurer intentions, focus et recharge, avec un **co-pilote** calibré sur ton spectre (Structure, Momentum, Zen, Stats). Ce README est le **manifeste technique** : architecture locale, temps, alarmes et confidentialité.

---

## Architecture : Agent → SQLite → matériel (Expo Notifications)

**Chaîne de confiance** (la sonnerie ne dépend pas du cloud) :

1. **Interface & agent local** — saisie d’intentions (Radar, messagerie ingérée, debug), règles dans `src/services/agentLogic.ts`.
2. **SQLite** — source de vérité **offline-first** (`src/api/localDb.ts`) : table `intentions`, routines, file de sync.
3. **Hardware sync** — après chaque écriture pertinente, `src/api/intentionHardwareSync.ts` appelle `alarmManager.refreshRailAlarmsAfterLocalDbChange`, qui relit **uniquement** la base et programme / annule des **Expo Notifications** (`DATE` triggers, identifiants stables).

Le **Cloud** (Firebase) sert au **profil**, au **transit** des messages (`rail_inbox`) et à la sync optionnelle — **pas** au déclenchement de l’alarme native sur le téléphone. Sans réseau, une intention déjà en base avec alarme peut toujours être alignée avec l’OS tant que l’app a exécuté le refresh local.

---

## Gestion du temps : moteur universel (structure + `Intl`)

L’extraction d’heure depuis le titre / la description vit dans **`extractClockMinutesFromText`** (`agentLogic.ts`).

- **Pourquoi** : l’utilisateur exprime une heure dans des formes très variées ; le moteur repose sur des **motifs numériques** (séparateurs, suffixes AM/PM, `uhr`, etc.) et sur **`Intl.DateTimeFormat`** (cycle 12h/24h via la locale effective), pas sur des listes « par pays » à maintenir.
- **Désambiguïsation** : pour les heures « nues », on choisit la **prochaine occurrence future** la plus proche (proximité temporelle), avec résolution d’**ancre calendaire** (`resolveAnchorDateYmdForClockMinute`) si l’heure du jour est déjà passée.
- Les locales **`systemLocale`** (ex. `expo-localization`) et **`aiLanguage`** (profil / interaction) contextualisent le parsing sans coder de règles nationalistes dans les regex.

Logs de diagnostic : préfixe `[UNIVERSAL-TIME]` en développement.

---

## Modèle « flexible » vs « ancré » (anti-dérive)

| Concept | Rôle |
|--------|------|
| **`is_flexible`** | Créneau que le rail peut **déplacer** (Momentum, Zen, calendrier busy). |
| **Ancrage fixe** | `is_flexible === false` : l’heure **`fixed_start_minutes`** est **sacrée** pour l’affichage rail tant que la tâche n’est pas faite. |
| **`alarm_enabled`** | Alarme matérielle ; **mutuellement exclusif** avec le mode flexible (sinon double vérité). |

**Protection contre la dérive temporelle** : lors de la création, **`computeRailAnchorAndFixedStartForNewIntention`** applique un ordre strict : (1) minute déjà fixée sur le candidat, (2) **heure extraite du texte** (priorité absolue), (3) **seulement sinon** premier créneau issu du placement fluide (`buildTimelineSlots`). Ainsi, « Réveiller les enfants à 09h45 » ne peut plus être écrasé par un slot rail à 09h37. Le **matériel** (`alarmManager`) programme les alarmes non récurrentes **à partir des champs SQLite** (`fixed_start_minutes` + ancre), sans recalcul parallèle du rail graphique.

Les invariants sont rappelés en **commentaires « Loi du système »** dans `agentLogic.ts` et `alarmManager.ts` pour les évolutions futures.

---

## Sécurité, confidentialité et hygiène des données

- **Offline-first** : les intentions sensibles vivent d’abord en SQLite sur l’appareil ; la sync Firestore est un miroir optionnel, pas le pilier de l’alarme.
- **Reset intentions** (`deleteAllIntentions`) : transaction SQLite (`DELETE`), puis **`VACUUM`** pour compacter le fichier, **`cancelAllScheduledNotificationsAsync`** (toutes les notifs locales), nettoyage des poignées rail, événement global `tellyouto/intentions_changed` pour rafraîchir l’UI. Objectif : **silence radio** — plus de données intentions, plus d’alarmes résiduelles côté OS.
- **Checkpoint** : en arrière-plan, `PRAGMA wal_checkpoint` limite la perte WAL (voir section Persistance ci-dessous).

---

## Priorisation sémantique (résumé)

La **priorité** (1–100) combine l’alignement texte ↔ spectre et une **importance sémantique** (examens, échéances, etc.) avec l’heure réelle locale. Le rail ordonne par priorité puis par stratégie de densité (Momentum/Stats vs Structure/Zen). Tout ceci reste **local** et évolutif sans casser la chaîne SQLite → alarmes.

---

## Développement

```bash
npm install
npx expo start
```

### Firebase (projet Google Cloud)

- **ID projet** : `tellmeto-4f3c7` — console Firebase / GCP et `EXPO_PUBLIC_FIREBASE_PROJECT_ID`. Le **slug Expo** (`tellyouto` dans `app.json`) est le nom d’app.
- **Variables** : copier `env.example` vers `.env` ; Expo ne charge que `.env` à la racine.
- **CLI** : `firebase use tellmeto-4f3c7` (voir `.firebaserc`). Déploiement des fonctions : `npm run deploy:functions`.

### Cloud Functions (Gen 2, `functions/src`)

**Région** : `europe-west9` (Paris) — voir `setGlobalOptions` et `FN_REGION` dans le dépôt functions.

| Fonction | Rôle (résumé) |
|----------|----------------|
| **`botWebhook`** | Webhook messagers générique → `devices/{deviceId}/rail_inbox`. |
| **`telegramWebhook`** | Webhook Telegram natif + deep-links. |
| **`disconnectMessenger`** | Déconnexion canal, nettoyage bindings. |
| **`scheduleProactiveReminders`** | Rappels Telegram avant créneau (fenêtres depuis l’app). |
| **`purgeStaleTransitData`** | Hygiène Firestore (transit expiré). |
| **`onRailInboxMarkedProcessed`** / **`onDeviceIntentionTransitProcessed`** | Purge docs résiduels après traitement client. |
| **`helloWorld`** | Santé déploiement. |

Le détail des flux et des modules partagés (`messengerWebhookCore`, `webhookHandler`, etc.) reste documenté dans le code des functions.

---

## Mode production

- `IS_PRODUCTION` dans `src/config/appConfig.ts` masque l’onglet **Debug**.
- **Déverrouillage Debug** : 5 appuis sur la ligne de version dans **Agent → Réglages**.

---

## Persistance (données locales)

- **AsyncStorage** (profil spectre, etc.) : sauvegarde explicite ; à l’**arrière-plan** (`AppState`), spectre + **checkpoint SQLite** (`PRAGMA wal_checkpoint`).
- **Sauvegarde périodique** du spectre (ex. toutes les 5 min) + checkpoint WAL.
- **SQLite** : opérations sérialisées via `runSerializedSqlite` pour la stabilité (notamment Android).

---

## Assets (icônes & splash)

- Icône : `assets/icon.png` (1024×1024).
- Android adaptive / splash : `assets/adaptive-icon.png`.
- Favicon : `assets/favicon.png`.

---

## Déploiement (Expo EAS)

### Prérequis

Compte [Expo](https://expo.dev), `npm install -g eas-cli`, `eas login`, `eas init` si besoin.

### Variables d’environnement

Copier `env.example` → `.env` ; pour les builds, voir [Variables Expo](https://docs.expo.dev/guides/environment-variables/). Ne jamais committer de secrets.

### Profils (`eas.json`)

| Profil | Usage |
|--------|--------|
| **development** | Client dev, APK interne. |
| **preview** | Bêta, APK Android. |
| **production** | Store : AAB (Android), IPA (iOS). |

Commandes typiques : `npm run build:android:preview`, `npm run build:android`, `npm run build:ios`, puis `eas submit` si besoin.

### OTA (optionnel)

`expo-updates` + `runtimeVersion` — mises à jour JS via EAS Update une fois configuré.

---

## Rapport technique - Flux "Bouton Projet" (A a Z)

Ce chapitre documente le flux complet du bouton `PROJET` tel qu'implemente dans l'application (capture, IA, persistence, validation et export agenda). Il sert de reference pour les prochaines evolutions.

### 1) Phase de capture et rebond deadline

Le flux `PROJET` est gere dans `src/screens/TalkHomeScreen.tsx` avec un etat d'interface (`uiMode`) et un mode capture dictaphone en **toggle**:

- **Toggle capture** : un tap demarre l'enregistrement, un tap "send" cloture la capture.
- **Barre action 3 boutons** pendant la capture :
  - `Trash` : annule la capture en cours.
  - `Pause/Resume` : suspend/reprend sans perdre le debut.
  - `Send` : stoppe la capture et passe en decision.
- **Conservation du Vrac** : le texte transcrit brut est stocke dans l'etat de raffinement (`projectRefine.editedText`) et reste editable.
- **Rebond deadline** : au clic `Generer plan`, on n'appelle pas l'IA tout de suite. Une modale "C'est pour quand ?" s'ouvre avec:
  - boutons rapides (`Demain`, `1 semaine`, `1 mois`)
  - capture libre micro
  - champ texte (correction manuelle)
- **Consolidation finale** : le prompt IA est construit avec `Vrac initial + deadline`.

### 2) Intelligence artificielle (`GeminiExpert`)

Le service est dans `src/services/GeminiExpert.js`.

#### 2.1 Ancrage temporel anti-hallucination

Avant l'appel API, la date systeme locale est injectee dans le prompt:

- date de reference locale `YYYY-MM-DD`
- consigne imperative: *"Aujourd'hui nous sommes le X. Toutes les dates d doivent etre calculees depuis cette date."*
- si le texte contient une deadline relative (ex: `dans 4 jours`), une date calculee est ajoutee explicitement dans le prompt.

Objectif: eviter les derives de mois (mai vs avril) et forcer un calcul calendaire coherent.

#### 2.2 Schema JSON ultra-light

Le schema demande a Gemini est volontairement minimal:

```json
{
  "projectTitle": "...",
  "tasks": [
    { "t": "Titre tache", "a": true, "d": "YYYYMMDD" }
  ]
}
```

Pourquoi ce schema:

- **fiabilite parse JSON** (moins de tokens, moins de risque de troncature)
- **latence plus basse** (payload plus court)
- **mapping UI/DB direct**:
  - `t` -> titre de tache
  - `a` -> suggestion alarme
  - `d` -> date due en format compact

#### 2.3 Repartition Today -> Deadline

La repartition des dates est deleguee a Gemini, mais contrainte par prompt:

- max 10 taches
- dates `d` obligatoires
- dates logiquement distribuees entre aujourd'hui et l'echeance utilisateur
- conversion explicite des deadlines relatives en date calendrier.

### 3) Pipeline de donnees

#### 3.1 Parsing JSON et fallback

Pipeline:

1. reponse brute Gemini
2. extraction bloc JSON
3. `JSON.parse`
4. normalisation metier

Si le parse echoue:

- erreur dediee `PLAN_JSON_PARSE_ERROR`
- UI non bloquante: message explicite + bouton `Reessayer` dans la modale deadline.

#### 3.2 Insertion SQLite et relation projet/taches

La persistence se fait dans `persistGeminiExpertRows` (`TalkHomeScreen`), via `insertTrankilV2Intention` (`src/api/trankilV2Db.ts`):

- une ligne `PROJECT` est inseree d'abord
- les lignes `TASK` pointent le projet via `parent_id`
- `due_date` est stocke sur les lignes taches
- `metadata_json` conserve aussi les drapeaux (ex: `has_alarm`, `due_date`)
- la selection utilisateur (taches cochees) est respectee a l'ancrage.

### 4) Fonctionnalites de sortie

#### 4.1 Modale de validation (souverainete utilisateur)

La modale affiche le plan et permet:

- cocher/decocher les taches a ancrer
- activer/desactiver les alarmes par tache
- visualiser la date locale de chaque tache (conversion `YYYYMMDD` via `Intl.DateTimeFormat`).

Le bouton principal `ANCRER LE PROJET` n'insere que les taches cochees.

#### 4.2 Export agenda ICS

Bouton secondaire: `EXPORTER VERS AGENDA`.

Processus:

1. filtrer les taches cochees
2. generer un `.ics` dynamique (`BEGIN:VCALENDAR`, `VEVENT`, `DTSTART;VALUE=DATE`)
3. convertir `d=YYYYMMDD` en date evenement calendrier (all-day)
4. partager le fichier via le module de partage natif (`react-native-share`) pour ouverture dans l'app calendrier.

### 5) Maintenance et nettoyage

Dans l'ecran `Debug` (`src/screens/DebugScreen.tsx`):

- inspection SQLite avec compteurs rapides (`intentions`, `tasks`)
- visualisation projets + sous-taches (accordion)
- bouton `TEST LOG` pour logger la derniere ligne brute
- purge securisee avec confirmation explicite
- purge cascade `intentions` + `tasks` (si table `tasks` presente) pour eviter les orphelins.

Recommandation maintenance:

- garder le schema IA minimal (`t/a/d`)
- ne jamais retirer l'ancrage date systeme du prompt
- conserver la route de fallback parse error en UI
- conserver la purge cascade pour les sessions debug longues.

---

## Licence

Projet privé — voir les mentions dans l’app (**À propos**).
