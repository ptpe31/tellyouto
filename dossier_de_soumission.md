# Dossier de soumission — Trankil / TalknDone

Textes prêts à copier-coller pour les formulaires **Apple App Store Connect** et **Google Play Console**.

---

## 1. Localisation en arrière-plan (Background Location)

### Apple — `NSLocationAlwaysAndWhenInUseUsageDescription` / justification « Always »

> L’application surveille le trafic en temps réel pour optimiser l’horaire de départ vers vos rendez-vous. La position est utilisée uniquement pendant une mission trajet active (option « Me prévenir quand partir ») afin d’estimer le temps de route, recalibrer la fenêtre de départ de 15 minutes et vous proposer un créneau de départ réaliste. Aucune position n’est vendue ni partagée à des tiers ; les calculs de fenêtre et de ratio de dégradation restent sur l’appareil.

### Apple — `NSLocationWhenInUseUsageDescription` (complément)

> La position au premier plan permet d’initialiser la surveillance Sentinel (sonde trafic) et d’afficher la capsule de départ avec une estimation cohérente.

### Google Play — Déclaration « Localisation en arrière-plan »

**Pourquoi l’app a-t-elle besoin de la localisation en arrière-plan ?**

> Surveillance du trafic en temps réel pour optimiser l’horaire de départ. Lorsqu’une intention trajet est active, Trankil utilise la position pour mettre à jour localement la durée prévue, le ratio de congestion (D) et la fenêtre élastique de départ (créneau 15 min), sans envoyer l’historique de déplacements à un serveur de tracking.

**Fonctionnalité visible pour l’utilisateur :**

> Capsule de départ (barre de progression avec heures de début/fin), notification persistante silencieuse pendant le calcul, signal sonore unique au moment du départ recommandé.

**Données collectées :**

> Coordonnées GPS ponctuelles pendant la mission active uniquement ; pas de revente, pas de profilage publicitaire.

---

## 2. Notifications sensibles au temps (Time-Sensitive) — iOS

### Apple — Capacité « Time Sensitive Notifications »

**Justification :**

> L’alerte de départ est critique pour l’utilisateur : elle signale le début de la fenêtre où il doit quitter pour arriver à l’heure malgré le trafic. Sans priorité time-sensitive, l’utilisateur pourrait manquer son créneau en mode Focus / résumé de notifications. Un seul signal sonore est émis au début de fenêtre (Signal A) ; les mises à jour pendant les sondes trafic (probes) restent silencieuses.

**Comportement :**

| Type | Son | Priorité |
|------|-----|----------|
| Mise à jour sticky (probes / recalcul) | Non | Standard / minimale |
| Signal A — Départ (`startMs`) | Oui | Time-Sensitive (iOS), HIGH (Android) |
| Signal B — Rappel (`endMs − offset`) | Non (sauf réglage futur) | HIGH visuelle, pas time-sensitive |

---

## 3. Notifications — Android (canaux & priorité)

### Google Play — « Notifications » / canaux personnalisés

**Canal « Contrat de départ (suivi) »** — importance MIN, sans son :

> Mise à jour unique de la capsule Unicode `[🟢 20:53 ———◉———— 21:08]` pendant la surveillance. Aucun son pendant les phases de calcul (probes).

**Canal « Contrat de départ (signaux) »** — importance HIGH :

> Alerte de départ critique : un signal sonore unique au début de la fenêtre recommandée. Rappel optionnel avant la fin de fenêtre (sans son par défaut, pour respecter l’UX « Zen »).

---

## 4. Confidentialité et traitement des données

### Apple — App Privacy / Nutrition Labels

> Les données de calcul du contrat de départ (durée idéale, durée prédite, ratio D, ancres `elastic_anchor_start_ms` / `elastic_anchor_end_ms`) sont stockées localement (SQLite sur l’appareil). Les appels cartographie (Distance Matrix) n’envoient que origine/destination et horaire de départ demandé au fournisseur de cartes ; Trankil ne conserve pas d’historique de trajets sur un cloud propriétaire pour cette fonctionnalité.

### Google Play — Sécurité des données

**Les données sont-elles chiffrées en transit ?** Oui (HTTPS vers API cartes).

**L’utilisateur peut-il demander la suppression ?** Oui — suppression de l’intention / reset usine efface les métadonnées trajet locales.

**Résumé court (politique de confidentialité) :**

> Trankil calcule vos fenêtres de départ sur l’appareil. La localisation sert uniquement à affiner l’estimation de trajet active ; nous ne revendons pas vos déplacements.

---

## 5. Texte court « Notes pour l’évaluateur » (Review Notes)

> Pour tester la surveillance trajet : créer une intention TRIP avec adresse d’arrivée, activer « Me prévenir quand partir » (compte Pro / Sentinel), attendre la PROBE1 (~1 min). La capsule apparaît dans la fiche intention et une notification silencieuse se met à jour. Au créneau de départ, une notification time-sensitive avec son se déclenche. Appuyer sur « Navigation » annule les signaux planifiés (`clearAllDepartureNotifications`). Préférence rappel : clé locale `departure_safety_reminder_offset_min` (minutes avant fin de fenêtre, défaut 5).

---

## 6. Champs Info.plist recommandés (iOS)

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>La position est utilisée pour estimer le temps de trajet et afficher une fenêtre de départ sereine.</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Surveillance du trafic en temps réel pour optimiser l'horaire de départ vers vos rendez-vous.</string>
```

Activer dans Xcode / `app.json` : **Background Modes → Location updates**, **Push Notifications**, **Time Sensitive Notifications**.

---

*Document généré pour la branche Contrat de Départ — moteur `NotificationService.ts` + `formatDepartureCapsule.ts`.*
