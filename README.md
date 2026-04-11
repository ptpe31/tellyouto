# TellYouTo

Application mobile **Expo / React Native** pour structurer intentions, focus et recharge, avec un **co-pilote** calibré sur ton spectre (Structure, Momentum, Zen, Stats).

## Priorisation sémantique contextuelle

TellYouTo ne se contente pas de règles fixes : la **priorité** d’une intention (1–100) combine :

- **L’alignement** entre le texte (titre + description) et ton **spectre** actuel (mots-clés par dimension).
- Une **inférence d’importance** à partir du **sens** du libellé (examens, échéances, tâches légères, etc.) et de **l’heure réelle** au moment du calcul (`new Date()` dans le fuseau de l’appareil).

En **Radar**, tu peux cocher **« Urgent »** : l’agent applique alors une priorité **85–90** (valeur stable dérivée du texte, pas aléatoire à chaque affichage).

Les intentions interprétées comme **fin de soirée / nuit** (motifs horaires dans le texte, grappes sémantiques multilingues pour sommeil, soirée, routine du soir, etc.) reçoivent le flag **`is_late_night`** et sont **rangées sur le rail temporel après 21h00** (segment distinct, jusqu’à ~23h45), tandis que le reste de la journée reste proposé **jusqu’à 20h00**, **sans créneau dans le passé** (premier créneau ≥ max(heure actuelle, ouverture du rail)).

L’**ordre** sur le rail : **priorité** décroissante, puis **densité** (durée estimée) : blocs plus lourds en premier lorsque **Momentum + Stats** domine sur **Structure + Zen**, inverse sinon.

> Les heuristiques sont locales, offline-first (SQLite) ; elles peuvent évoluer sans changer l’architecture.

## Développement

```bash
npm install
npx expo start
```

### Firebase (projet Google Cloud)

- **ID projet** : `tellmeto-4f3c7` — c’est celui de la console Firebase / GCP et de `EXPO_PUBLIC_FIREBASE_PROJECT_ID`. Le **slug Expo** (`tellyouto` dans `app.json`) est le nom d’app ; ne pas le confondre avec l’ID projet.
- **Variables** : copier `env.example` vers `.env` et renseigner les clés ; ou utiliser le fichier `env` puis `cp env .env` (Expo ne charge que `.env` à la racine).
- **CLI** : à la racine, `firebase use tellmeto-4f3c7` (voir `.firebaserc`). Déploiement des fonctions : `npm run deploy:functions`.

### Cloud Functions (Gen 2, `functions/src`)

**Région** : toutes les fonctions exportées depuis `functions/src/index.ts` sont servies en **`europe-west9`** (Paris) — `setGlobalOptions({ region: 'europe-west9' })` pour HTTPS et schedulers ; les triggers Firestore dans `transitPurgeTriggers.ts` reprennent explicitement `region: 'europe-west9'`. La constante `FN_REGION` dans `region.ts` documente la même valeur. URL de base : `https://europe-west9-tellmeto-4f3c7.cloudfunctions.net/<nomFonction>`.

