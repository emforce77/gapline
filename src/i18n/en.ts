/** English UI strings. The Korean catalog must provide every key (checked by the Dictionary type). */
export const en = {
  meta: {
    title: "Scene — audio description that fits between the lines",
    description:
      "Scene finds the silences in a film, describes what is on screen for blind viewers, checks every line against published guidelines and mixes a narrated track.",
  },
  nav: { home: "Scene", language: "한국어" },
  landing: {
    eyebrow: "Audio description for blind and low-vision viewers",
    title: "Descriptions that fit between the lines.",
    lede: "Scene finds the silences in a film, describes what is on screen, checks every line against published broadcast guidelines, and mixes a narrated track.",
    ctaSample: "Hear the sample",
    ctaUpload: "Describe your own clip",
    sampleLabel: "Sample film",
    sampleReady: "Korean and English tracks ready",
    uploadTitle: "Your clip",
    uploadHint:
      "MP4, MOV or WebM, up to 90 seconds. The 65-second sample took {time} and cost {cost}.",
    uploadChoose: "Choose a video",
    uploadWorking: "Preparing the clip…",
    uploadTooLong: "The clip is longer than 90 seconds.",
    uploadFailed: "That file could not be read as a video.",
    howTitle: "How a line gets made",
    how: [
      {
        name: "Hear",
        detail: "Speech-to-Text (Chirp 3) times every spoken word.",
        service: "Google Cloud Speech-to-Text",
      },
      {
        name: "Watch",
        detail: "Gemini watches the clip: places, people, on-screen text, key sounds.",
        service: "Gemini 3.8 Flash",
      },
      {
        name: "Find room",
        detail:
          "The silences between lines of dialogue become the only places narration may speak.",
        service: "deterministic",
      },
      {
        name: "Write",
        detail: "Gemini drafts each line for the room it has, in Korean or English.",
        service: "Gemini 3.8 Flash",
      },
      {
        name: "Review",
        detail:
          "A second Gemini pass checks every line against guideline clauses and sends failures back.",
        service: "Gemini 3.8 Flash",
      },
      {
        name: "Voice & mix",
        detail:
          "Chirp 3 HD speaks each line; its measured length decides speed-up, shortening or drop. The film ducks under it.",
        service: "Cloud Text-to-Speech",
      },
    ],
    whyTitle: "Why now",
    why: [
      {
        figure: "3 Sep 2026",
        text: "Korea's Supreme Court widened cinemas' duty to offer audio description.",
      },
      {
        figure: "Jun 2025",
        text: "The European Accessibility Act started to require it for streaming services.",
      },
      {
        figure: "₩14M",
        text: "What one barrier-free Korean film costs today, because every line is written, voiced and synced by hand.",
      },
    ],
    measuredTitle: "Measured on the sample",
    measured: {
      clip: "clip",
      cost: "per run",
      time: "processing",
      fit: "lines fit their silence",
      overlap: "over dialogue",
    },
    rulesTitle: "Every rejection cites a clause",
    rulesLede:
      "The reviewer's rules come from published guidelines, so an editor can check each decision.",
    footerFilm:
      "Sample film: Tears of Steel, (CC) Blender Foundation | mango.blender.org, CC BY 3.0.",
    footerGuides:
      "Guidelines: KMCC Accessible Broadcasting Guideline (2019), Netflix Audio Description Style Guide v2.5.",
  },
  workspace: {
    back: "All clips",
    narration: "Narration",
    density: "Density",
    densityStandard: "Standard",
    densityBrief: "Brief",
    generate: "Generate",
    regenerate: "Generate again",
    generating: "Generating…",
    replay: "Replay the run",
    replaying: "Replaying at {speed}× speed",
    stopReplay: "Stop replay",
    noRun: "No {language} track at this density yet.",
    noRunHint: "Generating the 65-second sample took {time} and cost {cost}.",
    adOn: "Description on",
    adOff: "Description off",
    eyesClosed: "Eyes closed",
    eyesOpen: "Eyes open",
    listening: "Listening",
    play: "Play",
    pause: "Pause",
    downloads: "Downloads",
    downloadDescribed: "Described film (MP4)",
    downloadNarration: "Narration stem (WAV)",
    downloadVtt: "Text track (WebVTT)",
    downloadScript: "Script and review log (JSON)",
    budgetExhausted: "Today's live allowance is used up. Recorded tracks remain playable.",
    runFailed: "The run stopped: {error}",
  },
  timeline: {
    picture: "Picture",
    dialogue: "Dialogue",
    room: "Room to speak",
    narration: "Narration",
    seconds: "{n} s",
  },
  stages: {
    hear: "Hear",
    watch: "Watch",
    gaps: "Find room",
    write: "Write",
    review: "Review",
    voice: "Voice",
    mix: "Mix",
    waiting: "Waiting",
    reused: "reused from the first run",
    running: "Working · {elapsed}",
    done: "{seconds} s",
  },
  line: {
    title: "Line {id}",
    room: "Room",
    spoken: "Spoken",
    rate: "Speed {rate}×",
    fits: "Fits its silence",
    history: "How this line was made",
    by: { write: "Drafted", revise: "Rewritten", shorten: "Shortened", add: "Added for coverage" },
    passed: "Passed review",
    rejected: "Rejected",
    fix: "Fix",
    dropped: {
      no_room: "Dropped: no room to speak it",
      review: "Dropped: still broke a rule after rewriting",
      too_long: "Dropped: too long for its silence even after shortening",
    },
    pickHint:
      "Select a narration line on the timeline to see how it was written, reviewed and voiced.",
    play: "Play from here",
    close: "Back to the run",
  },
  metrics: {
    lines: "lines",
    fit: "fit their silence",
    overlap: "over dialogue",
    caught: "caught and fixed",
    cost: "cost",
    time: "time",
  },
  coverage: { title: "Reviewer found missing", added: "added" },
} as const;

type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Widen<U>[]
    : T extends object
      ? { [K in keyof T]: Widen<T[K]> }
      : T;

export type Dictionary = Widen<typeof en>;
