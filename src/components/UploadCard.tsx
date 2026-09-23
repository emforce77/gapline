"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { dictionary, fill, type UiLang } from "@/i18n";
import type { LiveStatus } from "@/lib/api-contract";
import {
  liveStatusMessage,
  readUploadResponse,
  uploadErrorMessage,
  type UploadFailure,
} from "@/lib/client/api-errors";
import { fetchLiveStatus } from "@/lib/client/run-stream";
import { checkClipFile, readVideoSeconds, sendClip, UploadNetworkError } from "@/lib/client/upload";
import styles from "./UploadCard.module.css";

type Phase =
  | { name: "idle" }
  | { name: "checking" }
  | { name: "sending"; fraction: number }
  | { name: "preparing" }
  | { name: "failed"; failure: UploadFailure };

const HINT_ID = "upload-hint";
const STATUS_ID = "upload-status";

/**
 * Picks or receives (drag and drop) a short video, checks it against the upload limits, uploads it
 * with progress and opens its workspace. Warns up front when a live run could not start right now.
 */
export function UploadCard({
  lang,
  labels,
}: {
  /** The page language, from the same cookie the landing page reads. */
  lang: UiLang;
  labels: {
    title: string;
    hint: string;
    choose: string;
    working: string;
    tooLong: string;
    failed: string;
  };
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const t = dictionary(lang);
  const working =
    phase.name === "checking" || phase.name === "sending" || phase.name === "preparing";

  useEffect(() => {
    fetchLiveStatus()
      .then(setStatus)
      .catch((error: unknown) => console.error("live status unavailable", error));
  }, []);

  async function upload(file: File) {
    if (working) return;
    setPhase({ name: "checking" });
    const early = checkClipFile(file, null);
    const refusal = early ?? checkClipFile(file, await readVideoSeconds(file));
    if (refusal) {
      setPhase({ name: "failed", failure: refusal });
      return;
    }
    setPhase({ name: "sending", fraction: 0 });
    let response;
    try {
      response = await sendClip(file, (fraction) =>
        setPhase(fraction < 1 ? { name: "sending", fraction } : { name: "preparing" }),
      );
    } catch (error) {
      if (!(error instanceof UploadNetworkError)) throw error;
      console.error("upload failed", error);
      setPhase({ name: "failed", failure: { code: "network" } });
      return;
    }
    const result = readUploadResponse(response, file.size);
    if ("id" in result) {
      router.push(`/p/${result.id}`);
      return;
    }
    console.warn(`upload refused: HTTP ${response.status} ${result.code}`);
    setPhase({ name: "failed", failure: result });
  }

  function buttonLabel(): React.ReactNode {
    if (!working) return labels.choose;
    const text =
      phase.name === "checking"
        ? t.upload.checking
        : phase.name === "sending"
          ? fill(t.upload.uploading, {
              percent: new Intl.NumberFormat(lang, { style: "percent" }).format(phase.fraction),
            })
          : labels.working;
    return (
      <>
        <span className="spinner" aria-hidden="true" /> {text}
      </>
    );
  }

  const refused = status && !status.canStart && status.reason ? status : null;

  return (
    <div
      className={`upload-card${dragging ? ` ${styles.dragging}` : ""}`}
      id="upload"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = working ? "none" : "copy";
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) void upload(file);
      }}
    >
      <h3>{labels.title}</h3>
      <p className="label" id={HINT_ID}>
        {dragging ? t.upload.drop : labels.hint}
      </p>
      <input
        ref={input}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so choosing the same file again after an error still triggers a change.
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      <button
        type="button"
        className="button"
        disabled={working}
        aria-describedby={`${HINT_ID} ${STATUS_ID}`}
        onClick={() => input.current?.click()}
      >
        {buttonLabel()}
      </button>
      {phase.name === "sending" ? (
        <progress className={styles.progress} value={phase.fraction} max={1} />
      ) : null}
      <p className={styles.status} id={STATUS_ID} aria-live="polite">
        {phase.name === "preparing" ? t.upload.preparing : ""}
      </p>
      {refused?.reason ? (
        <p className={styles.note}>
          {liveStatusMessage(refused.reason, refused.resetAt, t.upload.status, t, lang)}
        </p>
      ) : null}
      {phase.name === "failed" ? (
        <p className="upload-error" role="alert">
          <span aria-hidden="true">⚠ </span>
          {uploadErrorMessage(phase.failure, t, lang, labels)}
        </p>
      ) : null}
    </div>
  );
}
