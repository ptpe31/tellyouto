# ARCHITECT_PHOENIX_V2

## 1) Vision & ADN

Phoenix V2 est une application de capture ultra-rapide (One‑Tap Capture). Elle est pensée comme un “outil de fluidité” : saisir une intention en quelques secondes, puis laisser le système structurer, suggérer et préparer l’action sans imposer de friction.

**Design**
- Esthétique Apple : minimalisme, calme visuel, surfaces propres, animations discrètes.
- Typographie hiérarchisée : priorité à la lisibilité (large title pour le contexte, subheadline pour le détail).
- L’emoji est l’ancre visuelle des intentions (identification instantanée).

**Principe**
- L’IA ne remplace pas l’utilisateur : elle “mâche” le travail logistique et temporel.
- L’utilisateur garde la main via une modale de confirmation (ajustement rapide, validation finale).

## 2) Moteur Sémantique (Gemini)

Phoenix V2 utilise Gemini comme moteur d’extraction sémantique et de génération structurée, avec un contrat JSON strict. L’objectif est la **déterminisme côté app** : l’IA extrait, le code résout.

### 2.1 Deltas temporels (REF_NOW)

**Règle** : l’IA ne calcule jamais de date absolue.

- L’app fournit une `REF_NOW` (ISO UTC) au moment du micro.
- L’IA renvoie une structure temporelle relative (ex. `timeSpec`), et le code résout une date/heure finale.
- Le moteur de résolution doit être déterministe : à `REF_NOW` identique, la sortie est identique.

### 2.2 Logistique prédictive

Extraction systématique des lieux dans un objet obligatoire :

```json
"logistics": {
  "hasLogistics": true,
  "destination": "12 rue de la Paix, Paris",
  "isLocationIncomplete": false
}
```

**Règles**
- `hasLogistics: true` dès qu’un lieu est cité (ville, adresse, lieu connu).
- `destination` est la valeur brute (pas de réécriture).
- `isLocationIncomplete: true` si le lieu n’est pas exploitable tel quel par un GPS (contextuel/vague).

**Effet UI**
- Si `hasLogistics === true` : la modale affiche la ligne “Ajuster le départ selon la circulation”.
- Si `isLocationIncomplete === true` : auto-focus sur l’input Destination + ouverture clavier (auto-complete).

### 2.3 Smart-Scaling (listes éphémères)

Objectif : l’IA génère une base **unitaire** et le code multiplie dynamiquement.

```json
"smartScaling": {
  "pivotValue": 5,
  "unitLabel": "jour",
  "items": [
    { "t": "Caleçons", "qty": 1, "isScalable": true },
    { "t": "Manteau", "qty": 1, "isScalable": false }
  ]
}
```

**Règles**
- Détection d’un pivot (jours/personnes/semaines…).
- `qty` est toujours la quantité pour **1 unité**.
- `isScalable` indique si `qty` suit le pivot.

**Calcul UI**
- `displayQty = item.isScalable ? (item.qty * pivotValue) : item.qty`

## 3) Architecture technique

### 3.1 Stratégie de persistance (silencieuse)

Objectif : feedback immédiat sans navigation.

- Dès que Gemini renvoie un résultat (même “squelette”), insertion en SQLite en **DRAFT**.
- La modale reste ouverte au-dessus de l’écran courant pour ajustements.
- À la confirmation : passage en **VALIDATED** et écriture finale en base.

Feedback attendu
- Haptique success/light au moment de l’insertion.
- Animation d’insertion (style Apple) dans la liste (Timeline) quand l’utilisateur est déjà sur la page.
- Si la Timeline n’est pas l’onglet actif : animation “spring/bounce” sur l’icône + red dot (si applicable).

### 3.2 i18n dynamique

Objectif : supprimer le choix de langue à l’onboarding.

- Détection `lang` par Gemini au premier micro.
- Le titre raffiné doit être strictement dans la langue détectée (pas de traduction forcée).
- Master UI : 8 langues.
- Si `lang` n’est pas dans le Master :
  - appel IA unique pour traduire tout le dictionnaire UI,
  - cache local (persistant),
  - pas de recalcul à chaque lancement.

### 3.3 Billing (zéro latence)

Objectif : tracking de consommation sans impacter l’UX.

- Mesure / estimation tokens côté client.
- Envoi asynchrone vers Firebase (best-effort).
- Aucune dépendance UI sur le retour réseau.

## 4) Business logic

Phoenix V2 supporte des quotas distincts : micro vs trajets.

- **Free**
  - 3 micros / jour
  - fonctions de base
- **Premium**
  - micros illimités
  - 2 trajets inclus (life-time ou mensuel selon l’offre)
- **Pack Trajet**
  - circulation illimitée (bouton “Ajuster selon la circulation” toujours disponible)

**Règles UX**
- Si Free et quota micro atteint : bloquer l’appel Gemini et proposer l’upgrade.
- Si `hasLogistics === true` :
  - Pack Trajet actif : bouton circulation normal.
  - Crédit(s) restant(s) : bouton normal avec mention `({n} restants)`.
  - Aucun crédit : bouton grisé/badge “Acheter le Pack Trajet”.

