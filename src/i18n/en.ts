import { enEditor } from "./editor";

/** English UI strings. The Korean catalog must provide every key (checked by the Dictionary type). */
export const en = {
  meta: {
    title: "Scene — audio description that fits between the lines",
    description:
      "Scene makes audio description for film in one pass: each line is written for one silence, checked against Korea's published guideline, voiced, measured and mixed. An editor can still change any line.",
    project: "{title} — Scene",
  },
  nav: { home: "Scene", language: "한국어", skip: "Skip to content" },
  landing: {
    eyebrow: "Audio description for blind and low-vision viewers",
    title: "Descriptions that fit between the lines.",
    lede: "Scene makes audio description for film in one pass. Each line is written for one real silence, checked against Korea's published guideline, voiced and measured, and what the final check finds is fixed before the track is mixed. An editor can still change any line on the timeline.",
    ctaSample: "Open the sample",
    ctaUpload: "Try your own clip",
    seven: {
      label: "Tears of Steel, 54–60 s",
      title: "Seven seconds with no dialogue",
      body: "After “…locked.”, nobody speaks for seven seconds. A blind viewer hears no words, only a hum and music, then “This is pretty freaky.” Listen to both versions.",
      original: "Original sound",
      described: "With description",
      narration: "Narration",
      hidePicture: "Hide the picture",
      idle: "Press a button to play the seven seconds.",
      soundtrack: "No words here. Only the soundtrack.",
      waiting: "Silence. The next description starts in a moment.",
      pause: "Pause",
    },
    timelineTitle: "Narration may only speak where nobody else does.",
    timelineLede:
      "The sample's 65 seconds as Scene sees them. Every description is written for one silence, and its recorded voice has to end before the next line of dialogue.",
    timelineRows: {
      picture: "Picture",
      dialogue: "Dialogue",
      dialogueStat: "{n} stretches, {s}",
      room: "Room to speak",
      roomStat: "{n} silences, {s}",
      narration: "Narration",
      narrationStat: "{n} lines",
    },
    shortest: "shortest: {s}",
    sevenMark: "the seven seconds",
    timelineNote:
      "Silences come from the speech recognizer's word timings (Chirp 3), and each silence is then heard again on its own. That second listen found the opening launch call Chirp 3 had placed two seconds early, so no line lands on it.",
    flowTitle: "How a line gets made",
    flow: [
      {
        name: "Hear",
        detail: "Word timings for every line of dialogue",
        service: "Speech-to-Text · Chirp 3",
      },
      {
        name: "Watch",
        detail: "Places, people, on-screen text, key sounds",
        service: "Gemini 3.8 Flash",
      },
      {
        name: "Write",
        detail: "One line per silence, sized to fit it",
        service: "Gemini 3.8 Flash",
      },
      {
        name: "Review",
        detail: "Eight rules, each citing a guideline clause",
        loop: "rejected: rewritten from the reviewer's fix, up to twice",
        service: "Gemini 3.8 Flash",
      },
      {
        name: "Voice",
        detail: "The real audio is measured against its silence",
        loop: "too long: speed up, shorten or drop",
        service: "Text-to-Speech · Chirp 3 HD",
      },
      {
        name: "Mix",
        detail:
          "A final check finds what is missing, Scene fills it, then the film ducks under each line",
        service: "FFmpeg on Cloud Run",
      },
    ],
    rejectionTitle: "Every rejection cites a clause",
    rejectionLede:
      "The line at {time} in the sample, exactly as the run log recorded it. The writer and the reviewer are the same model with separate instructions.",
    rejection: {
      step: {
        write: "First draft",
        revise: "Rewrite",
        shorten: "Shortened",
        add: "Added for coverage",
        human: "Editor's version",
        remove: "Removed by editor",
      },
      rejected: "Rejected",
      passed: "Passed review",
      suggestion: "Reviewer's suggestion",
      dropped:
        "Still breaking a rule after two rewrites, so Scene dropped the line instead of voicing it, and the final check listed what it missed.",
      fitted: "Voiced in {spoken} of the {room} available",
      human: "Scene reviews and voices an editor's words, but never rewrites them.",
    },
    rulesSummary: "All {n} review rules and where they come from",
    measuredTitle: "Measured on the sample",
    measuredRun:
      "One full {language} run of the 65-second clip cost {cost} in API calls and took {time}. {fit} of {shipped} lines landed inside their silence, with {overlap} of narration over the speech Chirp 3 recognized.",
    measuredEdit: "The editor's one-line fix afterwards cost {cost} and took {time}.",
    measuredNote: "API cost only; Cloud Run and storage are not included.",
    whyTitle: "The law is moving faster than description can be made.",
    why: [
      {
        figure: "3 Sep 2026",
        text: "After a ten-year lawsuit, Korea's Supreme Court confirmed that the three big cinema chains discriminate when films lack audio description and captions.",
        source: "Supreme Court of Korea, case 2022다203507",
      },
      {
        figure: "−54%",
        text: "Korea's 2026 subsidy for described, captioned and signed TV fell from ₩7.76B to ₩3.58B while duties widened to streaming.",
        source: "Korea Blind Union statement, 13 Mar 2026",
      },
      {
        figure: "3 months",
        text: "What one accessible Korean film still takes: about ten specialists and ₩14M (≈US$10k), for description and captions together.",
        source: "Barrier-Free Film Committee FAQ (undated); 2019 interview",
      },
    ],
    uploadIntro:
      "Clips up to 90 seconds and 30 MB. Preparing a clip takes under a minute; generating its description takes a few minutes more and calls paid Google Cloud and Gemini APIs, within a daily allowance shared by every visitor. Only the browser that uploaded a clip can open it.",
    uploadTitle: "Your clip",
    uploadHint:
      "MP4, MOV or WebM, up to 30 MB and 90 seconds. Drop the file here or choose it. Generating {language} narration for the 65-second sample took {time} and cost {cost}.",
    uploadChoose: "Choose a video",
    uploadWorking: "Preparing the clip…",
    uploadTooLong: "This clip is longer than 90 seconds. Trim it to one scene and try again.",
    uploadFailed: "Scene could not read this video. Export it again as MP4 (H.264) and try again.",
    footerFilm:
      "Sample film: Tears of Steel, (CC) Blender Foundation | mango.blender.org, CC BY 3.0.",
    footerGuides:
      "Guidelines: KMCC Accessible Broadcasting Guideline (2019), Netflix Audio Description Style Guide v2.5.",
  },
  upload: {
    drop: "Drop the video to upload it.",
    checking: "Checking the file…",
    uploading: "Uploading, {percent}",
    preparing: "Converting and measuring the clip. This usually takes under a minute.",
    errors: {
      too_large:
        "This file is {size}; Scene takes up to {max}. Export it at 720p, or trim it to one scene, and try again.",
      too_long:
        "This clip runs {length}; Scene takes up to {max}. Trim it to one scene and try again.",
      not_video: "That file is not a video. Choose an MP4, MOV or WebM file.",
      no_video_stream:
        "This file has sound but no picture. Scene describes what is on screen, so it needs a video.",
      missing_file: "No file arrived. Choose the video again.",
      forbidden:
        "The upload was refused because it did not come from this page. Reload the page and try again.",
      internal:
        "Something broke on our side while preparing the clip. Try again in a minute, or try another file.",
      network: "The upload did not reach Scene. Check your connection and try again.",
      unexpected: "Scene answered with an error (HTTP {status}). Try again in a minute.",
    },
    status: {
      budget_busy:
        "Another visitor's description is being made right now. You can upload now; generating may have to wait a few minutes.",
      budget_daily:
        "Today's live allowance is used up. You can upload now and generate after it renews; the sample's recorded results play any time.",
    },
  },
  live: {
    leaveNote: "If the connection drops, reload this page to pick the run up again.",
    lost: "The connection dropped, but the run keeps going on the server. Checking on it every few seconds…",
    following: "Following the run you started. Checking on it every few seconds…",
    active: "You started a description in {language} at {time}. It is still being made.",
    follow: "Follow it",
    unreachable:
      "Scene cannot be reached. Check your connection, then reload this page to see how the run ended.",
    interrupted:
      "The run stopped without finishing, so no result was saved. You can generate again.",
    notStarted: "The run did not start. Try again.",
    notFound: "That run is not here. It may belong to another browser.",
    loadFailed: "This result could not be loaded. Reload the page.",
    renews: "It renews at {time} ({wait}).",
    reference: "Reference: {runId}.",
    littleRoom:
      "This clip has {room} without speech; Scene needs at least {needed} to describe much. Descriptions only go where nobody speaks, so constant dialogue or voice-over leaves few or no lines. A scene with pauses works better.",
    status: {
      budget_busy:
        "Another visitor's description is being made right now. A new one can start when it finishes, usually within a few minutes.",
      budget_daily: "Today's live allowance is used up; the sample's finished results still play.",
    },
    errors: {
      budget_busy:
        "Another visitor's description is being made, and today's allowance covers one at a time. Try again in a few minutes.",
      budget_daily: "Today's live allowance is used up; the sample's finished results still play.",
      run_allowance:
        "This run reached its spending cap and stopped, so nothing was saved. A shorter clip needs less.",
      provider_busy: "The model is overloaded right now. Try again in a minute or two.",
      provider_failed:
        "The model service refused the request, so the run stopped. The problem is on our side; try again later.",
      model_output:
        "The model's answer came back in the wrong shape, so the run stopped instead of guessing. Trying again usually works.",
      speech_failed:
        "Google Speech-to-Text could not process this clip's sound. Try again; if it fails twice, try another clip.",
      voice_failed: "Google Text-to-Speech failed while voicing the lines. Try again in a minute.",
      media_failed:
        "Mixing the narration into the video failed. Try again; if it fails twice, try another clip.",
      internal: "Something broke on our side and the run stopped. Try again.",
      forbidden:
        "The request was refused because it did not come from this page. Reload the page and try again.",
      not_found: "This clip is not here any more. Reload the page.",
      invalid_request: "The request was not understood. Reload the page and try again.",
      connection:
        "Scene could not be reached, so the run did not start. Check your connection and try again.",
      unknown: "The run stopped before finishing. Try again.",
    },
  },
  notFound: {
    metaTitle: "Page not found — Scene",
    title: "This page is not here.",
    body: "Uploaded clips are private to the browser that uploaded them. A link opened on another device, or shared with someone else, ends up here.",
    sample: "Open the sample",
    home: "Back to Scene",
  },
  failure: {
    title: "Something broke while opening this clip.",
    body: "The error was logged in your browser console.",
    retry: "Try again",
  },
  workspace: {
    narration: "Narration",
    density: "Density",
    densityStandard: "Standard",
    densityBrief: "Brief",
    generate: "Generate",
    regenerate: "Generate again",
    generating: "Generating…",
    liveNote: "A live run calls paid APIs and takes a few minutes. The recorded result stays.",
    replay: "Replay the run",
    replaying: "Replaying at {speed}× speed",
    stopReplay: "Stop replay",
    noRun: "No {language} track at this density yet.",
    noRunHint:
      "Generating {language} narration for the 65-second sample took {time} and cost {cost}.",
    adOn: "Description on",
    adOff: "Description off",
    eyesClosed: "Eyes closed",
    eyesOpen: "Eyes open",
    listening: "Listening",
    play: "Play",
    playDescribed: "Play with description",
    pause: "Pause",
    keys: "Keys: Space play · D description · E eyes closed",
    captionIdle: "Narration shows here while it speaks.",
    dialogue: "Dialogue",
    downloads: "Downloads",
    downloadDescribed: "Described film (MP4)",
    downloadNarration: "Narration stem (WAV)",
    downloadVtt: "Text track (WebVTT)",
    downloadScript: "Script and review log (JSON)",
    notRecorded: "not recorded for this older result",
    selected: "{line} selected",
    stageAnnounce: "{stage}: {state}",
  },
  versions: {
    original: "Original",
    edit: "Edit {n}",
    restored: "{line} restored",
    changed: "{line} changed",
    removed: "{line} removed",
    basedOn:
      "Edited from “{parent}”. {line} was written by a person and re-voiced; every other line is reused as it was.",
    basedOnRemoved:
      "Edited from “{parent}”. An editor removed {line}; every other line is reused as it was, and the final check ran again on what remains.",
  },
  timeline: {
    picture: "Picture",
    dialogue: "Dialogue",
    room: "Room to speak",
    narration: "Narration",
    seconds: "{n} s",
    relistenSpeech: "Dialogue found on re-listen, {from} to {to}: {text}",
  },
  stages: {
    hear: "Hear",
    relisten: "Re-listen to each silence",
    watch: "Watch",
    gaps: "Find room",
    write: "Write",
    review: "Review",
    voice: "Voice",
    verify: "Check final output",
    fix: "Fix what the check found",
    mix: "Mix",
    waiting: "Waiting",
    reused: "reused from the first run",
    running: "Working · {elapsed}",
    done: "{seconds} s",
    doneState: "done",
    runningState: "working",
    relistenFound: "Silences: {gaps} · words heard: {words} · room closed: {blocked}",
    relistenQuiet: "Silences: {gaps} · no words heard",
  },
  line: {
    title: "Line {n}",
    cueLabel: "{line}, {time}, {state}",
    state: {
      fits: "fits its silence",
      approved: "passed review",
      rejected: "rejected by the reviewer",
      dropped: "dropped",
      removed: "removed by editor",
      pending: "in progress",
    },
    room: "Room",
    spoken: "Spoken",
    rate: "Speed {rate}×",
    fits: "Fits its silence",
    voiced: "Voiced: {seconds} at {rate}×",
    tooLong: "longer than its {room} room",
    history: "How this line was made",
    by: {
      write: "Drafted",
      revise: "Rewritten",
      shorten: "Shortened",
      add: "Added for coverage",
      human: "Edited by a person",
      remove: "Removed by editor",
    },
    sameWords: "Same words as v{n}",
    moved: "Start moved from {from} to {to}",
    passed: "Passed review",
    rejected: "Rejected",
    fix: "Fix",
    dropped: {
      no_room: "Dropped: no room to speak it",
      invalid_placement: "Rejected: start is outside the named gap",
      unchanged: "Rejected: the words did not change",
      review: "Dropped: still broke a rule after rewriting",
      too_long: "Dropped: too long for its silence even after shortening",
    },
    verdict: {
      firstPass: "Passed review on the first draft",
      rejectedOnce: "Rejected once",
      rejectedTwice: "Rejected twice",
      rejectedMany: "Rejected {n} times",
      byEditor: "then fixed by an editor",
      sameWords: "then passed with the same words",
      rewritten: "then passed after a rewrite",
      shortened: "shortened to fit",
    },
    evidence: "Scene notes from the model (not narrated)",
    pickHint:
      "Select a narration line on the timeline to see how it was written, reviewed and voiced.",
    play: "Play from here",
    close: "Back to the run",
  },
  metrics: {
    lines: "lines voiced",
    fit: "fit their silence",
    overlap: "narration over recognized speech",
    caught: "sent back by a check",
    cost: "API cost",
    time: "processing time",
  },
  editor: enEditor,
  coverage: { title: "Reviewer found missing" },
} as const;

type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Widen<U>[]
    : T extends object
      ? { [K in keyof T]: Widen<T[K]> }
      : T;

export type Dictionary = Widen<typeof en>;
