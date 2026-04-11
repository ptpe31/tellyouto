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

## Licence

Projet privé — voir les mentions dans l’app (**À propos**).
