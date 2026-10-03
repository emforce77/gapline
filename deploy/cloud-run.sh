#!/usr/bin/env bash
# Deploys Gapline to Cloud Run (asia-northeast3) from source via Cloud Build.
# Prerequisites (created once, see docs/DEPLOY.md): bucket, service account, secret.
# Usage: GCP_PROJECT_ID=<project> DAILY_BUDGET_USD=<dollars> bash deploy/cloud-run.sh
set -euo pipefail
project="${GCP_PROJECT_ID:?set GCP_PROJECT_ID}"
# --set-env-vars replaces every variable the service had, so the daily allowance is always stated:
# a default below what was already spent today would refuse every run and edit until 00:00 UTC.
# Read the live value first (docs/DEPLOY.md, "6. Deploy").
budget="${DAILY_BUDGET_USD:?set DAILY_BUDGET_USD to the live daily allowance (docs/DEPLOY.md)}"
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
gcloud run deploy "$service" \
  --project "$project" --region "$region" --source . \
  --service-account "$account" \
  --build-service-account "$builder" \
  --execution-environment gen2 \
  --add-volume "name=data,type=cloud-storage,bucket=$bucket,mount-options=metadata-cache-ttl-secs=0" \
  --add-volume-mount "volume=data,mount-path=/data" \
  --set-env-vars "DATA_DIR=/data,DATA_BUCKET=$bucket,GCP_PROJECT_ID=$project,DAILY_BUDGET_USD=$budget,VISITOR_DAILY_BUDGET_USD=${VISITOR_DAILY_BUDGET_USD:-3}" \
  --set-secrets "GOOGLE_API_KEY=scene-ad-gemini-key:latest" \
  --cpu 2 --memory 2Gi --cpu-boost --concurrency 40 --timeout 900 \
  --min-instances "${MIN_INSTANCES:-1}" --max-instances 8 \
  --no-invoker-iam-check \
  --port 8080
