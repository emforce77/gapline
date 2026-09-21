#!/usr/bin/env bash
# Deploys Scene to Cloud Run (asia-northeast3) from source via Cloud Build.
# Prerequisites (created once, see docs/DEPLOY.md): bucket, service account, secret.
# Usage: GCP_PROJECT_ID=<project> bash deploy/cloud-run.sh
set -euo pipefail
project="${GCP_PROJECT_ID:?set GCP_PROJECT_ID}"
region="${GCP_REGION:-asia-northeast3}"
service="${SERVICE:-scene-ad}"
number="$(gcloud projects describe "$project" --format='value(projectNumber)')"
bucket="${DATA_BUCKET:-scene-ad-data-$number}"
account="scene-ad-run@$project.iam.gserviceaccount.com"

# The project's organisation only allows its own domain in IAM policies, so the service is made
# public by switching off the invoker check instead of granting allUsers.
gcloud run deploy "$service" \
  --project "$project" --region "$region" --source . \
  --service-account "$account" \
  --execution-environment gen2 \
  --add-volume "name=data,type=cloud-storage,bucket=$bucket" \
  --add-volume-mount "volume=data,mount-path=/data" \
  --set-env-vars "DATA_DIR=/data,GCP_PROJECT_ID=$project,DAILY_BUDGET_USD=${DAILY_BUDGET_USD:-3}" \
  --set-secrets "OPENROUTER_API_KEY=scene-ad-openrouter-key:latest" \
  --cpu 2 --memory 2Gi --concurrency 10 --timeout 900 \
  --min-instances 0 --max-instances 2 \
  --no-invoker-iam-check \
  --port 8080