| Fonction | Rôle | Déclencheur | Flux de données |
|----------|------|-------------|------------------|
| **`botWebhook`** | Réception **générique** des messages messagers (WhatsApp / Slack / Line / Telegram via corps JSON maison). Résout l’appareil via `messengerBindings`, applique quotas / handshake, écrit un document dans **`devices/{deviceId}/rail_inbox`** pour transit vers l’app. | **HTTPS** (`onRequest`, POST ; GET = sonde) | **Messagerie → Cloud** (webhook tiers ou tests avec `x-webhook-secret` / `BOT_WEBHOOK_SECRET`) → **Firestore** ; l’**app mobile** écoute / consomme `rail_inbox` puis supprime côté client ; réponses utilisateur via **API messager** (Telegram / WhatsApp) depuis `botReply`. |
| **`telegramWebhook`** | Webhook **natif Telegram** (format Bot API). Vérifie `x-telegram-bot-api-secret-token` (`TELEGRAM_WEBHOOK_SECRET`), gère `/start` + deep-link de liaison (`users`, `messengerBindings`, `devices`), sinon délègue au même cœur métier que `botWebhook` pour alimenter `rail_inbox`. | **HTTPS** (POST updates Telegram ; GET = sonde) | **Telegram → Cloud** → **Firestore** (`rail_inbox`, profils device) → **app** ingère le transit ; réponses **Telegram** (`sendMessage`). |
| **`disconnectMessenger`** | Déconnexion du canal : message d’adieu, suppression du doc **`messengerBindings/{channel}_{id}`**, retrait des champs `last_messenger_*` sur **`devices/{deviceId}`**. | **HTTPS** (POST, CORS activé ; secret `x-webhook-secret` si `BOT_WEBHOOK_SECRET` défini) | **App mobile** appelle l’URL après action utilisateur dans les réglages → **Cloud** met à jour Firestore et envoie le message de départ via **Telegram / WhatsApp** selon le dernier canal lié. |
| **`scheduleProactiveReminders`** | Rappels **« avant le créneau rail »** : lit `devices` avec `rail_reminder_windows` récents, envoie un message Telegram dans une fenêtre de ±2 min après `remindAtUtcMs` (évite doublons via `reminder_sent_map`). | **Scheduler** (`onSchedule`, **toutes les minutes**, fuseau UTC) | **App** pousse fenêtres + méta sur **`devices/{deviceId}`** ; **Cloud** lit Firestore et appelle **Telegram** ; pas d’écriture d’intention SQLite côté serveur. |
| **`purgeStaleTransitData`** | Hygiène **transit** : supprime vieux documents **`rail_inbox`** (> 24 h), intentions de transit expirées (`transit_expires_at`), et orphelins encore marqués `processed` (filet si `deleteDoc` client a échoué). | **Scheduler** (`onSchedule`, **toutes les 6 h**, UTC) | **Firestore uniquement** ; aucun appel direct à l’app ; allège la rétention cloud après sync / expiration. |
| **`onRailInboxMarkedProcessed`** | Quand un doc **`devices/{deviceId}/rail_inbox/{docId}`** passe à **`processed: true`**, suppression serveur du document (sécurité + rétention si le client n’a pas pu le supprimer). | **Firestore** (`onDocumentUpdated` sur ce chemin) | **App** marque traité après ingestion → **trigger** efface le doc résiduel. |
| **`onDeviceIntentionTransitProcessed`** | Même logique pour **`devices/{deviceId}/intentions/{docId}`** marqué `processed: true` (copies temporaires de sync). | **Firestore** (`onDocumentUpdated`) | **App** / sync → **Firestore** → purge automatique côté Cloud. |
| **`helloWorld`** | Point de contrôle minimal (réponse `ok`) pour valider déploiement / connectivité. | **HTTPS** (GET/POST, CORS) | Aucun lien métier avec l’app ou Telegram ; diagnostic uniquement. |

Les modules `messengerWebhookCore.ts`, `webhookHandler.ts`, `purgeTransitData.ts`, `scheduleProactiveReminders.ts`, `botReply.ts`, `reminderMessages.ts`, `railHandshake.ts`, `botLocales.ts`, `botTypes.ts` portent la logique **partagée** ; seules les entrées du tableau ci-dessus sont exposées comme Cloud Functions déployables.

## Architecture des alarmes (local, sans dépendance Cloud pour sonner)

Les **alarmes rail** (rappel à l’heure sur l’appareil) ne passent **pas** par Firebase pour être déclenchées. Chaîne résumée : **Agent IA → SQLite → Expo Notifications** (le téléphone sonne grâce au runtime local, pas à un push serveur).

1. **Agent IA / UI** — création ou mise à jour d’intentions (texte, horaire, récurrence, toggle alarme).
2. **SQLite** — source de vérité **offline-first** (`localDb` : insert / update / delete sur la table `intentions`).
3. **Couche matérielle** — après chaque écriture pertinente, `intentionHardwareSync` appelle `refreshRailAlarmsAfterLocalDbChange` dans `alarmManager`, qui recalcule les créneaux et programme **Expo Notifications** (identifiants stables, annulation avant reprogrammation, bootstrap au cold start / après reboot via les permissions Android / hooks natifs).

