# Nettoyage code mort — registre global

Document de travail pour la suppression définitive du code commenté / stubé dans `src/`, `App.tsx`, et modules liés.  
**Dernière mise à jour :** juin 2026 — registre Sentinel Focus Badge (code actif, hors périmètre suppression).

---

## Table des matières

1. [Légende](#légende)
2. [Notifications trajet & façade](#6-notifications-trajet--façade)
3. [Rituel des étoiles](#8-rituel-des-étoiles-eveningstar)
4. [Queue capture BackgroundFetch](#9-queue-capture-backgroundfetch)
5. [Stratégies capture pré-OneTap](#10-stratégies-capture-pré-onetap)
6. [Alarmes debug & intentions V2](#11-alarmes-debug--intentions-v2)
7. [TrafficScheduler debug](#12-trafficscheduler-legacy-debug)
8. [Focus Protection](#13-focus-protection-context)
9. [Nudge « 2 minutes disponibles »](#1-modale-2-minutes-disponibles-availability-nudge)
10. [Sentinel Focus Badge — ne pas supprimer](#16-sentinel-focus-badge--code-actif-juin-2026)
11. [Checklist suppression](#14-checklist-suppression-définitive)
12. [Commandes `rg`](#15-commandes-utiles)

---

## Légende

| Statut | Signification |
|--------|----------------|
| **RETIRÉ** | Plus monté dans l’UI ou plus appelé ; stub / no-op actif |
| **COMMENTÉ** | Implémentation conservée en bloc commentaire dans le fichier source |
| **FAÇADE** | Fichier conservé pour compat imports ; délègue au chemin actif |
| **DEBUG SEUL** | Encore utilisé depuis `DebugScreen` uniquement |
| **À SUPPRIMER** | Fichier ou symbole supprimable après validation |

---

## 1. Modale « 2 minutes disponibles » (Availability Nudge)

### Résumé produit

- **Type :** modale in-app (pas une notification OS).
- **Déclenchement :** 20 min sans interaction, cooldown 30 min, poll toutes les 60 s.
- **Texte :** `STRINGS.nudges` — « 2 minutes disponibles ? » / victoire douce.
- **Actions :** marquer une TASK done + bonus (`BonusEngine.triggerOptimalBonus`).

### Fichiers impactés

| Fichier | État actuel | Action ultérieure |
|---------|-------------|-------------------|
| `App.tsx` | Import + `<AvailabilityNudgeModal />` + `recordAppInteraction` **commentés** | Supprimer les lignes commentées |
| `src/components/AvailabilityNudgeModal.tsx` | **Stub** `return null` + implémentation en bloc commentaire | Supprimer le fichier entier |
| `src/services/AvailabilityTimer.ts` | **Stubs no-op** + implémentation commentée | Supprimer le fichier ou garder `clearAvailabilityTimerKeys()` seul |
| `src/constants/Strings.ts` | Bloc `nudges` **commenté** | Supprimer le bloc |
| `src/constants/Strings.ts` | `errors.availabilityApplyFailed` commenté | Supprimer la ligne |

### Réactivation (debug)

1. Décommenter `App.tsx` : import modale, `onTouchStart` → `recordAppInteraction`, `<AvailabilityNudgeModal />`.
2. Restaurer `AvailabilityNudgeModal.tsx` depuis le bloc commentaire en bas du fichier.
3. Restaurer `AvailabilityTimer.ts` depuis le bloc commentaire.
4. Décommenter `STRINGS.nudges` et exports `api/index.ts`.
5. Restaurer fonctions dans `BonusEngine.ts` (§4) et `trankilV2Db.ts` (§3).

### Clés AsyncStorage orphelines

```
trankil.availability.activity_start_ts
trankil.availability.last_interaction_ts
trankil.availability.last_nudge_ts
```

Purge manuelle : `clearAvailabilityTimerKeys()` dans `AvailabilityTimer.ts`.

---

## 2. `AvailabilityTimer.ts`

| Export | Comportement actuel |
|--------|---------------------|
| `markAppActiveStart` | no-op |
| `recordAppInteraction` | no-op |
| `shouldTriggerAvailabilityNudge` | retourne `false` |
| `markAvailabilityNudged` | no-op |
| `clearAvailabilityTimerKeys` | **actif** — utilitaire debug |
| `AVAILABILITY_TIMEOUT_MS` | constante conservée (référence) |

**À SUPPRIMER :** tout le fichier après confirmation qu’aucun import ne subsiste.

---

## 3. SQLite — `trankilV2Db.ts`

| Fonction | Comportement actuel | Appelants historiques |
|----------|---------------------|------------------------|
| `pickAvailabilityTask()` | retourne `null` | `AvailabilityNudgeModal` uniquement |
| `applyAvailabilityReward()` | stub stats inchangées | **jamais appelé** |

**Exports retirés de `src/api/index.ts` :** `pickAvailabilityTask`, `applyAvailabilityReward` (lignes commentées).

**À SUPPRIMER :** les deux fonctions + blocs commentaires SQL.

---

## 4. `BonusEngine.ts` — chemin « optimal reward »

| Symbole | État | Utilisé par |
|---------|------|-------------|
| `getOptimalReward` | **commenté** | nudge modal (`onLater` / `onDoNow`) |
| `triggerOptimalBonus` | **commenté** | nudge modal |
| `recordBonusReaction` | **commenté** | nudge modal |
| `applyReward` (privé) | **commenté** | `triggerOptimalBonus` |
| `onLocalAiValidated` | **ACTIF** | capture / IA locale |
| `resetLocalStreakOnExpert` | **ACTIF** | passage expert |

**À SUPPRIMER :** bloc commenté § optimal reward.

---

## 5. `Strings.ts` — clés `nudges`

Bloc entier commenté : `availabilityTitle`, `availabilityBody`, `availabilityPrimary`, `availabilitySecondary`, `availabilityMissingTask`, `availabilityToastRescue`, `availabilityToastBoost`.

---

## 6. Notifications trajet & façade

### Chemin production (à conserver)

| Rôle | Fichier |
|------|---------|
| Point d’entrée unique trajet | `src/services/NotificationService.ts` |
| Scheduler prod | `src/services/traffic/TrafficSchedulerV4.ts` (et ticks elastic) |
| Façade Sentinel (délégation) | `src/services/traffic/TrafficNotificationService.ts` |

### Symboles **RETIRÉ** / stubés

| Symbole | Fichier | État | Notes |
|---------|---------|------|-------|
| `notifyExternalIntentionCaptured` | `notifications.ts` | **stub no-op** + bloc commenté | Jamais appelé en prod |
| `notifyChargingEveningPrompt` | `notifications.ts` | **stub no-op** + bloc commenté | Lié rituel soirée retiré |
| Implémentation legacy `sentinel_*` directe | `TrafficNotificationService.ts` | **supprimée** du fichier | Historique : §7 ci-dessous ; fichier = façade uniquement |
| `DEFAULT_NOTIFICATION_SERVICE` méthodes mortes | `TrafficScheduler.ts` | `notifySurveillanceReminder`, `triggerTopDepart` → **no-op** | Reste utilisé par `DebugScreen` pour vigilance / sticky |

### §7 — Archive `SentinelNotificationManager` legacy

Avant centralisation, `TrafficNotificationService.ts` appelait `expo-notifications` avec des ID `sentinel_{tripId}`.  
**Ne pas réactiver** sans passer par `NotificationService` (contrat sticky + catégories unifiées).

---

## 8. Rituel des étoiles (`EveningStar`)

| Élément | État |
|---------|------|
| `App.tsx` | Import + `<EveningStarModal />` **commentés** |
| `EveningStarModal.tsx` | **stub** `return null` ; implémentation d’origine dans git |
| `notifyChargingEveningPrompt` | stub (§6) |

**À SUPPRIMER :** composant + lignes `App.tsx` + stub notification si le rituel ne revient pas.

---

## 9. Queue capture BackgroundFetch

| Symbole | Fichier | État |
|---------|---------|------|
| `enqueueCaptureProcessingJob` | `CaptureProcessingService.ts` | **stub** — jamais appelé |
| `startCaptureProcessingForeground` | idem | **stub** — jamais appelé |
| `configureCaptureBackgroundTask` | idem | **ACTIF** — enregistre la tâche mais queue toujours vide |
| Tâche `TALKNDONE_CAPTURE_PROCESSING_TASK` | idem | Tourne en idle (`NoData`) |

**Flux capture actuel :** OneTap / `IntentionContext` / `oneTapUniversalCapture` — pas cette queue AsyncStorage.

**À SUPPRIMER :** stubs + éventuellement toute la tâche BackgroundFetch si confirmé inutile.

---

## 10. Stratégies capture pré-OneTap

Remplacées par le pipeline OneTap (`IntentionContext`, `src_v2/oneTapPersist`, etc.).

| Fichier | État | Export barrel `captureStrategies/index.ts` |
|---------|------|---------------------------------------------|
| `TaskStrategy.ts` | **stub** `executeTaskCapture` | réexporté (stub) |
| `postCaptureEffects.ts` | **stub** | réexporté (stub) |
| `captureErrorHandler.ts` | **stub** `handleCaptureFlowError` | non exporté |
| `HabitStrategy.ts` | corps intact, bannière DEPRECATED | non exporté |
| `NoteStrategy.ts` | idem | non exporté |
| `ListStrategy.ts` | idem | non exporté |
| `ProjectStrategy.ts` | idem | non exporté |
| `IntentOrchestrator.ts` | **stub** `runIntentOrchestration` | — |

**À SUPPRIMER :** dossier `captureStrategies/` sauf `types.ts` si plus aucun import ; ou restaurer depuis git si TalkDebug revient.

---

## 11. Alarmes debug & intentions V2

| Symbole | Fichier | État |
|---------|---------|------|
| `scheduleDebugAgentDirectAlarmIn10Minutes` | `alarmManager.ts` | **throw** DEPRECATED |
| `scheduleTrankilV2IntentionAlarmById` | `alarmManager.ts` | **stub** (corps dans git) |
| `disableTrankilV2IntentionAlarmById` | `alarmManager.ts` | **stub** |

Appelants historiques : `postCaptureEffects` (stub), écrans Pro / intentions — vérifier avant suppression fichier entier.

---

## 12. TrafficScheduler legacy (debug)

| Élément | État |
|---------|------|
| Classe `TrafficScheduler` | **DEBUG SEUL** — `DebugScreen.tsx` |
| `DEFAULT_NOTIFICATION_SERVICE` | Partiellement actif (vigilance) ; `notifySurveillanceReminder` / `triggerTopDepart` **no-op** |
| Prod | `TrafficSchedulerV4` + `NotificationService` |

**À SUPPRIMER :** uniquement après retrait ou remplacement du panneau debug Sentinel.

---

## 13. Focus Protection context

| Élément | État |
|---------|------|
| `FocusProtectionProvider` | Monté dans l’arbre App |
| `useFocusProtection` | **jamais appelé** hors du provider |

Provider conservé pour extension future ; pas d’effet utilisateur aujourd’hui.

---

## 16. Sentinel Focus Badge — code actif (juin 2026)

> **Ne pas traiter comme code mort.** Composant produit documenté dans **SPEC.md § 8.c** et **PROJECT_STATUS.md**.

| Fichier | Rôle |
|---------|------|
| `src/components/SentinelFocusBadge.tsx` | UI badge flottant (états A/B) |
| `src/hooks/useSentinelFocus.ts` | Hook sélection |
| `src/utils/sentinelFocusSelection.ts` | `pickSentinelFocus`, éligibilité trajet |
| `src/screens/TimelineScreen.tsx` | Item FlatList `sentinelFocus` sous « Aujourd’hui » (EMAIL_HUB) |
| `src/screens/TalkDebugScreen.tsx` | Dock au-dessus du micro |
| `src/locales/fr.json` / `en.json` | Clé `sentinelFocus.prompt` |

**Dépendances actives (à conserver)** : `ElasticDepartureCapsule`, `tripElasticCapsuleModel`, `sentinelElasticTripMetadata`, `tripTripReadiness`, `TripNeumorphicOrb`, `listTrankilV2MergedTodayTimelineWithLowPressure`.

**Recherche** :

```bash
rg "SentinelFocusBadge|pickSentinelFocus|useSentinelFocus|sentinelFocus" src
```

---

## 14. Checklist suppression définitive

```text
[ ] rg "pickAvailabilityTask|AvailabilityNudge|getOptimalReward|STRINGS.nudges" → 0 actif
[ ] rg "notifyExternalIntentionCaptured|notifyChargingEveningPrompt|EveningStarModal" → stubs seuls
[ ] rg "enqueueCaptureProcessingJob|startCaptureProcessingForeground" → stubs seuls
[ ] rg "executeHabitCapture|runIntentOrchestration|handleCaptureFlowError" → 0 import actif
[ ] rg "scheduleTrankilV2IntentionAlarmById|scheduleDebugAgentDirect" → 0 ou throw seul
[ ] Supprimer AvailabilityNudgeModal.tsx, AvailabilityTimer.ts (ou purge clés seule)
[ ] Supprimer stubs trankilV2Db + BonusEngine bloc commenté + Strings nudges
[ ] Supprimer captureStrategies/*.ts sauf types (si OneTap seul)
[ ] Supprimer EveningStarModal + notifyChargingEveningPrompt
[ ] Évaluer suppression CaptureProcessingService (queue vide)
[ ] Évaluer TrafficScheduler.ts après retrait DebugScreen
[ ] Mettre à jour SPEC.md / PROJECT_STATUS.md / dossier_de_soumission.md
[ ] npx tsc --noEmit
```

---

## 15. Commandes utiles

```bash
# Nudge disponibilité
rg "pickAvailabilityTask|applyAvailabilityReward|AvailabilityNudge|shouldTriggerAvailabilityNudge|getOptimalReward|triggerOptimalBonus|STRINGS\.nudges" src App.tsx

# Notifications & rituel
rg "notifyExternalIntentionCaptured|notifyChargingEveningPrompt|EveningStarModal" src App.tsx

# Capture legacy
rg "enqueueCaptureProcessingJob|startCaptureProcessingForeground|executeTaskCapture|runIntentOrchestration|executeHabitCapture" src

# Alarmes
rg "scheduleTrankilV2IntentionAlarmById|scheduleDebugAgentDirect" src

# Focus
rg "useFocusProtection" src

# Typecheck
npx tsc --noEmit
```

---

## Index rapide — fichiers touchés (session nettoyage)

| Fichier | Action |
|---------|--------|
| `notifications.ts` | stubs + commentaires |
| `NotificationService.ts` | **prod — ne pas supprimer** |
| `TrafficNotificationService.ts` | façade seule |
| `TrafficScheduler.ts` | no-op méthodes mortes |
| `CaptureProcessingService.ts` | stubs enqueue / foreground |
| `alarmManager.ts` | stubs / throw debug |
| `EveningStarModal.tsx` | stub |
| `IntentOrchestrator.ts` | stub |
| `captureStrategies/*` | stubs / bannières DEPRECATED |
| `FocusProtectionContext.tsx` | doc DEPRECATED |
| `AvailabilityNudgeModal.tsx` | stub (§1) |
| `App.tsx` | imports commentés (nudge + étoiles) |
| `SentinelFocusBadge.tsx` | **prod — ne pas supprimer** (§16) |
| `useSentinelFocus.ts` | **prod — ne pas supprimer** (§16) |
| `sentinelFocusSelection.ts` | **prod — ne pas supprimer** (§16) |

---

*Notifications trajet en production : `NotificationService.ts` + `TrafficSchedulerV4`. Ce registre ne couvre pas `functions/` (proxy Gemini uniquement, pas de push serveur).*
