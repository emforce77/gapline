import { randomUUID } from "node:crypto";
import { updateJson } from "./atomic";
import { assertSafeId, UPLOAD_ID_PREFIX, withinTimeLimit, type Project } from "./projects";

interface UploadState extends Project {
  /** Not part of the public Project schema; old uploads start with no work. */
  workStarted?: Record<string, string>;
  deleting?: boolean;
}

export class UploadGone extends Error {}
export class UploadBusy extends Error {}

/** A conditional write to the existing metadata. A missing upload must never be recreated. */
function changeUpload<T>(id: string, change: (upload: UploadState) => T): Promise<T> {
  const key = `projects/${assertSafeId(id)}/project.json`;
  return updateJson<Partial<UploadState>, T>(
    key,
    () => ({}),
    (state) => {
      if (!id.startsWith(UPLOAD_ID_PREFIX) || state.id !== id || state.kind !== "upload")
        throw new UploadGone();
      return change(state as UploadState);
    },
  );
}

/** Acquire before the first write, including an edit's idempotency claim. Shares the delete CAS. */
export async function beginUploadWork(projectId: string, token = randomUUID()): Promise<() => Promise<void>> {
  if (!projectId.startsWith(UPLOAD_ID_PREFIX)) return async () => {};
  await changeUpload(projectId, (upload) => {
    if (upload.deleting) throw new UploadGone();
    const active = (upload.workStarted ??= {});
    for (const [id, at] of Object.entries(active))
      if (!withinTimeLimit(at, Date.now())) delete active[id];
    active[token] = new Date().toISOString();
  });
  return () => releaseUploadWork(projectId, token);
}

export async function releaseUploadWork(projectId: string, token?: string): Promise<void> {
  if (!token || !projectId.startsWith(UPLOAD_ID_PREFIX)) return;
  await changeUpload(projectId, (upload) => {
    if (upload.workStarted) delete upload.workStarted[token];
  }).catch((error: unknown) => {
    console.error(`upload work release failed: project=${projectId}`, error);
  });
}

/** A failed deletion may be retried by its owner while new work remains fenced out. */
export function markDeleting(id: string, owner: string): Promise<void> {
  return changeUpload(id, (upload) => {
    if (upload.ownerHash !== owner) throw new UploadGone();
    if (Object.values(upload.workStarted ?? {}).some((at) => withinTimeLimit(at, Date.now())))
      throw new UploadBusy();
    upload.deleting = true;
  });
}
