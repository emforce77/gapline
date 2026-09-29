#!/usr/bin/env bash
# Deploys Gapline to Cloud Run (asia-northeast3) from source via Cloud Build.
# Prerequisites (created once, see docs/DEPLOY.md): bucket, service account, secret.
# Usage: GCP_PROJECT_ID=<project> bash deploy/cloud-run.sh
set -euo pipefail
project="${GCP_PROJECT_ID:?set GCP_PROJECT_ID}"
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
gcloud run deploy "$service" \
  --project "$project" --region "$region" --source . \
  --service-account "$account" \
  --build-service-account "$builder" \
  --execution-environment gen2 \
  --add-volume "name=data,type=cloud-storage,bucket=$bucket" \
  --add-volume-mount "volume=data,mount-path=/data" \
  --set-env-vars "DATA_DIR=/data,DATA_BUCKET=$bucket,GCP_PROJECT_ID=$project,DAILY_BUDGET_USD=${DAILY_BUDGET_USD:-5}" \
  --set-secrets "GOOGLE_API_KEY=scene-ad-gemini-key:latest" \
  --cpu 2 --memory 2Gi --concurrency 10 --timeout 900 \
  --min-instances 0 --max-instances 2 \
  --no-invoker-iam-check \
  --port 8080
