# Existing Cloud Run service

Deploy from the working checkout using the existing `scene-ad` gcloud configuration. This updates the already-public app; it does not publish the Git repository.

```sh
CLOUDSDK_ACTIVE_CONFIG_NAME=scene-ad \
GCP_PROJECT_ID=majestic-voice-486204-q6 \
DAILY_BUDGET_USD=5 bash deploy/cloud-run.sh
```

Before updating the service, check recent generation/edit requests and active runs. Avoid switching revisions while a paid request is executing. The script uses the existing build account, run account, regional Cloud Storage bucket and Secret Manager key. It sets `DATA_BUCKET` for conditional budget and edit-request writes; omitting it deliberately stops paid Cloud Run mutations.

Runtime state is mounted at `/data`. Public samples are under `projects/<sample>/`; uploads contain owner hashes and remain private. Keep `.env.local`, runtime media, ledgers, browser cookies and local build directories out of the build context and Git.

After deployment, inspect the ready revision and traffic, then check one sample playback, sentence edit and download. Check upload ownership with two separate browser sessions. A completed build alone does not prove those paths work.

Optional `showcase.json` in the data root pins the landing-page/default sample results:

```json
{ "projectId": "tos-opening", "runs": { "ko": "chosen-run-id", "en": "chosen-run-id" } }
```

The selected result must exist and be complete. Explicit `?run=<id>` links take precedence. Language/density availability is read from completed stored runs. Do not select a result solely because its model audit passed; independent listening acceptance remains separate.

Reservations with unknown costs and edit claims left running after a crash fail closed. Reconcile the provider ledger and artifacts before an operator changes those records. Automatic cleanup must never turn an unknown charge into zero.

## September 22 verification

Revision `scene-ad-00008-jcs` received all traffic. A real sentence edit created `edit-6c4ddb3c5a06c7901a834befe1bb25ba04a7ebde` from `edit-b81cc95c158ee4acf857a44a2f7cf609e1df851c`; all five unchanged WAV files matched byte for byte. Repeating the earlier edit request returned its existing run. The final smoke check confirmed sample playback, the mobile sentence selector without horizontal overflow, and MP4/WAV/VTT/JSON downloads. A separate session received 404 on all six private upload read/mutation paths; the owner received a 206 range response.

Evidence is saved locally in `runtime/demo-v2/live-check.json`. The selected six-line result still has unresolved coverage and remains **Review needed**. Deployment verification does not close the independent listening acceptance gate.
