# Models Routing Strategy (Gemini)

Ce document décrit la stratégie de routage (sélection + fallback) utilisée par l’app pour les appels Gemini (REST `generateContent` / `streamGenerateContent`) et comment la répliquer dans des scripts (ex: Cloud Functions Firebase).

Source de vérité côté code :
- [geminiSemanticLab.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts)
- [oneTapUniversalCapture.ts](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapUniversalCapture.ts)

## 1) Hiérarchie des modèles

### Choix par défaut (OneTap / `oneTap.wire.*`)

La route OneTap utilise une shortlist fixe (dans `postGenerateContent`) :
- 1) `gemini-flash-latest`
- 2) `gemini-pro-latest`

Raison :
- `gemini-flash-latest` : meilleur compromis latence / coût pour une extraction structurée “bullet-pipe” (format strict, faible créativité).
- `gemini-pro-latest` : repli quand Flash est indisponible (503) ou temporairement instable, avec une tolérance souvent meilleure sur des prompts longs ou multi-intentions.

### Fallback local (Path A)

OneTap est un flux “dual-path” :
- **Path A (local)** : construit un squelette déterministe à partir de la transcription (type prédit, dates, drapeaux, etc.)
- **Path B (Gemini)** : affine/structure la sortie via Gemini (format filaire / bullet-pipe) et fusionne dans le squelette Path A.

En cas d’échec Gemini, la modale et l’enregistrement peuvent continuer sur Path A. Les logs d’erreur Gemini incluent alors un snapshot Path A :
- `PathA_Fallback_Category`
- `PathA_Entities`

