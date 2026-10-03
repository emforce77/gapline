import { Storage } from "@google-cloud/storage";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { dataDir } from "./projects";

/** Reads what updateJson writes (the bucket object on Cloud Run, the local file otherwise). */
export async function readJson<T>(key: string, initial: () => T): Promise<T> {
  const bucketName = process.env.DATA_BUCKET;
  if (bucketName) {
    try {
      const [body] = await new Storage().bucket(bucketName).file(key).download();
      return JSON.parse(body.toString());
    } catch (e) {
      if (Number((e as { code?: number }).code) === 404) return initial();
      throw e;
    }
  }
  try {
    return JSON.parse(await readFile(join(dataDir(), key), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return initial();
    throw e;
  }
}

/** The calls updateObjectJson makes on a bucket; @google-cloud/storage's Bucket has them. */
export interface JsonBucket {
  file(
    name: string,
    options?: { generation?: string | number },
  ): {
    getMetadata(): Promise<[{ generation?: string | number }, ...unknown[]]>;
    download(): Promise<[Buffer, ...unknown[]]>;
    save(
      data: string,
      options: {
        resumable: false;
        contentType: string;
        preconditionOpts: { ifGenerationMatch: string | number };
      },
    ): Promise<unknown>;
  };
}

const COMMIT_ATTEMPTS = 8;
const errorCode = (e: unknown) => Number((e as { code?: number }).code);

/**
 * updateJson against a bucket: read the object at one generation, change it, and save it only if
 * that generation is still current. A 404 from the metadata lookup means there is no object yet. A
 * 404 from the download pinned to that generation means another writer replaced it in between (the
 * bucket keeps no old generations), which is a lost race like a 412, so both are tried again with
 * a fresh read. Treating that 404 as "no object" ran `change` on an empty state: settling a run
 * then failed with "Reservation not found" after the run had finished (live QA, 2026-10-03).
 */
export async function updateObjectJson<T, R>(
  bucket: JsonBucket,
  key: string,
  initial: () => T,
  change: (state: T) => R,
): Promise<R> {
  for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt++) {
    try {
      let generation: string | number = 0;
      let state = initial();
      let found: { generation?: string | number } | undefined;
      try {
        [found] = await bucket.file(key).getMetadata();
      } catch (e) {
        if (errorCode(e) !== 404) throw e;
      }
      if (found) {
        generation = found.generation!;
        const [body] = await bucket.file(key, { generation }).download();
        state = JSON.parse(body.toString());
      }
      const result = change(state);
      await bucket.file(key).save(JSON.stringify(state), {
        resumable: false,
        contentType: "application/json",
        preconditionOpts: { ifGenerationMatch: generation },
      });
      return result;
    } catch (e) {
      if (![404, 412].includes(errorCode(e)) || attempt === COMMIT_ATTEMPTS - 1) throw e;
      await delay(20 * (attempt + 1));
    }
  }
  throw new Error("Concurrent update could not be committed");
}

/** Conditional object writes on Cloud Run; a filesystem lock + atomic rename locally. */
export async function updateJson<T, R>(
  key: string,
  initial: () => T,
  change: (state: T) => R,
): Promise<R> {
  const bucketName = process.env.DATA_BUCKET;
  if (process.env.K_SERVICE && !bucketName)
    throw new Error("DATA_BUCKET is required for atomic Cloud Run writes");
  if (bucketName) return updateObjectJson(new Storage().bucket(bucketName), key, initial, change);
  const file = join(dataDir(), key);
  await mkdir(dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  let acquired = false;
  for (let i = 0; i < 100; i++) {
    try {
      await mkdir(lock);
      acquired = true;
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      await delay(25);
    }
  }
  if (!acquired) throw new Error("Resource busy; retry later");
  try {
    let state = initial();
    try {
      state = JSON.parse(await readFile(file, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const result = change(state);
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state));
    await rename(temporary, file);
    return result;
  } finally {
    await rm(lock, { recursive: true });
  }
}
