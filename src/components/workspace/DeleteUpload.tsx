"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";

export function DeleteUpload({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const copy = t.upload;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<"deleteBusy" | "deleteFailed" | null>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const question = useId();

  useEffect(() => {
    if (!confirming && restoreFocus.current) {
      openButton.current?.focus();
      restoreFocus.current = false;
    }
  }, [confirming]);

  function cancel() {
    setFailure(null);
    restoreFocus.current = true;
    setConfirming(false);
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (response.status === 204) {
        window.location.replace("/?deleted=1");
        return;
      }
      setFailure(response.status === 409 ? "deleteBusy" : "deleteFailed");
    } catch {
      setFailure("deleteFailed");
    }
    setBusy(false);
  }

  return (
    <div className="upload-management">
      <p className="label">{copy.private}</p>
      {confirming ? (
        <div
          className="remove-confirm"
          role="group"
          aria-labelledby={question}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !busy && !event.nativeEvent.isComposing) {
              event.preventDefault();
              cancel();
            }
          }}
        >
          <p id={question}>{copy.deleteQuestion}</p>
          <div className="remove-actions">
            <button type="button" className="button danger" disabled={busy} onClick={remove}>
              {busy ? (
                <>
                  <span className="spinner" aria-hidden="true" /> {copy.deleting}
                </>
              ) : (
                copy.deleteYes
              )}
            </button>
            <button
              type="button"
              className="button ghost"
              autoFocus
              disabled={busy}
              onClick={cancel}
            >
              {t.editor.remove.no}
            </button>
          </div>
          {busy && (
            <span className="sr-only" role="status">
              {copy.deleting}
            </span>
          )}
          {failure && (
            <p className="upload-error" role="alert">
              {copy[failure]}
            </p>
          )}
        </div>
      ) : (
        <button
          ref={openButton}
          type="button"
          className="button ghost"
          onClick={() => setConfirming(true)}
        >
          {copy.deleteOpen}
        </button>
      )}
    </div>
  );
}
