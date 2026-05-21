# Dossier de soumission — Trankil / TalknDone

Textes prêts à copier-coller pour les formulaires **Apple App Store Connect** et **Google Play Console**.

**Implémentation de référence :** `src/services/NotificationService.ts` (point d’entrée unique des notifications trajet).

---

## 1. Localisation en arrière-plan (Background Location)

### Apple — `NSLocationAlwaysAndWhenInUseUsageDescription` / justification « Always »

> L’application surveille le trafic en temps réel pour optimiser l’horaire de départ vers vos rendez-vous. La position est utilisée uniquement pendant une mission trajet active (option « Me prévenir quand partir ») afin d’estimer le temps de route, recalibrer la fenêtre de départ de 15 minutes et vous proposer un créneau de départ réaliste. Aucune position n’est vendue ni partagée à des tiers ; les calculs de fenêtre et de ratio de dégradation restent sur l’appareil.

**Note interne (Always vs When In Use) :** nous utilisons « Always » car l’application doit pouvoir recalibrer la fenêtre de départ lorsque l’utilisateur verrouille son téléphone. Avec « When In Use » seul, la surveillance s’interrompt à l’extinction de l’écran, ce qui rend le contrat de départ inopérant.

### Apple — `NSLocationWhenInUseUsageDescription` (complément)

> La position au premier plan permet d’initialiser la surveillance Sentinel (sonde trafic) et d’afficher la capsule de départ avec une estimation cohérente.

### Google Play — Déclaration « Localisation en arrière-plan »

**Pourquoi l’app a-t-elle besoin de la localisation en arrière-plan ?**

> Surveillance du trafic en temps réel pour optimiser l’horaire de départ. Lorsqu’une intention trajet est active, Trankil utilise la position pour mettre à jour localement la durée prévue, le ratio de congestion (D) et la fenêtre élastique de départ (créneau 15 min), sans envoyer l’historique de déplacements à un serveur de tracking.

**Fonctionnalité visible pour l’utilisateur :**

> Capsule de départ (barre de progression avec heures de début/fin), notification persistante silencieuse pendant la surveillance (`departure_sticky_{tripId}`), signal sonore unique au moment du départ recommandé (`departure_signal_a_{tripId}`).

**Données collectées :**

> Coordonnées GPS ponctuelles pendant la mission active uniquement ; pas de revente, pas de profilage publicitaire.

**Configuration native (`app.json`) :** plugin `expo-location` avec `isIosBackgroundLocationEnabled`, `isAndroidBackgroundLocationEnabled`, `isAndroidForegroundServiceEnabled` (Foreground Service localisation sur Android).

---

## 2. Notifications sensibles au temps (Time-Sensitive) — iOS

### Apple — Capacité « Time Sensitive Notifications »

**Justification :**

> L’alerte de départ est critique pour l’utilisateur : elle signale le début de la fenêtre où il doit quitter pour arriver à l’heure malgré le trafic. Sans priorité time-sensitive, l’utilisateur pourrait manquer son créneau en mode Focus / résumé de notifications. Un seul signal sonore est émis au début de fenêtre (Signal A) ; les mises à jour de surveillance (sticky) et les sondes trafic restent silencieuses.

**Comportement (aligné `NotificationService.ts`) :**

| Notification | Identifiant | Son | Priorité iOS | Priorité Android |
|--------------|-------------|-----|--------------|------------------|
| Suivi persistant (Zen) | `departure_sticky_{tripId}` | Non | Standard / passive | Canal `departure_contract_silent` — LOW, ongoing |
| Signal A — Départ (`startMs`) | `departure_signal_a_{tripId}` | Oui | **Time-Sensitive** (`interruptionLevel: 'timeSensitive'`) | Canal `departure_contract_signals` — HIGH |
| Signal B — Rappel (`endMs − offset`) | `departure_signal_b_{tripId}` | Non | Standard | HIGH visuelle, pas time-sensitive |
| Go/No-Go (sonde 3) | `sentinel_gonogo_{tripId}_*` | Oui | Active | Canal signaux — HIGH |
| Estimation indisponible | `sentinel_probe_unavail_{tripId}_*` | Oui | Active | Canal signaux — HIGH |

