/**
 * The player's keyboard and position-slider rules, kept apart from the DOM so they can be tested.
 *
 * The slider "holds" while it has focus that did not come from a pointer press on it (Tab, a
 * screen reader moving focus), or once its own keys move it: during playback it then reports the
 * spot the viewer last set instead of following the film. A value that moves with the film is
 * spoken on every change (Orca: about 4 times a second), over the description. `:focus-visible`
 * cannot tell these apart: Chromium treats a screen reader's button press like a mouse click, so
 * focus it moves afterwards does not match. A pointer press on the slider lets the thumb follow the
 * film again.
 */

/** Arrow keys on the position slider move this far (Shift: five times as far). */
const SEEK_KEY_SECONDS = 1;
const SEEK_KEY_SHIFT_FACTOR = 5;
/** Page Up and Page Down move a tenth of the film, as a range input does on its own. */
const SEEK_PAGE_FRACTION = 0.1;

/**
 * Where a key on the position slider takes the film, counted from where the film is now (the
 * slider's own value may be a held, older spot), or null for a key the slider has no use for.
 * Not clamped; the player clamps to the film.
 */
export function seekKeyTarget(
  key: string,
  shift: boolean,
  now: number,
  duration: number,
): number | null {
  const step = SEEK_KEY_SECONDS * (shift ? SEEK_KEY_SHIFT_FACTOR : 1);
  const page = duration * SEEK_PAGE_FRACTION;
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return now - step;
    case "ArrowRight":
    case "ArrowUp":
      return now + step;
    case "PageDown":
      return now - page;
    case "PageUp":
      return now + page;
    case "Home":
      return 0;
    case "End":
      return duration;
    default:
      return null;
  }
}

/**
 * A value the slider took on its own while it showed a held spot: a screen reader's increment or
 * decrement, which steps from the value it reads. The same step is taken from where the film is
 * now. A value at either end is taken as it is.
 */
export function seekFromHold(next: number, held: number, now: number, duration: number): number {
  if (next <= 0 || next >= duration) return next;
  return now + (next - held);
}

/** What changes whether the slider holds, and where. */
export type SliderHoldEvent =
  | { type: "focus"; byPointer: boolean; at: number }
  | { type: "press" }
  | { type: "key"; at: number }
  | { type: "seek"; to: number }
  | { type: "resume"; at: number }
  | { type: "blur" };

/** The spot the slider holds (null: it follows the film), after one event. */
export function nextSliderHold(hold: number | null, event: SliderHoldEvent): number | null {
  switch (event.type) {
    case "focus":
      return event.byPointer ? null : event.at;
    case "press":
    case "blur":
      return null;
    case "key":
      // One of the slider's own keys (arrows, Page, Home, End), even after a click on it.
      return hold ?? event.at;
    case "seek":
    case "resume":
      // A seek the viewer made, or playing again after a pause, moves a hold to where the film is.
      return hold === null ? null : event.type === "seek" ? event.to : event.at;
  }
}

/** Where the slider stands: the held spot during playback, otherwise the film's position. */
export function sliderPosition(time: number, hold: number | null, playing: boolean): number {
  return playing && hold !== null ? hold : time;
}

/** The focused element, as far as the player's letter keys and Space care. */
export interface FocusedControl {
  tag: string;
  /** An input's type, e.g. "range". */
  type?: string;
  editable: boolean;
}

/**
 * Keys stay with the control that has focus: typing, native button activation. The position slider
 * keeps its arrow, Home, End and Page keys (it has no use for letters or Space), so Space, K, D and
 * E still reach the player from it, as the keys hint says.
 */
export function keyBelongsToControl(control: FocusedControl, key: string): boolean {
  if (control.editable) return true;
  if (control.tag === "INPUT" && control.type === "range") return false;
  if (control.tag === "INPUT" || control.tag === "TEXTAREA" || control.tag === "SELECT")
    return true;
  return (
    key === " " && (control.tag === "BUTTON" || control.tag === "A" || control.tag === "SUMMARY")
  );
}
