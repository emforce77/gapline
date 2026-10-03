import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/** Longest a line waits before it is written. */
const BATCH_DELAY_MS = 1000;

/**
 * Appends lines to one file in batches. On Cloud Run, DATA_DIR is a Cloud Storage bucket mounted with
 * gcsfuse: every append re-uploads the object as a new generation (about 0.1 s), and Cloud Storage
 * takes about one write per second per object. Appending each run event and each paid call on its own
 * made the pipeline wait on every one and ran into 429 retries during bursts (QA, 2026-10-03).
 *
 * `add` queues a line and returns at once; queued lines are written together at most BATCH_DELAY_MS
 * later, in order. `flush` writes them now and resolves once everything queued so far is on disk.
 * A failed write keeps its lines at the head of the queue, and the next flush writes them with
 * whatever came after: a refused write delays lines instead of losing them, and does not fail the
 * writes after it (review, 2026-10-03). A failed timed write is logged; a failed `flush` rejects.
 */
export class BufferedAppend {
  private pending: string[] = [];
  private timer: NodeJS.Timeout | undefined;
  private written: Promise<void> = Promise.resolve();
  private dirReady = false;

  constructor(readonly file: string) {}

  add(line: string): void {
    this.pending.push(line);
    this.timer ??= setTimeout(() => {
      this.flush().catch((error) =>
        console.error(`append failed, lines kept for the next flush: file=${this.file}`, error),
      );
    }, BATCH_DELAY_MS);
  }

  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    // Writes go one after another. An earlier failure was already given to its own caller; its
    // lines are back in the queue for this write.
    this.written = this.written.catch(() => {}).then(() => this.writePending());
    return this.written;
  }

  private async writePending(): Promise<void> {
    const chunk = this.pending.splice(0).join("");
    if (!chunk) return;
    try {
      if (!this.dirReady) await mkdir(dirname(this.file), { recursive: true });
      this.dirReady = true;
      await appendFile(this.file, chunk);
    } catch (error) {
      this.pending.unshift(chunk);
      throw error;
    }
  }

  /** Nothing queued and no batch waiting. */
  get idle(): boolean {
    return this.pending.length === 0 && this.timer === undefined;
  }
}
