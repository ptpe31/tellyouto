#!/usr/bin/env bash
# Déploiement Firestore + Cloud Functions Gen2 — tellmeto-4f3c7 / europe-west9 (Paris).
# Prérequis : firebase login, npm install à la racine et dans functions/, projet Blaze.
# Usage : chmod +x deploy-paris.sh && ./deploy-paris.sh
set -euo pipefail

PROJECT_ID="${GCLOUD_PROJECT:-tellmeto-4f3c7}"
REGION="${FN_REGION:-europe-west9}"

echo "==> Projet Firebase : ${PROJECT_ID}  |  Région fonctions : ${REGION}"

echo "==> (a) Déploiement des règles Firestore"
firebase deploy --only firestore:rules --project "${PROJECT_ID}"

echo "==> Build functions (TypeScript)"
npm --prefix functions run build

echo "==> (b) Déploiement de toutes les fonctions Gen2 (${REGION})"
firebase deploy --only functions --project "${PROJECT_ID}"

TELEGRAM_URL="https://${REGION}-${PROJECT_ID}.cloudfunctions.net/telegramWebhook"
echo ""
echo "==> (c) URL Telegram (setWebhook Bot API)"
echo "    ${TELEGRAM_URL}"
echo ""
