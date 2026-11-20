#!/usr/bin/env bash
# Deploys Gapline to Cloud Run (asia-northeast3) from source via Cloud Build.
# Prerequisites (created once, see docs/DEPLOY.md): bucket, service account, secret.
# See docs/DEPLOY.md for the candidate build and separate promotion commands.
set -euo pipefail
: "${CLOUDSDK_ACTIVE_CONFIG_NAME:?select the named personal gcloud configuration}"
project="${GCP_PROJECT_ID:?set GCP_PROJECT_ID}"
identity="$(gcloud config get-value account)"
case "$(tr '[:upper:]' '[:lower:]' <<< "$identity")" in
  *@mazigle.ai|*@*.mazigle.ai) echo "Refusing to deploy from the company account." >&2; exit 1 ;;
  *@*) ;;
  *) echo "The selected gcloud configuration has no active account." >&2; exit 1 ;;
esac
tag="${TAG:-candidate}"
promote="${PROMOTE:-0}"
if [[ "$promote" != 0 && "$promote" != 1 ]]; then
  echo "Set PROMOTE to 0 (deploy) or 1 (promote the existing tag)." >&2
  exit 1
fi

region="${GCP_REGION:-asia-northeast3}"
service="${SERVICE:-scene-ad}"
number="$(gcloud projects describe "$project" --format='value(projectNumber)')"
bucket="${DATA_BUCKET:-scene-ad-data-$number}"
account="scene-ad-run@$project.iam.gserviceaccount.com"
# Builds run as their own account (roles/run.builder); the default compute account has no access
# to the source bucket in this project.
builder="projects/$project/serviceAccounts/scene-ad-build@$project.iam.gserviceaccount.com"

# The demo is public. --no-invoker-iam-check lets unauthenticated requests reach the service
# without an allUsers invoker binding; the app itself checks each request's origin and project access.
# --cpu-boost states what gcloud already turns on for a new service.
#
# Capacity (docs/DEPLOY.md, "Capacity and cost"): an instance converting an upload with ffmpeg gets
# few new requests, and one page load asks for about 30 files at once. With 2 instances of 10
# requests each, visitors got Cloud Run's bare "Rate exceeded." page and pages whose scripts never
# loaded (live QA, 2026-10-03). MIN_INSTANCES=1 keeps one instance warm for the judging window (about
# US$1.2 a day while idle); MIN_INSTANCES=0 turns that off at the next deploy, and
# `gcloud run services update --min-instances 0` turns it off without one.
#
# The bucket is mounted with metadata caching off. Instances share it, and a cached lookup let one
# instance answer with another's file as it was up to 60 s before (a finished run reported as still
# running, events going backwards). Every file lookup is then a Cloud Storage request. Cloud Run
# refuses metadata-cache-negative-ttl-secs (2026-10-03), so "missing" can still be cached for 5 s;
# a saved edit's answer lists the new result itself, so the editor does not depend on it.
if [[ "$promote" == 0 ]]; then
  # --set-env-vars replaces all previous values, including the daily allowance.
  budget="${DAILY_BUDGET_USD:?set DAILY_BUDGET_USD to the live daily allowance (docs/DEPLOY.md)}"
  # Rebuilding the same commit may select a different base image or configuration.
  build_id="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(8).toString("hex"))')"
  job="${service}-run-$(git rev-parse --short=12 HEAD)-$build_id"
  executor="${RUN_EXECUTOR:?set RUN_EXECUTOR to job or inline}"
  case "$executor" in job|inline) ;; *) echo "Invalid executor" >&2; exit 1 ;; esac
  run_env="DATA_DIR=/data,DATA_BUCKET=$bucket,GCP_PROJECT_ID=$project,DAILY_BUDGET_USD=$budget,VISITOR_DAILY_BUDGET_USD=${VISITOR_DAILY_BUDGET_USD:-3},RUN_EXECUTOR=$executor,RUN_JOB_NAME=$job,RUN_JOB_REGION=$region"
  gcloud run deploy "$service" \
    --no-traffic --tag "$tag" \
    --project "$project" --region "$region" --source . \
    --service-account "$account" \
    --build-service-account "$builder" \
    --execution-environment gen2 \
    --add-volume "name=data,type=cloud-storage,bucket=$bucket,mount-options=metadata-cache-ttl-secs=0" \
    --add-volume-mount "volume=data,mount-path=/data" \
    --set-env-vars "$run_env" \
    --set-secrets "GOOGLE_API_KEY=scene-ad-gemini-key:latest" \
    --cpu 2 --memory 2Gi --cpu-boost --concurrency 40 --timeout 900 \
    --min-instances "${MIN_INSTANCES:-0}" --max-instances 8 \
    --no-invoker-iam-check \
    --port 8080
