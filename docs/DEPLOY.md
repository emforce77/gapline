# Deploy your own

This sets up Gapline on Cloud Run in a Google Cloud project of your own: the APIs, a bucket, two service
accounts and a secret, then one deploy command. Every step uses the gcloud CLI.

## You need

- A Google Cloud project with billing enabled.
- The gcloud CLI, signed in with an account that can enable APIs and create buckets, service accounts,
  secrets and IAM bindings in that project (Owner works). That account must also be allowed to act as
  the two service accounts below; Owner is, otherwise grant it `roles/iam.serviceAccountUser` on each.
- A Gemini API key from Google AI Studio, with billing and quota available for the configured model.
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
  speech.googleapis.com texttospeech.googleapis.com generativelanguage.googleapis.com \
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
gcloud iam service-accounts create scene-ad-run --project "$PROJECT_ID" --display-name "Gapline service"
gcloud iam service-accounts create scene-ad-build --project "$PROJECT_ID" --display-name "Gapline build"

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

The deploy script exposes the secret `scene-ad-gemini-key` as `GOOGLE_API_KEY` for direct calls to
the Gemini API. Speech-to-Text and Text-to-Speech continue to use the service account.
<!-- GEMINI_ACCESS_LABEL: the secret name and variable come from deploy/cloud-run.sh; change them together. -->

```sh
read -rs GOOGLE_API_KEY   # paste the Google AI Studio key; it is not shown
printf '%s' "$GOOGLE_API_KEY" | gcloud secrets create scene-ad-gemini-key \
  --project "$PROJECT_ID" --data-file=-
unset GOOGLE_API_KEY
gcloud secrets add-iam-policy-binding scene-ad-gemini-key --project "$PROJECT_ID" \
  --member "serviceAccount:$RUN_SA" --role roles/secretmanager.secretAccessor
```

## 6. Deploy

```sh
# The daily allowance the service has now; for a first deploy, choose one (in US dollars).
gcloud run services describe scene-ad --project "$PROJECT_ID" --region "$REGION" \
  --format='yaml(spec.template.spec.containers[0].env)' | grep -A1 'name: DAILY_BUDGET_USD'
GCP_PROJECT_ID="$PROJECT_ID" DAILY_BUDGET_USD=<dollars> bash deploy/cloud-run.sh
```

`DAILY_BUDGET_USD` is required. The script sets the service's variables with `--set-env-vars`, which
removes every variable the service had, so a value left out or set lower than what was already
spent today would refuse every live track and edit until 00:00 UTC.

The script runs `gcloud run deploy --source .` with the account of your active gcloud configuration
(set `CLOUDSDK_ACTIVE_CONFIG_NAME` to pick another). Cloud Build builds the `Dockerfile`, the image goes
to Artifact Registry, and Cloud Run starts the service with:

- the second-generation execution environment, 2 vCPU, 2 GiB, up to 40 requests per instance, a
  900-second request timeout, and 1 to 8 instances (see "Capacity and cost" below);
- startup CPU boost, which gcloud also turns on by default for a new service: a starting instance gets
  4 vCPU instead of 2 until 10 seconds after it has started, and the extra CPU is billed for that
  time;
- the bucket mounted at `/data` with Cloud Storage FUSE metadata caching off (see "Shared storage"
  below), with `DATA_DIR`, `DATA_BUCKET`, `GCP_PROJECT_ID`, `DAILY_BUDGET_USD` (the daily API
  allowance, as you set it) and `VISITOR_DAILY_BUDGET_USD` (one visitor's share of
  it, 3 US dollars unless you set it) set;
- `GOOGLE_API_KEY` from Secret Manager;
- public access, by turning off the invoker IAM check.

### Capacity and cost

One page load asks for about 30 files at once, and an instance that is converting an upload with
FFmpeg gets few new requests while it does. With at most 2 instances of 10 requests each, visitors
got Cloud Run's bare "Rate exceeded." page and pages whose scripts never loaded (QA, 2026-10-03), so
the script allows 40 requests per instance and up to 8 instances. Instances are billed only while
they run, so the higher ceiling costs nothing while traffic is low.

One instance is kept running (`--min-instances 1`), so no visitor waits for one to start (about 5
seconds after a quiet period). That costs about 1.2 US dollars a day at the idle rate for 2 vCPU and
2 GiB; check the Cloud Run pricing page for your region. To stop paying for it, change the running
service; this needs no build and leaves its variables as they are:

```sh
gcloud run services update scene-ad --project "$PROJECT_ID" --region "$REGION" --min-instances 0
```

The script keeps one instance at every deploy unless you also pass `MIN_INSTANCES=0` (with the same
`DAILY_BUDGET_USD` as above).

### Shared storage

Every instance reads and writes the same bucket. Cloud Storage FUSE normally caches what it looked
up for 60 seconds, and that a file is missing for 5 seconds, so one instance could answer with
another's file as it was up to a minute before: a finished run still "running" and its stages going
backwards, or a saved edit missing from the list. The script mounts the bucket with
`metadata-cache-ttl-secs=0`, so every lookup of an existing file asks Cloud Storage, which is
consistent. Each lookup is then a request to Cloud Storage; listings read their files several at a
time to keep that short.

gcloud takes the options without leading dashes, separated by semicolons (`gcloud run deploy --help`,
585.0.0). Cloud Run refused `metadata-cache-negative-ttl-secs` on 2026-10-03 ("Unsupported or
unrecognized flag for Cloud Storage volume"), so another instance can still report a just-written
file as missing for up to 5 seconds. A saved edit does not depend on that: the edit's answer already
lists the new result. To confirm the option on the volume:

```sh
gcloud run services describe scene-ad --project "$PROJECT_ID" --region "$REGION" \
  --format='yaml(spec.template.spec.volumes)'
```

### Who can spend the allowance

Live tracks and edits draw on one daily allowance (`DAILY_BUDGET_USD`, renewed at 00:00 UTC). Each
holds 2.50 US dollars of it while it runs and is then charged what its calls cost. A visitor (one
browser session, identified by its cookie) can have one track or edit in progress at a time, and
cannot start more once what they used today reaches `VISITOR_DAILY_BUDGET_USD`; the one in
progress still finishes. A new session costs nothing to get (a private window, cleared cookies), so
these limits keep an ordinary visitor from holding the allowance, not a script; the daily allowance
is the hard ceiling either way.

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

A run ID is the folder name under `projects/tos-opening/runs/`. A language whose run ID is missing,
or names no finished Standard track, shows the newest Standard track instead.

Every page reads this file, so copy the sample into the bucket before the pin. A pin that names a
missing project or an upload, or that lacks `projectId` or `runs`, makes every page fail with an
error naming `showcase.json` until the file is fixed or deleted.

## Check it

A finished build does not show that generation works. After each deploy, play the sample, generate
one track, change one line, and download the four files. Upload a clip in one browser and confirm that
a second browser session cannot open it.

A new revision replaces the running instances, and a generation runs inside its request. Deploy when
no generation or edit is in progress.
