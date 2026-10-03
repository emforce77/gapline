"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { dictionary, fill, type UiLang } from "@/i18n";
import type { LiveStatus } from "@/lib/api-contract";
import {
  readUploadResponse,
  uploadErrorMessage,
  uploadStatusNotice,
  type UploadFailure,
} from "@/lib/client/api-errors";
import { fetchLiveStatus } from "@/lib/client/run-stream";
import {
  checkClipFile,
  readVideoSeconds,
  sendClip,
  UploadCancelledError,
  UploadNetworkError,
} from "@/lib/client/upload";
import styles from "./UploadCard.module.css";

type Phase =
  | { name: "idle" }
  | { name: "checking" }
  | { name: "sending"; fraction: number }
  | { name: "preparing" }
  | { name: "cancelled" }
  | { name: "failed"; failure: UploadFailure };

const HINT_ID = "upload-hint";
const STATUS_ID = "upload-status";
/** A screen reader hears the upload's progress in quarters, not on every progress event. */
const ANNOUNCED_STEPS = 4;

/**
 * Picks or receives (drag and drop) a short video, checks it against the upload limits, uploads it
 * with progress and opens its workspace. Warns up front when a live run could not start right now.
 *
 * While the bytes are on their way the upload can be cancelled, and leaving the page asks first.
 * Once they have arrived the server is converting the clip and will answer with the cookie that
 * makes the visitor its owner, so the request is never cut then: a card that unmounts lets it
 * finish and only skips opening the workspace.
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
  const choose = useRef<HTMLButtonElement>(null);
  // Set while the bytes are being sent; cleared once they have all arrived.
  const sending = useRef<AbortController | null>(null);
  const unmounted = useRef(false);
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

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      sending.current?.abort();
    };
  }, []);

  // Reloading, closing the tab or typing another address would lose the upload; the browser asks.
  useEffect(() => {
    if (!working) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [working]);

  async function upload(file: File) {
    if (working) return;
    setPhase({ name: "checking" });
    const early = checkClipFile(file, null);
    const refusal = early ?? checkClipFile(file, await readVideoSeconds(file));
    if (unmounted.current) return;
    if (refusal) {
      setPhase({ name: "failed", failure: refusal });
      return;
    }
    setPhase({ name: "sending", fraction: 0 });
    const controller = new AbortController();
    sending.current = controller;
    let response;
    try {
      response = await sendClip(
        file,
        (fraction) => {
          if (fraction === 1) sending.current = null;
          setPhase(fraction < 1 ? { name: "sending", fraction } : { name: "preparing" });
        },
        controller.signal,
      );
    } catch (error) {
      if (error instanceof UploadCancelledError) {
        if (!unmounted.current) setPhase({ name: "cancelled" });
        return;
      }
      if (!(error instanceof UploadNetworkError)) throw error;
      console.error("upload failed", error);
      setPhase({ name: "failed", failure: { code: "network" } });
      return;
    } finally {
      sending.current = null;
    }
    // The visitor moved on while the clip was converting; the answer still set the owner cookie.
    if (unmounted.current) return;
    const result = readUploadResponse(response, file.size);
    if ("id" in result) {
      router.push(`/p/${result.id}`);
      return;
    }
    console.warn(`upload refused: HTTP ${response.status} ${result.code}`);
    setPhase({ name: "failed", failure: result });
  }

  function cancel() {
    sending.current?.abort();
    // The Cancel button goes away with the upload; focus stays in the card.
    choose.current?.focus();
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

  // The shared allowance, or this visitor's own run or daily share, as the workspace names it.
  const refused = status ? uploadStatusNotice(status, t, lang) : null;
  const percent = (fraction: number) =>
    new Intl.NumberFormat(lang, { style: "percent" }).format(fraction);
  // The polite region speaks each change; the button and the bar already show the exact figure.
  const progressSpoken =
    phase.name === "checking"
      ? t.upload.checking
      : phase.name === "sending"
        ? fill(t.upload.uploading, {
            percent: percent(Math.floor(phase.fraction * ANNOUNCED_STEPS) / ANNOUNCED_STEPS),
          })
        : "";

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
        {dragging ? (
          t.upload.drop
        ) : (
          <>
            {/* Dragging a file needs a mouse; a touch screen hides this sentence (tokens.css). */}
            <span className="pointer-hint">{t.upload.dropHint} </span>
            {labels.hint}
          </>
        )}
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
      <div className={styles.actions}>
        {/* aria-disabled rather than disabled: a disabled button would drop keyboard focus to the
            page, and after a refusal the alert below is read where focus already is. */}
        <button
          ref={choose}
          type="button"
          className={`button ${styles.choose}`}
          aria-disabled={working || undefined}
          // The visible percent changes on every progress event; a focused button's name change is
          // read out, so while sending the name stays fixed and the polite region counts quarters.
          aria-label={phase.name === "sending" ? t.upload.sendingName : undefined}
          aria-describedby={`${HINT_ID} ${STATUS_ID}`}
          onClick={() => {
            if (!working) input.current?.click();
          }}
        >
          {buttonLabel()}
        </button>
        {phase.name === "sending" ? (
          <button type="button" className="button ghost" onClick={cancel}>
            {t.upload.cancel}
          </button>
        ) : null}
      </div>
      {phase.name === "sending" ? (
        <progress
          className={styles.progress}
          value={phase.fraction}
          max={1}
          aria-label={t.upload.progressLabel}
        />
      ) : null}
      <p className="sr-only" aria-live="polite">
        {progressSpoken}
      </p>
      <p className={styles.status} id={STATUS_ID} aria-live="polite">
        {phase.name === "preparing"
          ? t.upload.preparing
          : phase.name === "cancelled"
            ? t.upload.cancelled
            : ""}
      </p>
      {refused ? <p className={styles.note}>{refused}</p> : null}
      {phase.name === "failed" ? (
        <p className="upload-error" role="alert">
          <span aria-hidden="true">⚠ </span>
          {uploadErrorMessage(phase.failure, t, lang, labels)}
        </p>
      ) : null}
    </div>
  );
}
