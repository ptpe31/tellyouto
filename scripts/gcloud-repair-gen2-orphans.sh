#!/usr/bin/env bash
# Réparation ciblée Gen2 (europe-west9) : APIs, jobs Scheduler orphelins, services Cloud Run, redeploy.
# Prérequis : gcloud auth login, firebase login, projet Blaze.
# Usage : depuis la racine du dépôt — chmod +x scripts/gcloud-repair-gen2-orphans.sh && ./scripts/gcloud-repair-gen2-orphans.sh
set -euo pipefail

PROJECT_ID="${GCLOUD_PROJECT:-tellmeto-4f3c7}"
REGION="${FN_REGION:-europe-west9}"

echo "==> (a) Activation explicite de Cloud Scheduler"
gcloud services enable cloudscheduler.googleapis.com --project="$PROJECT_ID"

echo "==> APIs souvent requises avec Scheduler + Functions Gen2 (idempotent)"
gcloud services enable \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  eventarc.googleapis.com \
  iam.googleapis.com \
  --project="$PROJECT_ID"

echo "==> Jobs Cloud Scheduler dans ${REGION} (repère firebase-schedule-*)"
gcloud scheduler jobs list --location="$REGION" --project="$PROJECT_ID" \
  --format='table(name,schedule,state)' || true

SCHED_JOB="firebase-schedule-scheduleProactiveReminders-${REGION}"
if gcloud scheduler jobs describe "$SCHED_JOB" --location="$REGION" --project="$PROJECT_ID" &>/dev/null; then
  echo "==> Suppression job orphelin : $SCHED_JOB"
  gcloud scheduler jobs delete "$SCHED_JOB" --location="$REGION" --project="$PROJECT_ID" --quiet
else
  echo "   (pas de job $SCHED_JOB — rien à supprimer)"
fi

echo "==> Services Cloud Run dans ${REGION} (cible botWebhook / scheduleProactiveReminders)"
gcloud run services list --region="$REGION" --project="$PROJECT_ID" \
  --format='table(metadata.name,status.url)' || true

# Noms typiques Gen2 : minuscules (ex. botwebhook). Correspondance partielle pour variantes.
MATCHES=()
while IFS= read -r line; do
  [[ -n "${line:-}" ]] && MATCHES+=("$line")
done < <(
  gcloud run services list --region="$REGION" --project="$PROJECT_ID" --format='value(metadata.name)' \
    | grep -Ei '(^|[-])botwebhook($|[-])|scheduleproactive' || true
)
for svc in botwebhook scheduleproactivereminders "${MATCHES[@]}"; do
  [[ -z "${svc:-}" ]] && continue
  if gcloud run services describe "$svc" --region="$REGION" --project="$PROJECT_ID" &>/dev/null; then
    echo "==> Suppression service Cloud Run orphelin : $svc"
    gcloud run services delete "$svc" --region="$REGION" --project="$PROJECT_ID" --quiet
  fi
done
echo "   (si un service orphelin reste, supprime-le à la main avec le nom exact listé ci-dessus)"

echo "==> (c) Build + redeploy uniquement botWebhook et scheduleProactiveReminders"
npm --prefix functions run build
firebase deploy --only "functions:botWebhook,functions:scheduleProactiveReminders" --project "$PROJECT_ID"

echo "==> Terminé. Vérifie la console Functions / Cloud Run pour ${REGION}."
