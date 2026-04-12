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

## Licence

Projet privé — voir les mentions dans l’app (**À propos**).
