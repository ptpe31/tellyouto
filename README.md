# Dev Trankil v34

## Quickstart (5 min)

### Prérequis

- Node.js 20+
- npm
- Expo CLI (via `npx`)

### Installation

```bash
npm i
```

### Variables d’environnement (Expo)

#### Mode production (proxy Firebase — défaut)

Définir au minimum :

- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `EXPO_PUBLIC_FIREBASE_APP_ID`

Clés / APIs :

- `EXPO_PUBLIC_GEMINI_PROXY_URL` (URL Cloud Run du proxy Gemini, ex. `https://geminiproxystream-xxxx-ew.a.run.app`)
- `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` (Mapbox Search Box — recherche d'adresses, prod)
- `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` (legacy si `MAP_PROVIDER=google` dans `src/config/mapConfig.ts`)

#### Mode Solo Local 100 % autonome (dev / coupure Firebase)

Dans `.env` à la racine :

```bash
EXPO_PUBLIC_LOCAL_MODE=true
EXPO_PUBLIC_GEMINI_API_KEY=<clé Google AI Studio>
# EXPO_PUBLIC_GEMINI_MODEL=gemini-2.0-flash   # optionnel
```

- Firebase (Auth, Firestore, proxy Functions) est contourné.
- Gemini appelle directement `generativelanguage.googleapis.com`.
- Profil, quotas Sentinel et tier Pro restent sur SQLite + AsyncStorage.
- **Ne jamais** embarquer `EXPO_PUBLIC_GEMINI_API_KEY` dans un build store.

Relancer : `npx expo start -c`

#### Réactiver Firebase (prompt agent)

Copier-coller ce prompt dans Cursor pour rebasculer sur le proxy :

```
Réactive le mode Firebase production pour TalkNDone / Trankil v34 :
1. Dans `.env`, supprime ou mets `EXPO_PUBLIC_LOCAL_MODE=false`, restaure toutes les variables `EXPO_PUBLIC_FIREBASE_*` et `EXPO_PUBLIC_GEMINI_PROXY_URL`.
2. Supprime `EXPO_PUBLIC_GEMINI_API_KEY` du `.env` (clé dev uniquement).
3. Vérifie que `firebase deploy --only functions` a bien `geminiProxyStream` actif (minInstances selon besoin latence).
4. Lance `npx expo start -c` et confirme dans les logs : Firebase initialisé, appels Gemini via proxy (pas `[GEMINI-LOCAL]`).
5. Valide ProfileSyncBootstrap (sync Firestore) et un appel OneTap Gemini en ligne.
```

### Lancer l’app

```bash
npm run start
```

### Android (APK debug)

Voir : [MODELS_ROUTING_STRATEGY.md](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/docs/MODELS_ROUTING_STRATEGY.md) → “Guide de Compilation Android (Debug)”.

#### Debug friendly — modale « économiseur de batterie »

Au premier lancement Android, l’app peut ouvrir la modale système d’exclusion de l’optimisation batterie (`PermissionService`). Le choix est mémorisé en local (`@trankil_battery_permission_requested` dans AsyncStorage) pour ne plus harceler l’utilisateur — ni à chaque Fast Refresh en dev.

Pour **retester** la modale sur un téléphone : onglet **Debug** → section **Système** → **Réinitialiser la demande batterie Android** (équivalent à `AsyncStorage.removeItem('@trankil_battery_permission_requested')` puis relance de l’intent).

### OneTap (contrat stabilité)

Voir : [STABILITY_SPEC_ONETAP_GEMINI.md](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/docs/STABILITY_SPEC_ONETAP_GEMINI.md).

## Gemini

### Proxy sécurisé (défaut)

La clé Gemini n’est jamais dans l’app. Le client appelle un proxy (Functions Gen2 / Cloud Run) avec un Firebase ID token, et le proxy détient `GEMINI_API_KEY` via Secret Manager.

Routeur : [`src/services/geminiDirectClient.ts`](src/services/geminiDirectClient.ts) (`executeGeminiCall`).

Voir : [MODELS_ROUTING_STRATEGY.md](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/docs/MODELS_ROUTING_STRATEGY.md) → “Sécurité & APIs”.

### Mode local (`EXPO_PUBLIC_LOCAL_MODE=true`)

Même routeur, branche directe Google AI Studio — voir section variables ci-dessus.