Voir : [refineOneTapWithGeminiCompressed](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/oneTapUniversalCapture.ts#L1025-L1099)

## 2) Gestion des erreurs API (503 / 400 / 404)

Le cœur du routage est dans `postGenerateContent` :
- tente un modèle
- si erreur, applique des règles
- tente le suivant
- optionnellement exécute une passe de “self-healing” via `models.list`

### 503 UNAVAILABLE (surcharge / high demand)

Détection :
- `isModelTemporarilyUnavailable(status) => status === 503`

Comportement :
- le modèle courant est exclu pour la session (`excludeGeminiModelForSession(modelId)`)
- le routage continue sur le prochain modèle candidat

Objectif :
- éviter de “marteler” un modèle surchargé (spikes temporaires)
- basculer immédiatement sur un modèle capable de répondre

### 404 / 400 “model not supported” (ID invalide / modèle non dispo pour la clé)

Détection :
- `isModelNotSupported(status, bodyText)`
- 404 => true
- 400 => true si le texte ressemble à `model not found` / `unsupported`

Comportement :
- on continue sur le candidat suivant
- si tous les candidats échouent pour cause “not supported”, on tente une récupération via `models.list` :
  - `recoverGeminiModelViaListModelsExcluding(usedModels)`
  - et on réessaie **une fois** avec un modèle découvert

Spécificité OneTap :
- lors de cette récupération, OneTap ignore les modèles `tts-preview` (incompatibles avec un flux texte “bullet-pipe”).

### 400 INVALID_ARGUMENT (payload invalide)

Cas observé :
- `gemini-pro-latest` rejette `thinkingConfig.thinkingLevel = "minimal"` avec :
  - `Thinking level MINIMAL is not supported for this model`

Comportement actuel (OneTap) :
- on “nettoie” le payload pour les modèles `*pro*` en supprimant `generationConfig.thinkingConfig` avant l’appel réseau, ce qui évite l’erreur 400.

## 3) Nettoyage du payload (Flash → Pro)

### Max tokens (OneTap)

Pour OneTap, on force un minimum de sortie :
- `enforceOneTapMaxOutputTokens` garantit `maxOutputTokens >= 2048`

Pourquoi :
- éviter des sorties tronquées
- stabiliser le parsing (format multi-lignes bullet-pipe)

Voir : [enforceOneTapMaxOutputTokens](file:///Users/lala/Dev/trankil-v3/Dev-trankil-v34/src/services/geminiSemanticLab.ts#L236-L253)

### Thinking config

Pour OneTap, on peut piloter le “thinking” via une variable d’environnement :
- `EXPO_PUBLIC_ONETAP_THINKING_LEVEL`
- valeur par défaut : `minimal`

Nettoyage appliqué :
- si le modèle ciblé ressemble à un modèle **Pro** (`/\\bpro\\b/i`) :
  - suppression de `generationConfig.thinkingConfig` du payload

Pourquoi :
- certains modèles Pro ne supportent pas encore `thinkingLevel="minimal"` → 400 INVALID_ARGUMENT.

Implémentation : dans `postGenerateContent.runOnce`, avant `fetch`, on construit `payload` :
- `effectiveBody` (base)
- puis `payload = effectiveBody` **sans** `generationConfig.thinkingConfig` si modèle Pro.

## 4) Exemple TypeScript portable (Firebase Cloud Function)

L’extrait ci-dessous reprend la structure du retry OneTap de manière autonome.

```ts
type GeminiResponse = unknown;

type CallResult = { ok: boolean; status: number; text: string; latencyMs: number; modelId: string };

function is503(status: number) {
  return status === 503;
}

function looksUnsupportedModel(status: number, bodyText: string) {
  if (status === 404) return true;
  if (status !== 400) return false;
  const t = bodyText.toLowerCase();
  return t.includes('not found') || t.includes('not supported') || t.includes('unsupported') || t.includes('unknown model');
}

function stripThinkingConfigIfPro(modelId: string, body: any) {
  const isProModel = /\bpro\b/i.test(modelId);
  if (!isProModel) return body;
  const gc = body?.generationConfig ?? {};
  if (!gc.thinkingConfig) return body;
  const { thinkingConfig: _omit, ...rest } = gc;
  return { ...body, generationConfig: rest };
}

async function runOnce(urlForModel: (m: string) => string, modelId: string, body: any): Promise<CallResult> {
  const t0 = Date.now();
  const res = await fetch(urlForModel(modelId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(stripThinkingConfigIfPro(modelId, body)),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, latencyMs: Date.now() - t0, modelId };
}

export async function geminiGenerateOneTapWithFallback(params: {
  urlForModel: (m: string) => string;
  body: any; // { contents: [...], generationConfig?: {...} }
  listModels?: () => Promise<string[]>; // optionnel: models.list
}): Promise<GeminiResponse> {
  const candidates = ['gemini-flash-latest', 'gemini-pro-latest'];
  const used: string[] = [];

  let last: CallResult | null = null;
  for (const modelId of candidates) {
    const r = await runOnce(params.urlForModel, modelId, params.body);
    used.push(modelId);
    last = r;
    if (r.ok) return JSON.parse(r.text);

    if (is503(r.status)) {
      continue; // try next candidate
    }

    if (looksUnsupportedModel(r.status, r.text)) {
      continue; // try next candidate
    }

    break; // other errors: stop retrying
  }

  // Optional “self-heal” via models.list, excluding already tried
  if (params.listModels) {
    const inventory = await params.listModels();
    const pick = inventory.find((m) => !used.includes(m) && !/tts-preview/i.test(m));
    if (pick) {
      const r = await runOnce(params.urlForModel, pick, params.body);
      if (r.ok) return JSON.parse(r.text);
      last = r;
    }
  }

  throw new Error(`Gemini failed: ${last?.status} ${last?.text?.slice(0, 300)}`);
}
```

### Notes de portage Firebase

- Sur Cloud Functions, remplace `fetch` par `global.fetch` (Node 18+) ou `undici`.
- Implémente `listModels()` en appelant `GET https://generativelanguage.googleapis.com/v1beta/models?key=...` et en extrayant `name` (en retirant le préfixe `models/` si besoin).
- Loggue systématiquement `{ modelId, status, latencyMs }` pour diagnostiquer les comportements transitoires (503).

