#!/usr/bin/env bash
# Deploy the student dashboard (static PWA + /api/proxy + /api/mentor) to Cloud Run.
#
# Usage (from the repository root, in Cloud Shell):
#   ./scripts/deploy-cloudrun.sh
#
# Override anything with environment variables, e.g.:
#   SERVICE=ump-student-dashboard REGION=asia-south1 ./scripts/deploy-cloudrun.sh

set -euo pipefail

PROJECT="${PROJECT:-ump-dashboard}"
REGION="${REGION:-asia-south1}"
SERVICE="${SERVICE:-student-dashboard}"
MENTOR_API_URL="${MENTOR_API_URL:-https://ujjwal-pathak-app-566076646952.asia-south1.run.app}"

# Optional: only set these if the legacy Apps Script / Sheets paths are still
# needed. Leave empty and the server answers those actions with a clean JSON
# error instead of falling over.
APPS_SCRIPT_URL="${APPS_SCRIPT_URL:-}"

# Optional: study-proof uploads to Google Drive (needed by the Android app).
# Set DRIVE_PROOF_FOLDER_ID plus either GOOGLE_SERVICE_ACCOUNT_JSON or the
# email/private-key pair. Prefer Secret Manager for the private key in prod.
DRIVE_PROOF_FOLDER_ID="${DRIVE_PROOF_FOLDER_ID:-}"

cd "$(dirname "$0")/.."

echo "==> Project : $PROJECT"
echo "==> Region  : $REGION"
echo "==> Service : $SERVICE"
echo "==> Backend : $MENTOR_API_URL"
echo

gcloud config set project "$PROJECT" >/dev/null

echo "==> Enabling required APIs (no-op if already on)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  --project "$PROJECT" >/dev/null

ENV_VARS="MENTOR_API_URL=${MENTOR_API_URL}"
if [[ -n "$APPS_SCRIPT_URL" ]]; then
  ENV_VARS="${ENV_VARS},APPS_SCRIPT_URL=${APPS_SCRIPT_URL}"
fi
if [[ -n "$DRIVE_PROOF_FOLDER_ID" ]]; then
  ENV_VARS="${ENV_VARS},DRIVE_PROOF_FOLDER_ID=${DRIVE_PROOF_FOLDER_ID}"
fi

echo "==> Building and deploying from source"
# --update-env-vars (not --set-env-vars) so existing APPS_SCRIPT_URL /
# DRIVE_PROOF_FOLDER_ID / secrets on the service are preserved.
# --timeout 1800 because a 52 MB APK streamed to a slow phone easily outlives the
# old 300 s limit - Cloud Run would cut the download and the student would retry.
gcloud run deploy "$SERVICE" \
  --source . \
  --project "$PROJECT" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --cpu 1 \
  --memory 512Mi \
  --concurrency 80 \
  --min-instances 1 \
  --max-instances 10 \
  --timeout 1800 \
  --update-env-vars "$ENV_VARS"

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)')"

echo
echo "==> Deployed: $URL"
echo "==> Smoke tests"
curl -fsS "$URL/api/health" && echo
curl -fsS -o /dev/null -w "   index.html  -> %{http_code}\n" "$URL/"
curl -fsS -o /dev/null -w "   app.js      -> %{http_code}\n" "$URL/app.js"
curl -fsS -o /dev/null -w "   /download/android -> %{http_code} %{content_type}\n" -r 0-99 "$URL/download/android"
curl -fsS -X POST "$URL/api/proxy" \
  -H 'Content-Type: application/json' \
  -d '{"action":"getAnnouncements","payload":{}}' \
  -o /dev/null -w "   /api/proxy  -> %{http_code}\n"
echo
echo "Done. Point the students at: $URL"