fi

# Warm the new revision before a visitor does. Its startup probe only checks that the port is open:
# the first request loads the page code, and the first listing of the sample reads its runs (a new
# run index after an upgrade, about 12 s on 2026-10-03). Plain GETs, no model calls. The sample is
# absent until it is added (docs/DEPLOY.md, "7. Add the sample"), so only the landing page must answer.
target="$(gcloud run services describe "$service" --project "$project" --region "$region" \
    --format='json(status.traffic)' | jq -er --arg tag "$tag" '
    .status.traffic[] | select(.tag == $tag and (.url | startswith("https://")) and .revisionName)
    | [.url, .revisionName] | @tsv')"
IFS=$'\t' read -r url revision <<< "$target"
echo "Tag $tag on $revision: $url"
if [[ "$promote" == 0 && "$executor" == job ]]; then
  image="$(gcloud run revisions describe "$revision" --project "$project" --region "$region" --format='value(status.imageDigest)')"
  [[ "$image" =~ @sha256:[0-9a-f]{64}$ ]] || { echo "Revision has no immutable image digest" >&2; exit 1; }
  # Cloud Run Jobs run in the second-generation environment. The jobs deploy CLI has no gen selector.
  gcloud run jobs deploy "$job" --project "$project" --region "$region" --image "$image" \
    --service-account "$account" --tasks 1 --max-retries 2 --task-timeout 900s --cpu 2 --memory 2Gi \
    --add-volume "name=data,type=cloud-storage,bucket=$bucket,mount-options=metadata-cache-ttl-secs=0" \
    --add-volume-mount "volume=data,mount-path=/data" --set-env-vars "$run_env" \
    --set-secrets "GOOGLE_API_KEY=scene-ad-gemini-key:latest" --command node --args job/run-job.cjs
  gcloud run jobs add-iam-policy-binding "$job" --project "$project" --region "$region" \
    --member "serviceAccount:$account" --role roles/run.jobsExecutorWithOverrides
fi
sample="${SAMPLE_ID:-tos-opening}"
# A hung revision must not stall the script (curl has no time limit of its own); the slowest first
# request measured was the 12 s index rebuild above.
warmup_timeout_seconds=120
for path in / "/p/$sample"; do
  read -r code seconds < <(curl -sS --max-time "$warmup_timeout_seconds" -o /dev/null \
    -w '%{http_code} %{time_total}\n' "$url$path" || echo "000 0")
  echo "warm-up GET $path: HTTP $code in ${seconds}s"
  if [[ "$code" != 200 && ("$path" == / || "$promote" == 1 || "$code" != 404) ]]; then
    echo "Warm-up failed for $path; check the tagged revision logs." >&2
    exit 1
  fi
done

if [[ "$promote" == 1 ]]; then
  # Read the budget from the serving revision's own configuration. An env override at the
  # operator's prompt must not let promotion check a different bucket than the one holding work.
  traffic="$(gcloud run services describe "$service" --project "$project" --region "$region" \
    --format='json(status.traffic)')"
  jq -e --arg tag "$tag" --arg revision "$revision" 'any(.status.traffic[]; .tag == $tag and .revisionName == $revision)' <<< "$traffic" >/dev/null
  serving="$(jq -er '[.status.traffic[] | select((.percent // 0) > 0) | .revisionName] | unique | .[]' <<< "$traffic")"
  while IFS= read -r live_revision; do
    live_bucket="$(gcloud run revisions describe "$live_revision" --project "$project" --region "$region" \
      --format='json(spec.containers)' | jq -er '.spec.containers[0].env[] | select(.name == "DATA_BUCKET") | .value | select(length > 0)')"
    gcloud storage cat "gs://$live_bucket/budget/demo-v2.json" | node --input-type=module -e '
      import { readFileSync } from "node:fs";
      const {entries} = JSON.parse(readFileSync(0, "utf8"));
      const cutoff = Date.now() - 960_000;
      const live = entries.filter(entry => entry.done !== true &&
        (!Number.isFinite(Date.parse(entry.startedAt)) || Date.parse(entry.startedAt) > cutoff));
      for (const entry of live) console.error("Unsettled reservation:", entry.id, entry.startedAt);
      if (live.length) process.exit(1);'
  done <<< "$serving"
  gcloud run services update-traffic "$service" --project "$project" --region "$region" --to-tags "$tag=100"
fi
