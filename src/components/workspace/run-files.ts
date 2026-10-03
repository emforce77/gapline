import {
  READ_RETRY_DELAYS_MS,
  retryTransient,
  RunRequestError,
  sleep,
} from "@/lib/client/run-stream";

/** "missing": the result never wrote it. "unknown": no clear answer, so it is offered as a link. */
export type RunFileState = "present" | "missing" | "unknown";

/**
 * Whether one result file exists, read with a one-byte range request. Only a 404 means "missing":
 * the media route answers 404 for every file or run that is not there, so a busy 429 or a gateway
 * error must not label a file as never recorded. Busy answers are asked again with the same waits
 * and statuses as every other read of a run (retryTransient); any other answer, or a busy one to the
 * last, leaves the file unknown. A failed connection is thrown, as the other reads do.
 */
export async function probeRunFile(
  url: string,
  {
    fetchFile = fetch,
    wait = sleep,
    delays = READ_RETRY_DELAYS_MS,
  }: {
    fetchFile?: (url: string, init: RequestInit) => Promise<Response>;
    wait?: (ms: number) => Promise<void>;
    delays?: readonly number[];
  } = {},
): Promise<RunFileState> {
  try {
    return await retryTransient<RunFileState>(
      async () => {
        const response = await fetchFile(url, { headers: { Range: "bytes=0-0" } });
        await response.body?.cancel();
        if (response.ok) return "present";
        if (response.status === 404) return "missing";
        throw new RunRequestError(response.status, {});
      },
      delays,
      wait,
    );
  } catch (error) {
    if (error instanceof RunRequestError) return "unknown";
    throw error;
  }
}

/**
 * What the probes found missing, by run media base (which holds the run id). A run's files never
 * change once they are listed (an edit makes a new run), so each run is probed once per page.
 */
const knownMissing = new Map<string, ReadonlySet<string>>();
/** Probes under way, so a remount (or React's development double mount) waits for them. */
const probing = new Map<string, Promise<ReadonlySet<string>>>();

/** The keys of a run's files found missing, or undefined until every file had a clear answer. */
export function knownMissingFiles<K extends string>(base: string): ReadonlySet<K> | undefined {
  return knownMissing.get(base) as ReadonlySet<K> | undefined;
}

/**
 * Probes each file of a run (name under `base`) and returns the keys found missing. Concurrent calls
 * for one run share a probe; a run whose files all had a clear answer is not probed again, while one
 * with an "unknown" file is, the next time it is asked for.
 */
export function probeRunFiles<K extends string>(
  base: string,
  files: Record<K, string>,
  probe: (url: string) => Promise<RunFileState> = probeRunFile,
): Promise<ReadonlySet<K>> {
  const known = knownMissingFiles<K>(base);
  if (known) return Promise.resolve(known);
  const pending = probing.get(base);
  if (pending) return pending as Promise<ReadonlySet<K>>;
  const keys = Object.keys(files) as K[];
  const started = Promise.all(
    keys.map(async (key) => [key, await probe(`${base}/${files[key]}`)] as const),
  )
    .then((states) => {
      const found = new Set(states.filter(([, state]) => state === "missing").map(([key]) => key));
      if (states.every(([, state]) => state !== "unknown")) knownMissing.set(base, found);
      return found;
    })
    .finally(() => probing.delete(base));
  probing.set(base, started);
  return started;
}
