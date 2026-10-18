#!/usr/bin/env bash
# Prepared release automation. Never run during local development.
# Deploys ONLY the student gateway/PWA; never the missing mentor backend.
set -euo pipefail
[[ "${CI:-}" == "true" && "${UPM_WEB_DEPLOY_ENABLED:-}" == "1" ]] || { echo 'Web deployment is disabled.' >&2; exit 1; }
: "${UPM_RELEASE_SHA:?Missing tested commit SHA}"
: "${GCP_PROJECT_ID:?Missing project}"
: "${GCP_REGION:?Missing region}"
: "${GCP_WEB_SERVICE:?Missing existing student service}"
[[ "$GCP_PROJECT_ID" == 'ump-dashboard' && "$GCP_REGION" == 'asia-south1' && "$GCP_WEB_SERVICE" == 'student-dashboard' ]] || { echo 'Refusing an unreviewed Cloud Run target.' >&2; exit 1; }
[[ "$UPM_RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]] || exit 1
cd "$(dirname "$0")/.."
[[ "$(git rev-parse HEAD)" == "$UPM_RELEASE_SHA" ]] || { echo 'Untested checkout.' >&2; exit 1; }
[[ "$(git ls-remote origin refs/heads/main | cut -f1)" == "$UPM_RELEASE_SHA" ]] || { echo 'Newer main commit exists; refusing stale release.' >&2; exit 1; }

# Read only routing metadata, not environment variables or secret values.
old=$(gcloud run services describe "$GCP_WEB_SERVICE" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format='json(status.traffic,status.url)')
url=$(jq -er '.status.url | select(startswith("https://"))' <<< "$old")
old_routes=$(jq -er '[.status.traffic[] | select((.percent // 0) > 0)] | if (map(.percent) | add) != 100 or any(.[]; (.revisionName // "") == "") then error("Cannot safely preserve traffic") else map(.revisionName + "=" + (.percent|tostring)) | join(",") end' <<< "$old")
tag="candidate-${UPM_RELEASE_SHA:0:10}"
promoting=0
rollback() {
  code=$?
  if [[ "$code" != 0 && "$promoting" == 1 ]]; then
    echo 'Release health failed; restoring previous routing.' >&2
    gcloud run services update-traffic "$GCP_WEB_SERVICE" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --to-revisions "$old_routes" --quiet || echo 'ROLLBACK FAILED: operator intervention required.' >&2
  fi
  exit "$code"
}
trap rollback EXIT

# Preserve current environment/secrets/IAM/resources. Never call the legacy
# deploy script: it overrides MENTOR_API_URL with an unverified legacy default.
gcloud run deploy "$GCP_WEB_SERVICE" --source . --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --no-traffic --tag "$tag" --quiet
candidate=$(gcloud run services describe "$GCP_WEB_SERVICE" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format='json(status.traffic)')
candidate_url=$(jq -er --arg tag "$tag" '.status.traffic[] | select(.tag == $tag) | .url' <<< "$candidate")
revision=$(jq -er --arg tag "$tag" '.status.traffic[] | select(.tag == $tag) | .revisionName' <<< "$candidate")
expected_js=$(sha256sum app.js | cut -d' ' -f1)
smoke() {
  local base="$1"
  curl --fail --silent --show-error --max-time 60 "$base/api/health" | jq -e '.ok == true and .backendConfigured == true' >/dev/null
  curl --fail --silent --show-error --max-time 60 "$base/" -o /dev/null
  local served_js
  served_js=$(curl --fail --silent --show-error --max-time 60 "$base/app.js" | sha256sum | cut -d' ' -f1)
  [[ "$served_js" == "$expected_js" ]] || { echo 'Served app.js is not the tested source.' >&2; return 1; }
}
smoke "$candidate_url"
# Check freshness again after the potentially long Cloud Build.
[[ "$(git ls-remote origin refs/heads/main | cut -f1)" == "$UPM_RELEASE_SHA" ]] || { echo 'Build superseded; candidate left without production traffic.' >&2; exit 1; }
promoting=1
gcloud run services update-traffic "$GCP_WEB_SERVICE" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --to-revisions "$revision=100" --quiet
smoke "$url"
promoting=0
printf 'Student web release verified: %s (%s)\n' "$UPM_RELEASE_SHA" "$revision"
