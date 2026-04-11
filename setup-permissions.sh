#!/usr/bin/env bash
# IAM + APIs GCP pour tellmeto-4f3c7 (Gen2 / europe-west9).
# Usage : chmod +x setup-permissions.sh && ./setup-permissions.sh
set -euo pipefail

PROJECT_ID="${GCLOUD_PROJECT:-tellmeto-4f3c7}"
PROJECT_NUMBER="${GCP_PROJECT_NUMBER:-$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')}"

echo "==> Projet : $PROJECT_ID (numéro : $PROJECT_NUMBER)"

echo "==> (a) Activation des services API"
gcloud services enable \
  firestore.googleapis.com \
  cloudfunctions.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com \
  iam.googleapis.com \
  eventarc.googleapis.com \
  --project="$PROJECT_ID"

echo "==> (b) IAM — roles/datastore.user (compte Compute par défaut, exécution Cloud Run / Functions Gen2)"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/datastore.user" \
  || true

echo "==> (b) IAM — roles/eventarc.eventReceiver (agent Artifact Registry → Eventarc)"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-artifactregistry.iam.gserviceaccount.com" \
  --role="roles/eventarc.eventReceiver" \
  || true

echo "==> Terminé. Vérifie : gcloud projects get-iam-policy $PROJECT_ID --flatten=bindings[].members --filter=bindings.role:roles/datastore.user"
