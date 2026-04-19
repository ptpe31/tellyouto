# MindFlow : Smart Voice Actions

**MindFlow** transforme la charge mentale en actions claires : tu parles, l’app structure. L’accroche produit est la **libération de la charge mentale** — moins de friction entre l’idée et le geste suivant.

---

## Concept

MindFlow capte la **voix** (ou le texte) et la convertit en intentions concrètes :

- **Tâches** — actions datées, export calendrier / alarmes possibles selon le profil.
- **Habitudes** — récurrence et ancrage dans le rythme personnel.
- **Liste scalable** — inventaires (courses, matériel, valises, contexte pro) structurés par catégories ; chaque ligne porte quantité, unité (`g`, `kg`, `piece`, `cl`, `l`) et un flag **scalable** pour recalculer les totaux quand le multiplicateur change.

Le **Spectre de performance** (Structure, Momentum, Zen, Stats) oriente le co-pilote sans figer l’utilisateur dans un profil unique.

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Mobile | **Expo** + **React Native** (TypeScript) |
| Données locales | **SQLite** (`expo-sqlite`) — offline-first, intentions et stats |
| IA structurante | **Google Gemini** (modèle type **Gemini 1.5 Flash** / Flash côté API — configurable via `EXPO_PUBLIC_GEMINI_MODEL`) |
| Internationalisation | **i18next** (FR, EN, ES, DE, IT, JA, ZH, etc.) |
| Backend optionnel | Firebase (profil, sync, messagerie rail) |

Les alarmes et rappels sensibles reposent sur la **chaîne locale** SQLite → notifications natives, pas sur le cloud pour sonner.

---

## Modèle économique

- **Gratuit (Free)** : quota quotidien de **captures réussies** (notes / audio / tâches / habitudes) et, **séparément**, **une liste inventaire réussie par jour** — les compteurs ne se mélangent pas.
- **Premium (Pro)** : déblocage des usages avancés (ex. **multiplicateur** sur les listes pour adapter instantanément quantités et logistique).
- **Teasing liste** : en Free, l’utilisateur voit la liste, peut cocher les lignes ; les boutons **− / +** du multiplicateur affichent un message d’upgrade Pro au lieu de recalculer.

Les crédits IA (projets, plans) restent distincts des quotas « capture du jour » — voir l’écran Recharge / pass Pro dans l’app.

---

## Installation

```bash
git clone <url-du-depot>
cd Dev-trankil-v3
npm install
```

Variables d’environnement : copier `env.example` vers `.env` à la racine (clés Gemini, Firebase, etc.).

Lancer le bundler :

```bash
npx expo start
```

**Build natif** (obligatoire si tu ajoutes des modules natifs, ex. `@react-native-community/datetimepicker`) :

```bash
npx expo run:ios
# ou
npx expo run:android
```

Pour un **development client** ou un build store, utiliser **EAS Build** (`eas.json`) selon tes profils.

---

## État du projet

Nous sommes sur la **branche produit v3** : refonte de la navigation pilote (Timeline, Talk Home / Debug), intentions type **LIST**, quotas Free dédoublonnés, en-tête de statut crédits / tirelire, et durcissement TypeScript (`skipLibCheck`, exclusions `node_modules` / `.expo` / `dist`).

La documentation **JSDoc** (français, `@param` / `@returns`) est **priorisée** sur les modules critiques (API réexportée, modèle liste, stratégies de capture, hooks applicatifs) et s’étend progressivement au reste de `./src` pour garder des revues lisibles.

---

## Licence et dépôt

Projet **TellYouTo / MindFlow** — voir les fichiers `LICENSE` ou métadonnées du dépôt si présents. Remote GitHub habituel : `origin` sur le dépôt `tellyouto`.
