"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/** Picks a short video, uploads it and opens its workspace. */
export function UploadCard({
  labels,
}: {
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
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");

  async function upload(file: File) {
    setState("working");
    const body = new FormData();
    body.append("video", file);
    try {
      const response = await fetch("/api/projects", { method: "POST", body });
      const result = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !result.id) {
        setState("error");
        setMessage(result.error === "too_long" ? labels.tooLong : labels.failed);
        return;
      }
      router.push(`/p/${result.id}`);
    } catch (error) {
      console.error("upload failed", error);
      setState("error");
      setMessage(labels.failed);
    }
  }

  return (
    <div className="upload-card" id="upload">
      <h3>{labels.title}</h3>
      <p className="label">{labels.hint}</p>
      <input
        ref={input}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button
        type="button"
        className="button"
        disabled={state === "working"}
        onClick={() => input.current?.click()}
      >
        {state === "working" ? (
          <>
            <span className="spinner" /> {labels.working}
          </>
        ) : (
          labels.choose
        )}
      </button>
      {state === "error" ? (
        <p className="upload-error" role="alert">
          ⚠ {message}
        </p>
      ) : null}
    </div>
  );
}
