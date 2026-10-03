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

After the deploy, the script requests the landing page and the sample's page once and prints each
status and time (`warm-up GET /: HTTP 200 in 0.641236s`). The first request loads the page code and the
first listing of the sample reads its runs, so the first visitor does not pay for either. It stops
with an error when the landing page does not answer 200, or does not answer within 120 seconds. The
sample's page answers 404 until you add the sample (step 7); set `SAMPLE_ID` when your sample has
another ID.

Uploads, runs and edits are accepted only when the browser's `Origin` matches the request's `Host`
and `X-Forwarded-Proto` (`requestOrigin` in `src/lib/store/access.ts`); `X-Forwarded-Host` is ignored,
because Cloud Run passes a client's value through unchanged. Serve the service on its own URL or a
Cloud Run domain mapping. Before putting a proxy in front of it (Firebase Hosting, a load balancer),
check which `Host` the service receives: if it is not the address in the browser, every upload, run and
edit is refused with 403.

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
consistent. Each lookup is then a request to Cloud Storage, so a project's run listing reads only the
names in its `runs/` folder and one index file, `projects/<id>/runs-index.json`, however many runs it
holds ([`src/lib/store/run-index.ts`](../src/lib/store/run-index.ts)). A run records itself there
when it ends, and one started from the web also when it starts, through the Cloud Storage API with a
generation precondition. A run the index does not know yet, such as every run from before the
index, is read once by the next listing and added, so the first listing of a project after the index
arrived reads all its runs (80 runs in a local test directory, 2026-10-03: 360 file calls once, then
2 per listing). A run folder that only lacks files, such as an edit that stopped before writing its
events or a run still being copied in, is read again by every listing until it has lacked them for
15 minutes, and only then recorded as ended, so a copy that completes in that time is listed. On a
copy of the live bucket from 2026-10-03, whose sample holds one such folder, a listing made 6 file
calls for those 15 minutes and 2 after. Cloud Storage accepts about one write per second to one
object; when a burst of runs ending at once loses index writes, those runs are logged as
`RUN INDEX NOT UPDATED` and read directly by each listing until one records them, so pages are
slower for that while and the lists stay right.

Node runs file calls on a pool of 4 threads unless told otherwise, and a call on the mount holds its
thread for the whole Cloud Storage round trip. With 4 such calls in flight, static files and pages
waited behind them (live, 2026-10-03: a static file took 3 ms alone and 98–133 ms with 8 media checks
in flight). The image sets `UV_THREADPOOL_SIZE=64` in the `Dockerfile`; Node reads it once at start,
so it cannot be set from the app or changed without a new image.

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
rm -f runtime/projects/tos-opening/runs-index.json   # a local run index; the service builds its own
gcloud storage cp -r runtime/projects/tos-opening "gs://$BUCKET/projects/"
gcloud storage rm "gs://$BUCKET/projects/tos-opening/runs-index.json"
```

The last command deletes the run index that a page opened during the copy may have written from
half-copied runs; the next listing builds it again from all the runs. When no page listed the
project meanwhile there is no index yet, and the command fails with nothing to delete. Do the same
after copying runs into any project in the bucket, such as restoring it from a backup.

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
