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

Définir au minimum :

- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `EXPO_PUBLIC_FIREBASE_APP_ID`

Clés / APIs :

- `EXPO_PUBLIC_GEMINI_PROXY_URL` (URL Cloud Run du proxy Gemini, ex. `https://geminiproxystream-xxxx-ew.a.run.app`)
- `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` (Google Places côté client, restreinte par Bundle ID / Package Name + API restrictions)

### Lancer l’app

```bash
npm run start
```

### Android (APK debug)

Voir : [MODELS_ROUTING_STRATEGY.md](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/docs/MODELS_ROUTING_STRATEGY.md) → “Guide de Compilation Android (Debug)”.

## Gemini (Proxy sécurisé)

La clé Gemini n’est jamais dans l’app. Le client appelle un proxy (Functions Gen2 / Cloud Run) avec un Firebase ID token, et le proxy détient `GEMINI_API_KEY` via Secret Manager.

Voir : [MODELS_ROUTING_STRATEGY.md](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/docs/MODELS_ROUTING_STRATEGY.md) → “Sécurité & APIs”.

