# Deploy your own

This sets up Scene on Cloud Run in a Google Cloud project of your own: the APIs, a bucket, two service
accounts and a secret, then one deploy command. Every step uses the gcloud CLI.

## You need

- A Google Cloud project with billing enabled.
- The gcloud CLI, signed in with an account that can enable APIs and create buckets, service accounts,
  secrets and IAM bindings in that project (Owner works). That account must also be allowed to act as
  the two service accounts below; Owner is, otherwise grant it `roles/iam.serviceAccountUser` on each.
- An API key for the Gemini calls. <!-- GEMINI_ACCESS_LABEL: update with deploy/cloud-run.sh when the Gemini access changes. -->
- For the sample: Node.js 20.9 or newer and FFmpeg, as in the README's "Run it locally".

## 1. Choose names

```sh
PROJECT_ID=<your-project-id>
REGION=asia-northeast3
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
BUCKET="scene-ad-data-$PROJECT_NUMBER"
RUN_SA="scene-ad-run@$PROJECT_ID.iam.gserviceaccount.com"
BUILD_SA="scene-ad-build@$PROJECT_ID.iam.gserviceaccount.com"
```

The deploy script expects these bucket and service-account names. `GCP_REGION`, `SERVICE` and
`DATA_BUCKET` override its defaults (`asia-northeast3`, `scene-ad`, `scene-ad-data-<project number>`).

## 2. Enable the APIs

```sh
gcloud services enable --project "$PROJECT_ID" \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  speech.googleapis.com texttospeech.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com
```

## 3. Create the bucket

Projects, analysis and runs live here. Cloud Run mounts it at `/data`, and the daily allowance and edit
requests are written to it with conditional writes.

```sh
gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT_ID" \
  --location "$REGION" --uniform-bucket-level-access
```

## 4. Create the service accounts

`scene-ad-run` is the identity of the running service. `scene-ad-build` builds the container from
source.

```sh
gcloud iam service-accounts create scene-ad-run --project "$PROJECT_ID" --display-name "Scene service"
gcloud iam service-accounts create scene-ad-build --project "$PROJECT_ID" --display-name "Scene build"

# The service calls Speech-to-Text and Text-to-Speech, billed to this project.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:$RUN_SA" --role roles/speech.client
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:$RUN_SA" --role roles/serviceusage.serviceUsageConsumer

# It reads and writes objects in the data bucket.
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member "serviceAccount:$RUN_SA" --role roles/storage.objectUser

# Source deploys build as this account.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:$BUILD_SA" --role roles/run.builder
```

## 5. Store the model API key

The deploy script mounts the secret `scene-ad-openrouter-key` as the service's model API key.
<!-- GEMINI_ACCESS_LABEL: the secret name and variable come from deploy/cloud-run.sh; change them together. -->

```sh
read -rs MODEL_API_KEY   # paste the key; it is not shown
printf '%s' "$MODEL_API_KEY" | gcloud secrets create scene-ad-openrouter-key \
  --project "$PROJECT_ID" --data-file=-
gcloud secrets add-iam-policy-binding scene-ad-openrouter-key --project "$PROJECT_ID" \
  --member "serviceAccount:$RUN_SA" --role roles/secretmanager.secretAccessor
```

## 6. Deploy

```sh
GCP_PROJECT_ID="$PROJECT_ID" bash deploy/cloud-run.sh
```

The script runs `gcloud run deploy --source .` with the account of your active gcloud configuration
(set `CLOUDSDK_ACTIVE_CONFIG_NAME` to pick another). Cloud Build builds the `Dockerfile`, the image goes
to Artifact Registry, and Cloud Run starts the service with:

- the second-generation execution environment, 2 vCPU, 2 GiB, up to 10 requests per instance, a
  900-second request timeout, and 0 to 2 instances;
- the bucket mounted at `/data`, with `DATA_DIR`, `DATA_BUCKET`, `GCP_PROJECT_ID` and
  `DAILY_BUDGET_USD` set (the daily API allowance, 5 US dollars unless you set it);
- the model API key from Secret Manager;
- public access, by turning off the invoker IAM check.

## 7. Add the sample

The service starts with no projects. To show the _Tears of Steel_ sample, prepare it locally and copy
it into the bucket:

```sh
npm ci
cp -n .env.example .env.local   # keeps an existing file; the sample steps need no key
npm run samples              # downloads the film once and prepares runtime/projects/tos-opening
gcloud storage cp -r runtime/projects/tos-opening "gs://$BUCKET/projects/"
```

Open the service URL that the deploy printed, open the sample and generate a track. The landing page
shows the newest Standard track in the viewer's language. To choose which tracks it shows, put
a `showcase.json` at the top of the bucket:

```json
{ "projectId": "tos-opening", "runs": { "ko": "<run id>", "en": "<run id>" } }
```

A run ID is the folder name under `projects/tos-opening/runs/`.

## Check it

A finished build does not show that generation works. After each deploy, play the sample, generate
one track, change one line, and download the four files. Upload a clip in one browser and confirm that
a second browser session cannot open it.

A new revision replaces the running instances, and a generation runs inside its request. Deploy when
no generation or edit is in progress.
