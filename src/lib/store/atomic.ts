import { Storage } from "@google-cloud/storage";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { dataDir } from "./projects";

/** Conditional object writes on Cloud Run; a filesystem lock + atomic rename locally. */
export async function updateJson<T, R>(
  key: string,
  initial: () => T,
  change: (state: T) => R,
): Promise<R> {
  const bucketName = process.env.DATA_BUCKET;
  if (process.env.K_SERVICE && !bucketName)
    throw new Error("DATA_BUCKET is required for atomic Cloud Run writes");
  if (bucketName) {
    const bucket = new Storage().bucket(bucketName);
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        let generation: string | number = 0;
        let state = initial();
        try {
          const [metadata] = await bucket.file(key).getMetadata();
          generation = metadata.generation!;
          const [body] = await bucket.file(key, { generation }).download();
          state = JSON.parse(body.toString());
        } catch (e) {
          if (Number((e as { code?: number }).code) !== 404) throw e;
        }
        const result = change(state);
        await bucket.file(key).save(JSON.stringify(state), {
          resumable: false,
          contentType: "application/json",
          preconditionOpts: { ifGenerationMatch: generation },
        });
        return result;
      } catch (e) {
        if (![404, 412].includes(Number((e as { code?: number }).code)) || attempt === 7) throw e;
        await delay(20 * (attempt + 1));
      }
    }
    throw new Error("Concurrent update could not be committed");
  }
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
