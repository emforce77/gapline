/**
 * The play / pause mark for the landing's seven seconds and the workspace player. Drawn rather than
 * typed: no web font in the stack has a heavy pause glyph (❚❚), so a typed one came from whatever
 * symbol font the system had.
 */
export function PlayIcon({ pause }: { pause: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true">
      {pause ? (
        <>
          <rect x="2" y="1" width="3" height="10" rx="0.5" />
          <rect x="7" y="1" width="3" height="10" rx="0.5" />
        </>
      ) : (
        <path d="M2.5 1.2v9.6a.5.5 0 0 0 .76.43l7.7-4.8a.5.5 0 0 0 0-.86l-7.7-4.8a.5.5 0 0 0-.76.43z" />
      )}
    </svg>
  );
}