**Entitlement (`app.json`) :** `com.apple.developer.usernotifications.time-sensitive: true`

---

## 3. Notifications — Android (canaux & priorité)

### Google Play — « Notifications » / canaux personnalisés

Les canaux sont créés au runtime par `NotificationService.ts` avec les **IDs exacts** suivants (à mentionner en cas de question modérateur) :

| ID canal (code) | Nom affiché utilisateur | Importance Android | Rôle |
|-----------------|-------------------------|--------------------|------|
| `departure_contract_silent` | Contrat de départ (suivi) | **LOW** | Notification persistante ongoing — surveillance active |
| `departure_contract_signals` | Contrat de départ (signaux) | **HIGH** | Signal A (départ), Go/No-Go, alertes sonores |

**Canal « Contrat de départ (suivi) » — `departure_contract_silent` (importance LOW) :**

> Notification persistante (Ongoing) indiquant que la surveillance du trafic est active.
>
> - **Configuration technique :** `sticky: true`, `autoDismiss: false` (non-dismissible au swipe ; équivalent Foreground Service / transparence utilisateur).
> - **UX :** importance `AndroidImportance.LOW` — pas de popup ni de son ; visible dans le tiroir notifications (conformité Google Play sur l’activité en arrière-plan).
> - **Identifiant stable :** `departure_sticky_{tripId}`.
> - **Cycle de vie :** supprimée par `clearAllDepartureNotifications(tripId)` à l’arrivée, l’annulation, la navigation GPS ou la fin de mission.

**Canal « Contrat de départ (signaux) » — `departure_contract_signals` (importance HIGH) :**

> Alerte de départ critique : signal sonore au début de la fenêtre recommandée (`departure_signal_a_{tripId}`). Rappel optionnel avant la fin de fenêtre (`departure_signal_b_{tripId}`, silencieux). Alertes Go/No-Go Sentinel (sonde 3).

**Permissions Android (`app.json` + plugin `expo-notifications`) :**

> `POST_NOTIFICATIONS` (API 33+), `RECEIVE_BOOT_COMPLETED`, `SCHEDULE_EXACT_ALARM`, localisation arrière-plan et Foreground Service (via `expo-location`).

**Nettoyage legacy :** `clearAllDepartureNotifications` retire aussi les anciens IDs `sentinel_{tripId}` pour éviter les doublons après migration.

---

## 4. Confidentialité et traitement des données

### Apple — App Privacy / Nutrition Labels

> Les données de calcul du contrat de départ (durée idéale, durée prédite, ratio D, ancres `elastic_anchor_start_ms` / `elastic_anchor_end_ms`) sont stockées localement (SQLite sur l’appareil). Les appels cartographie (Distance Matrix) n’envoient que origine/destination et horaire de départ demandé au fournisseur de cartes ; Trankil ne conserve pas d’historique de trajets sur un cloud propriétaire pour cette fonctionnalité.

### Google Play — Sécurité des données

**Les données sont-elles chiffrées en transit ?** Oui (HTTPS vers API cartes).

**L’utilisateur peut-il demander la suppression ?** Oui — suppression de l’intention / reset usine efface les métadonnées trajet locales et annule toutes les notifications planifiées (`cancelAllLocalScheduledNotifications`).

**Résumé court (politique de confidentialité) :**

> Trankil calcule vos fenêtres de départ sur l’appareil. La localisation sert uniquement à affiner l’estimation de trajet active ; nous ne revendons pas vos déplacements.

---

## 5. Texte court « Notes pour l’évaluateur » (Review Notes)

> Pour tester la surveillance trajet : créer une intention TRIP avec adresse d’arrivée, activer « Me prévenir quand partir » (compte Pro / Sentinel), attendre la PROBE1 (~1 min). La capsule apparaît dans la fiche intention et une notification silencieuse ongoing se met à jour (`departure_sticky_{tripId}`). Au créneau de départ, une notification time-sensitive avec son se déclenche (`departure_signal_a_{tripId}`). Appuyer sur « Navigation » ou « Lancer l’itinéraire » annule les signaux (`clearAllDepartureNotifications`). Préférence rappel : clé locale `departure_safety_reminder_offset_min` (minutes avant fin de fenêtre, défaut 5).