Le **Cloud** intervient pour le **messager** (Telegram, etc.) et le **transit Firestore** (`rail_inbox`, rappels texte `scheduleProactiveReminders`), pas pour déclencher la **sonnerie native** sur le téléphone. Même sans réseau, une intention déjà en base avec alarme activée peut être synchronisée avec le OS tant que l’app a pu exécuter le refresh local.

## Mode production

- `IS_PRODUCTION` est à `true` dans `src/config/appConfig.ts` : l’onglet **Debug** est masqué.
- **Déverrouillage** : 5 appuis sur la **ligne de version** dans **Agent → Réglages** (co-pilote).

## Persistance (données locales)

- **AsyncStorage** (profil spectre, etc.) : écriture explicite avec `await` ; à la mise en **arrière-plan** (`AppState`), le spectre est sauvegardé immédiatement, et un **checkpoint SQLite** (`PRAGMA wal_checkpoint`) force l’écriture disque du journal WAL.
- **Sauvegarde automatique du spectre** : toutes les **5 minutes** (même logique : spectre + checkpoint SQLite).
- **SQLite** : les opérations `runAsync` / `execAsync` sont persistées par le moteur ; le checkpoint en sortie d’arrière-plan limite la perte en cas de kill OS.

## Assets (icônes & splash)

- Icône principale : `assets/icon.png` (1024×1024).
- Android adaptive : `assets/adaptive-icon.png` (1024×1024) — utilisé aussi pour l’**écran de démarrage** (splash) afin d’éviter un doublon de fichier.
- Favicon web : `assets/favicon.png`.
- Pour alléger le bundle, privilégier des PNG indexés ou optimisés (sans dégrader les exigences stores).

## Déploiement (Expo EAS)

### Prérequis

1. Compte [Expo](https://expo.dev), CLI : `npm install -g eas-cli`.
2. À la racine du projet : `eas login` puis `eas init` (lie le dépôt à un projet Expo et peut ajouter `extra.eas.projectId` dans `app.json`).

### Variables d’environnement

- Modèle : copier `env.example` vers `.env` (déjà ignoré par Git) et renseigner les clés `EXPO_PUBLIC_*`.
- **Build EAS** : les variables `EXPO_PUBLIC_*` présentes dans l’environnement au moment du build sont injectées dans le bundle (voir [Variables Expo](https://docs.expo.dev/guides/environment-variables/)). Tu peux aussi les définir dans le tableau de bord Expo (**Project → Environment variables**) ou via `eas secret:create` pour les valeurs sensibles côté build/serveur — ne jamais committer de secrets dans le dépôt.
- Les profils dans `eas.json` fixent `EXPO_PUBLIC_APP_ENV` (`development` / `preview` / `production`).

### Profils de build (`eas.json`)

| Profil | Usage |
|--------|--------|
| **development** | Client de développement (debug), distribution interne, APK. |
| **preview** | Bêta interne, APK (Android). |
| **production** | Release store : Android **AAB** (Play Store), iOS **IPA** (App Store Connect). |

### Générer un APK (Android)

- **Preview / test** : `npm run build:android:preview` ou `eas build --platform android --profile preview` → artefact **APK** téléchargeable (installation directe ou canal interne).
- **Play Store (recommandé)** : `npm run build:android` → **AAB** pour la soumission ; Google Play génère les APK optimisés par appareil.

### Générer un IPA (iOS)

- Configurer les identifiants Apple dans EAS (certificats / profils de provisioning) lors du premier build iOS.
- Commande : `npm run build:ios` ou `eas build --platform ios --profile production`.
- Soumission : `eas submit --platform ios` (après configuration App Store Connect).

### OTA (optionnel)

- `expo-updates` est inclus ; `runtimeVersion` suit la **version** de l’app (`app.json`). Les mises à jour JS peuvent être publiées avec EAS Update une fois le projet configuré.

## Licence

Projet privé — voir les mentions dans l’app (**À propos**).
