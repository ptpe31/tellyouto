# STABILITY SPEC — OneTap (Gemini)

Ce document est le contrat de fer de stabilité/performance pour Trankil-v2 sur le flux OneTap (Gemini) et les fichiers :
- [oneTapUniversalCapture.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapUniversalCapture.ts)
- [geminiSemanticLab.ts](file:///Users/lala/Dev/trankil-v3/Dev/trankil-v34/src/services/geminiSemanticLab.ts)

Avant toute modification sur l’un de ces fichiers, vérifier la conformité avec les 5 points ci-dessous.

## 1) Output Format & Parsing Integrity

### Unique Output Format
Le modèle Gemini MUST exclusivement répondre en Bullet‑Pipe :

> TYPE | CONTENT | CATEGORY_CODE | DUE_DATE **

### Zero‑Footprint Parsing
Le parser applicatif MUST uniquement lire les blocs clôturés par `**` dont le contenu commence par `>`.
Tout autre output du modèle (JSON, Markdown, prose) est strictement interdit et ne doit jamais être parsé.

### Latency Target
Le traitement MUST rester sous 3 secondes.
Tout changement architectural augmentant la latence au-delà de ce seuil doit être revert.

## 2) Language Fidelity: Zero Translation Policy

### Mirroring Rule
`CONTENT` MUST être une copie verbatim de la dictée utilisateur (nettoyée des “uhm/ah” mais jamais traduite).

### Dynamic Lang Injection
Le paramètre `lang` dans le prompt MUST provenir de la détection sur transcript (`lang2`) et ne doit jamais être hardcodé depuis `uiLocale`.

### Bilingual Examples
Les exemples du prompt MUST matcher la langue détectée (`lang2`).
Si `lang2=en`, les exemples MUST être en anglais.

## 3) Newton Logistics: TRIP Determinism

### Priority Rule
Toute mention de mouvement, de lieu, ou de verbes de déplacement force `TYPE=TRIP` et `logisticsPotential=true`.

### Heuristic Alignment
Le Path A (local) et le Path B (Gemini) MUST partager le même dictionnaire de triggers (Single Source of Truth).

## 4) Category Standardization

### Immutable Codes
Utiliser uniquement ces 10 codes (uppercase) :
HOME, WORK, PERSO, HEALTH, FINANCE, TRAVEL, SOCIAL, SHOP, LEARN, OTHER

### No Text Hardcoding
Aucun libellé métier de catégorie (“Courses”, “Work”, etc.) ne doit être hardcodé côté logique métier.
La traduction est gérée uniquement au niveau UI via des clés i18n.

## 5) Debug & Observability

### Verbose Logging
Les logs GeminiDebug (Prompt params, Raw Output, Timing) MUST rester dans le code mais être gated par `VERBOSE_DEBUG` (off par défaut en production).

### Latency Monitoring
Chaque appel doit logguer `network_ms` et `parsing_ms` pour le suivi de performance en continu.

## Checklist (avant tout changement)
- Output Gemini strictement Bullet‑Pipe (lignes `>` uniquement)
- Parser ne parse rien d’autre que les lignes `>`
- `lang` dérivé du transcript (lang2), pas de dépendance à `uiLocale`
- TRIP déterministe + triggers alignés Path A / Path B
- Catégories limitées aux 10 codes immuables
- Logs verbose derrière `VERBOSE_DEBUG` + `network_ms` et `parsing_ms` loggés