---

## 6. Configuration `app.json` (build natif)

Plugins et modes activés pour la soumission :

| Élément | Valeur |
|---------|--------|
| `expo-notifications` | `defaultChannel: departure_contract_signals`, `enableBackgroundRemoteNotifications: true` |
| `expo-location` | Background location iOS + Android, Foreground Service |
| `ios.infoPlist.UIBackgroundModes` | `location`, `remote-notification`, `fetch`, `processing` |
| `ios.entitlements` | `com.apple.developer.usernotifications.time-sensitive` |
| Android | `POST_NOTIFICATIONS`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` |

**Sons personnalisés (alarmes rail, hors contrat trajet) :** fichiers attendus `rail_alarm.wav`, `rail_alarm_zen.wav`, `rail_alarm_digital.wav` (voir `railAlarmSound.ts`). À placer sous `assets/sounds/` puis ajouter au tableau `sounds` du plugin `expo-notifications` avant le build si ces assets sont fournis. *Aucun fichier `.wav` n’est présent dans le dépôt à ce stade — le build trajet utilise le son système pour le Signal A.*

---

## 7. Notes techniques pour le modérateur

> **Surveillance transparente (Android — système « Zen »)**  
> Pendant une mission trajet active, une notification **ongoing** (`sticky: true`, `autoDismiss: false`) est affichée sur le canal `departure_contract_silent` (importance **LOW**). Elle n’est pas dismissible par swipe : cela garantit la transparence de l’activité de surveillance en arrière-plan, conformément aux attentes Google Play pour les apps qui continuent à travailler hors premier plan. Elle ne produit ni son ni tête de notification intrusive.

> **Alerte de départ (iOS — Time Sensitive)**  
> Le **son** et la priorité **Time Sensitive** ne s’appliquent qu’à l’alerte de départ programmée (`departure_signal_a_{tripId}`, début de fenêtre `startMs`). Toutes les autres mises à jour de l’état de surveillance (recalcul trafic, capsule, sondes) passent par la notification ongoing **silencieuse** ou des alertes ponctuelles sans time-sensitive (Signal B, Go/No-Go selon le cas).

> **Point d’entrée code**  
> Toute notification trajet (Sentinel V4, contrat de départ, signaux) est centralisée dans `NotificationService.ts`. Les identifiants legacy `sentinel_{tripId}` sont purgés automatiquement pour éviter les doublons.

> **Pas de push serveur pour le contrat de départ**  
> Les notifications trajet sont **locales** (planification sur l’appareil via `expo-notifications`). Aucun FCM/APNs distant n’est requis pour cette fonctionnalité. `remote-notification` dans `UIBackgroundModes` prépare l’infrastructure pour d’éventuelles notifications push futures.

---

## 8. Table de cohérence code ↔ documentation

| Document (ce fichier) | Constante / fonction `NotificationService.ts` |
|----------------------|-----------------------------------------------|
| Canal suivi LOW | `DEPARTURE_STICKY_CHANNEL_ID` = `departure_contract_silent` |
| Canal signaux HIGH | `DEPARTURE_SIGNAL_CHANNEL_ID` = `departure_contract_signals` |
| Sticky ongoing | `buildOngoingSurveillanceContent` + `departureStickyIdentifier()` |
| Signal départ | `departureSignalAIdentifier()` + `interruptionLevel: 'timeSensitive'` (iOS) |
| Annulation | `clearAllDepartureNotifications()` (+ legacy `sentinel_*`) |
| Sync contrat | `syncDepartureContractForIntention()` |
| Sentinel sticky / Go/No-Go | `updateTripStickyFromSentinel`, `sendTripGoNoGoNotification`, `sendTripProbeUnavailableNotification` |

---

*Document aligné sur `NotificationService.ts`, `formatDepartureCapsule.ts` et `app.json` (plugins `expo-notifications`, `expo-location`).*
