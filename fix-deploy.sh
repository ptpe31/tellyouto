#!/usr/bin/env bash
# Déploiement progressif Cloud Functions Gen2 — tellmeto-4f3c7 / europe-west9
# Usage : depuis la racine du dépôt —  chmod +x fix-deploy.sh && ./fix-deploy.sh
set -euo pipefail

PROJECT_ID="${GCLOUD_PROJECT:-tellmeto-4f3c7}"
REGION="${FN_REGION:-europe-west9}"
# Numéro de projet (IAM Eventarc) — obtenir avec : firebase projects:list  ou  gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)'
PROJECT_NUMBER="${GCP_PROJECT_NUMBER:-814759010315}"

echo "==> Projet : $PROJECT_ID  |  Région cible fonctions : $REGION"

echo "==> Activation des APIs GCP (idempotent)"
gcloud services enable \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  eventarc.googleapis.com \
  pubsub.googleapis.com \
  storage.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  cloudscheduler.googleapis.com \
  firebaseextensions.googleapis.com \
  secretmanager.googleapis.com \
  logging.googleapis.com \
  --project="$PROJECT_ID"

echo "==> Liaison IAM recommandée — Artifact Registry → Eventarc (évite erreurs Eventarc au déploiement)"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-artifactregistry.iam.gserviceaccount.com" \
  --role='roles/eventarc.eventReceiver' \
  2>/dev/null || true

echo "==> Build functions (TypeScript)"
npm --prefix functions run build

FUNCS=(
  helloWorld
  botWebhook
  telegramWebhook
  disconnectMessenger
  scheduleProactiveReminders
  purgeStaleTransitData
  onRailInboxMarkedProcessed
  onDeviceIntentionTransitProcessed
)

echo "==> Déploiement fonction par fonction (pause 8s entre chaque)"
for fn in "${FUNCS[@]}"; do
  echo "--- deploy functions:${fn} ---"
  firebase deploy --only "functions:${fn}" --project "$PROJECT_ID" || {
    echo "Échec sur ${fn} — voir les logs ci-dessus. Tu peux relancer ce script ; les fonctions déjà OK seront skipped ou mis à jour."
    exit 1
  }
  sleep 8
done

echo "==> Terminé. Vérifie : https://console.firebase.google.com/project/${PROJECT_ID}/functions"
