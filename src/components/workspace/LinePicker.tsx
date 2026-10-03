"use client";

import { useRef, useState } from "react";
import type { Cue } from "@/lib/pipeline/schemas";
import { CuePicker } from "./Timeline";

/**
 * The line list under the timeline. Arrow keys move through the closed list without opening each
 * line (Chromium fires a change per arrow press); Enter, or a choice from the open list, opens one.
 * Leaving the list puts it back on the open line. `describedBy` names the hint that says so.
 */
export function LinePicker({
  cues,
  lineNumbers,
  language,
  openCueId,
  disabled,
  describedBy,
  onOpen,
}: {
  cues: Cue[];
  lineNumbers: Map<string, number>;
  language: string;
  openCueId: string | null;
  disabled: boolean;
  describedBy: string;
  onOpen: (cueId: string) => void;
}) {
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
        describedBy={describedBy}
        onSelect={(id) => (keys.current ? setArrowedTo(id) : open(id))}
      />
    </div>
  );
}
