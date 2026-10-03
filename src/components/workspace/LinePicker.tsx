"use client";

import { useId, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { Cue } from "@/lib/pipeline/schemas";
import { CuePicker } from "./Timeline";

/**
 * The line list under the timeline. Arrow keys move through the closed list without opening each
 * line (Chromium fires a change per arrow press); Enter, or a choice from the open list, opens one.
 * Leaving the list puts it back on the open line. The list is described by its own hidden copy of
 * the hint that says so: the visible hint leaves the page while a line is open, and a description
 * must not point at an element that is gone.
 */
export function LinePicker({
  cues,
  lineNumbers,
  language,
  openCueId,
  disabled,
  onOpen,
}: {
  cues: Cue[];
  lineNumbers: Map<string, number>;
  language: string;
  openCueId: string | null;
  disabled: boolean;
  onOpen: (cueId: string) => void;
}) {
  const { t } = useI18n();
  const hint = useId();
  // The line the list shows while the viewer arrows through it, before they open one.
  const [arrowedTo, setArrowedTo] = useState<string | null>(null);
  // Set by a key press in the list, so the change it causes only moves the list.
  const keys = useRef(false);
  const open = (id: string) => {
    setArrowedTo(null);
    onOpen(id);
  };
  return (
    <div
      style={{ display: "contents" }}
      onKeyDownCapture={(event) => {
        if (event.key === "Enter") {
          const value = (event.target as HTMLSelectElement).value;
          if (!value) return;
          event.preventDefault();
          open(value);
          return;
        }
        keys.current = event.key !== "Tab";
      }}
      onKeyUpCapture={() => {
        keys.current = false;
      }}
      onBlurCapture={() => setArrowedTo(null)}
    >
      <CuePicker
        cues={cues}
        lineNumbers={lineNumbers}
        language={language}
        selectedCueId={arrowedTo ?? openCueId}
        disabled={disabled}
        describedBy={hint}
        onSelect={(id) => (keys.current ? setArrowedTo(id) : open(id))}
      />
      <p id={hint} hidden>
        {t.line.pickHint} {t.line.pickHintKeys}
      </p>
    </div>
  );
}
