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
