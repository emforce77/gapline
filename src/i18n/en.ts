import { enEditor } from "./editor";

/** English UI strings. The Korean catalog must provide every key (checked by the Dictionary type). */
export const en = {
  meta: {
    title: "Gapline — audio description that fits between the lines",
    description:
      "Gapline writes audio description for blind and low-vision viewers that fits the silences between lines of dialogue, then checks, voices and mixes it.",
    project: "{title} — Gapline",
  },
  nav: { home: "Gapline", language: "한국어", skip: "Skip to content" },
  landing: {
    eyebrow: "Audio description for blind and low-vision viewers",
    title: "Descriptions that fit between the lines.",
    lede: "One press of Generate runs every step: Gapline writes each line to fit a real silence, checks it against Korea's published guideline, voices and measures it, rewrites any line its final check rejects, and mixes the track. Want different words? You can still edit any line; Gapline re-voices just that one and checks the track again.",
    ctaSample: "Open the sample",
    ctaUpload: "Try your own clip",
    seven: {
      /** {from} and {to} are the whole seconds of the window the player plays (page.tsx). */
      label: "Tears of Steel, {from}–{to} s",
      title: "Seven seconds with no dialogue",
      body: "After “…locked,” nobody speaks for seven seconds. A blind viewer hears no words, only a hum, then “This is pretty freaky.” Listen to both versions.",
      original: "Original sound",
      described: "With description",
      narration: "Narration",
      hidePicture: "Eyes closed",
      idle: "Press a button to play the seven seconds.",
      soundtrack: "No words here. Only the soundtrack.",
      waiting: "Silence. The next description starts in a moment.",
      quiet: "Silence until the next line of dialogue.",
      loading: "Loading…",
      paused: "Paused.",
      ended: "Finished. Press a button to play the seven seconds again.",
      failed: "The sound didn't load. Press the button again to retry.",
      pause: "Pause",
    },
    timelineTitle: "Narration may only speak where nobody else does.",
    timelineLede:
      "The sample's 65 seconds as Gapline sees them. Every description is written for one silence, and its measured voice has to end before the next line of dialogue.",
    timelineRows: {
      picture: "Picture",
      dialogue: "Dialogue",
      dialogueStat: "{n} stretches, {s}",
      room: "Usable silence",
      roomStat: "{n} silences, {s}",
      narration: "Narration",
      narrationStat: "{n} lines",
    },
    shortest: "shortest: {s}",
    sevenMark: "the seven seconds",
    timelineNote:
      "Silences come from the speech recognizer's word timings (Chirp 3), and each silence is then heard again on its own. That second listen caught the opening launch call, which the recognizer had placed two seconds early, so no line is placed over it.",
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
        detail: "Each line written for one silence, sized to fit it",
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
        name: "Final check and mix",
        detail:
          "A final check reviews the whole voiced track, then the film's sound is lowered under each line",
        loop: "rewrites a line the final check rejects; may add one where a silence is still free",
        service: "Gemini 3.8 Flash · FFmpeg on Cloud Run",
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
      sentBack: "Rejected by the final check",
      passed: "Passed review",
      suggestion: "Suggested fix",
      /** What became of a rejected version, by who made the next one. */
      next: {
        revise: "Gapline rewrote the line from this suggestion and reviewed it again.",
        final:
          "This draft had passed review and been voiced. The final check, which reviews the whole voiced track, rejected it, so Gapline rewrote the line from the suggestion.",
        human:
          "Its rewrites still broke a rule, so Gapline dropped the line instead of voicing it. The next version was written by hand.",
      },
      fitted: "Voiced in {spoken} of the {room} available",
      human: "Gapline reviews and voices an editor's words, but never rewrites them.",
    },
    rulesSummary: "All {n} review rules and where they come from",
    measuredTitle: "Measured on the sample",
    measuredRun:
      "One {language} run of the 65-second clip cost {cost} in API calls and took {time}. {fit} of {shipped} lines landed inside their silence, with {overlap} of narration over recognized speech.",
    measuredEdit: "Changing this line by hand afterwards cost {cost} and took {time}.",
    measuredReused:
      "Hearing and watching were reused from an earlier run of this clip, so their cost and time are not included.",
    measuredNote: "API cost only; Cloud Run and storage are not included.",
    whyTitle: "The law is moving faster than description can be made.",
    why: [
      {
        figure: "3 Sep 2026",
        text: "After a ten-year lawsuit, Korea's Supreme Court confirmed that the three big cinema chains discriminate when films lack audio description and captions.",
        sources: [
          {
            label: "Supreme Court of Korea, case 2022Da203507 (press release, in Korean)",
            url: "https://www.scourt.go.kr/portal/news/NewsViewAction.work?gubun=6&seqnum=3044&type=0",
          },
        ],
      },
      {
        figure: "3 months",
        text: "What one accessible Korean film still takes: about ten specialists and ₩14M (≈US$10k), for description and captions together.",
        sources: [
          {
            label: "Barrier-Free Film Committee FAQ (undated, in Korean)",
            url: "https://barrierfreefilms.or.kr/board_hrgp25/682",
          },
          {
            label: "2019 interview (archived, in Korean)",
            url: "https://web.archive.org/web/20260511062907/https://futurechosun.com/archives/43832",
          },
        ],
      },
    ],
    whyClose:
      "Gapline is built for that gap: one press of Generate writes, checks, voices and mixes a description track that fits the film's own silences.",
    uploadIntro:
      "Clips up to 90 seconds and 30 MB. Preparing a clip takes under a minute; generating its description usually takes 2–6 minutes, longer for a long or busy clip, and calls paid Google Cloud and Gemini APIs, within a daily allowance shared by every visitor. Only the browser that uploaded a clip can open it.",
    uploadTitle: "Your clip",
    uploadHint:
      "MP4, MOV or WebM, 3 to 90 seconds and up to 30 MB. Drop the file here or choose it. Generating {language} narration for the 65-second sample took {time} and cost {cost}.",
    uploadChoose: "Choose a video",
    uploadWorking: "Preparing the clip…",
    uploadTooLong: "This clip is longer than 90 seconds. Trim it to one scene and try again.",
    uploadFailed:
      "Gapline could not read this video. Export it again as MP4 (H.264) and try again.",
    /** Each {name} becomes a link labelled by footerLinks (page.tsx). */
    footerFilm: "Sample film: Tears of Steel, (CC) Blender Foundation | {site}, {license}.",
    footerGuides: "Guidelines: {kmcc}; {netflix}.",
    footerSource: "Source code, method and demo film: {repo}.",
    footerLinks: {
      repo: "github.com/emforce77/gapline",
      site: "mango.blender.org",
      license: "CC BY 3.0",
      kmcc: "Korea Communications Commission (now the Korea Media and Communications Commission, KMCC), Guidelines for Providing Accessible Broadcast Programs (2019, PDF in Korean)",
      netflix: "Netflix Audio Description Style Guide v2.5",
    },
  },
  upload: {
    drop: "Drop the video to upload it.",
    checking: "Checking the file…",
    uploading: "Uploading, {percent}",
    /** The progress bar's accessible name. */
    progressLabel: "Upload progress",
    /** The Choose button's accessible name while sending: fixed, so a screen reader does not read
     *  every percent the button shows; the polite region announces the progress in quarters. */
    sendingName: "Uploading…",
    cancel: "Cancel upload",
    cancelled: "Upload cancelled.",
    preparing: "Converting and measuring the clip. This usually takes under a minute.",
    errors: {
      too_large:
        "This file is {size}; Gapline takes up to {max}. Export it at 720p, or trim it to one scene, and try again.",
      too_long:
        "This clip runs {length}; Gapline takes clips up to 90 seconds. Trim it to one scene and try again.",
      too_short:
        "This clip is shorter than 3 seconds, or is a single picture. Gapline needs a scene of at least 3 seconds to find a pause to describe.",
      not_video: "That file is not a video. Choose an MP4, MOV or WebM file.",
      no_video_stream:
        "This file has sound but no picture. Gapline describes what is on screen, so it needs a video.",
      missing_file: "No file arrived. Choose the video again.",
      forbidden:
        "The upload was refused because it did not come from this page. Reload the page and try again.",
      internal:
        "Something broke on our side while preparing the clip. Try again in a minute, or try another file.",
      network: "The upload did not reach Gapline. Check your connection and try again.",
      unexpected: "Gapline answered with an error (HTTP {status}). Try again in a minute.",
    },
    status: {
      budget_busy:
        "Descriptions other visitors started hold the rest of today's allowance right now. You can upload now; generating can start when one of them finishes, and runs usually take 2–6 minutes.",
      budget_daily:
        "Today's live allowance is used up. You can upload now and generate after it renews; the sample's recorded results play any time.",
    },
  },
  live: {
    leaveNote: "If the connection drops, reload this page to pick the run up again.",
    lost: "The connection dropped, but the run keeps going on the server. Checking on it every few seconds…",
    following: "Following the run you started. Checking on it every few seconds…",
    elapsed: "Running for {elapsed}. Most runs take 2–6 minutes; long or busy clips take longer.",
    confirming:
      "The connection dropped as the run was starting. Checking whether it began on the server…",
    active: "You started a {density} description in {language} at {time}. It is still being made.",
    follow: "Follow it",
    unreachable:
      "Gapline stopped answering, so this page stopped checking on the run. It may still finish on the server: check again once you are back online, or reload this page later.",
    checkAgain: "Check again",
    interrupted:
      "The run stopped without finishing, so no result was saved. You can generate again.",
    notStarted: "The run did not start. Try again.",
    /** A start whose answer was lost, after the page looked for the run it may have begun. */
    notStartedChecked:
      "Gapline did not answer, and no new run of yours has appeared, so it most likely did not start. Check your connection and try again.",
    notFound: "That run is not here. It may belong to another browser.",
    loadFailed: "This result did not load; it is still saved. Try again in a moment.",
    savedNotListed:
      "Your edit was saved as a new result, but this page could not open it yet. Reload the page to see it.",
    editPending:
      "Your edit of {line} is still being voiced and checked ({elapsed} so far). The new version opens here when it is saved.",
    editStopped:
      "Your edit of {line} stopped before it was saved. The result it was made from is unchanged; you can edit the line again.",
    editUnknown:
      "This page could not learn whether your edit of {line} was saved. Reload the page later to see.",
    renews: "It renews at {time} ({wait}).",
    reference: "Reference: {runId}.",
    retry: "Try again",
    littleRoom:
      "Only {room} of this clip is silent long enough to hold a line; Gapline needs at least {needed} of silence to say much. A line fits only in a pause of about {pause} or more where nobody speaks, so constant dialogue or voice-over leaves few or no lines. A scene with longer pauses works better.",
    status: {
      budget_busy:
        "Descriptions other visitors started hold the rest of today's allowance right now. A new one can start when one of them finishes, and runs usually take 2–6 minutes.",
      budget_daily: "Today's live allowance is used up; finished results still play.",
      visitor_busy:
        "Your other description or edit is still being made, and each visitor runs one at a time. A new one can start when it finishes.",
      visitor_daily:
        "You have used your share of today's live allowance; finished results still play.",
    },
    errors: {
      budget_busy:
        "Descriptions other visitors started hold the rest of today's allowance right now, so this run did not start. Try again when one of them finishes; runs usually take 2–6 minutes.",
      budget_daily: "Today's live allowance is used up; finished results still play.",
      visitor_busy:
        "Your other description or edit is still being made, and each visitor runs one at a time. Try again when it finishes.",
      visitor_daily:
        "You have used your share of today's live allowance; finished results still play.",
      run_allowance:
        "This run reached its spending cap and stopped, so nothing was saved. A shorter clip needs less.",
      provider_busy: "The model is overloaded right now. Try again in a minute or two.",
      provider_failed:
        "The model service refused the request, so the run stopped. The problem is on our side; try again later.",
      model_output:
        "The model's answer came back in the wrong shape, so the run stopped instead of guessing. Trying again usually works.",
      speech_failed:
        "Google Speech-to-Text could not be reached or was overloaded, so the run stopped. Try again in a minute.",
      voice_failed: "Google Text-to-Speech failed while voicing the lines. Try again in a minute.",
      media_failed:
        "Processing the video failed. Trying again would likely fail the same way; try another clip.",
      internal: "Something broke on our side and the run stopped. Try again.",
      forbidden:
        "The request was refused because it did not come from this page. Reload the page and try again.",
      not_found: "This clip is not here any more. Reload the page.",
      invalid_request: "The request was not understood. Reload the page and try again.",
      run_active:
        "Your run of this clip is still being made. Follow it below, or wait for it to finish.",
      connection: "Gapline could not be reached. Check your connection and try again.",
      server_busy: "Gapline is busy right now, so the run did not start. Try again in a minute.",
      unknown: "The run stopped before finishing. Try again.",
    },
    /** For a code whose failure may or may not repeat, when the run said it would (retryable: false). */
    noRetry: {
      speech_failed:
        "Google Speech-to-Text refused the request, so the run stopped. Trying again would likely fail the same way. Another clip may work; if it fails too, the problem is on our side.",
      voice_failed:
        "Google Text-to-Speech refused to voice the lines, so the run stopped. The problem is on our side; try again later.",
    },
  },
  notFound: {
    metaTitle: "Page not found — Gapline",
    title: "This page is not here.",
    body: "Uploaded clips are private to the browser that uploaded them. A link opened on another device, or shared with someone else, ends up here.",
    sample: "Open the sample",
    home: "Back to Gapline",
  },
  failure: {
    title: "Something broke while opening this clip.",
    body: "It may be a passing problem. Try again, or reload the page.",
    retry: "Try again",
    /** Shown by the root layout when one of the page's own scripts or styles failed to load. */
    partial:
      "Part of this page did not load, probably because Gapline is busy. Reload to try again.",
    reload: "Reload",
  },
  workspace: {
    narration: "Narration",
    density: "Density",
    densityStandard: "Standard",
    densityBrief: "Brief",
    generate: "Generate",
    regenerate: "Generate again",
    generating: "Generating…",
    liveNote:
      "A live run calls paid APIs. It usually takes 2–6 minutes, longer for a long or busy clip. Your current result keeps playing until the new one is ready.",
    /** The version list's entry for a run being made. */
    newVersion: "New version (generating…)",
    /** The version list's entry for a run that ended without a result (stopped, or not answering). */
    unfinishedVersion: "New version (not finished)",
    loadingRun: "Loading this result…",
    /** Announced once when a live run finishes; {lines} is editor.lines ("5 lines"). */
    runFinished:
      "Finished: the described film has {lines}. Press Play with description to hear it.",
    runFinishedEmpty:
      "Finished, but no line fit this clip's silences, so the film has no description.",
    replayFinished: "Replay finished.",
    samplePrivate: "Versions you make on this sample are visible only to you, in this browser.",
    replay: "Replay the run",
    replaying: "Replaying at {speed}× speed",
    stopReplay: "Stop replay",
    noRun: "Press Generate to make a track in {language}.",
    noRunHint:
      "Generating {language} narration for the 65-second sample took {time} and cost {cost}.",
    noRunHintHere: "Generating {language} narration for this clip took {time} and cost {cost}.",
    adOn: "Description on",
    adOff: "Description off",
    eyesClosed: "Eyes closed",
    eyesOpen: "Eyes open",
    listening: "Listening",
    play: "Play",
    playDescribed: "Play with description",
    pause: "Pause",
    keys: "Keys, with the player focused: Space or K play · D description · E eyes closed",
    captionIdle: "Narration text appears here as it is spoken.",
    /** Machine speech recognition: its slips must not read as the film's own words. */
    dialogue: "Speech as recognized",
    videoFailed: "The video didn't load.",
    downloads: "Downloads",
    downloadDescribed: "Described film (MP4)",
    downloadNarration: "Narration stem (WAV)",
    downloadVtt: "Text track (WebVTT)",
    downloadScript: "Script and review log (JSON)",
    notRecorded: "not recorded for this older result",
    noDescription: "no description in this result",
    selected: "{line} selected",
    stageAnnounce: "{stage}: {state}",
  },
  versions: {
    original: "Generated",
    edit: "Edit {n}",
    restored: "{line} restored",
    changed: "{line} changed",
    removed: "{line} removed",
    moved: "{line} moved",
    basedOn:
      "Edited from “{parent}”. {line} was written by a person and re-voiced; every other line is reused as it was.",
    basedOnMoved:
      "Edited from “{parent}”. {line} keeps its words and was moved to a new start, then re-voiced; every other line is reused as it was.",
    basedOnRemoved:
      "Edited from “{parent}”. An editor removed {line}; every other line is reused as it was, and the final check ran again on what remains.",
  },
  timeline: {
    picture: "Picture",
    dialogue: "Speech",
    /** Under the speech row's name: the words are machine recognition, slips included. */
    recognized: "as recognized",
    /** In the speech row of a clip whose soundtrack is silent or missing (the re-listen says so). */
    soundless: "No sound in this clip, so there is no dialogue to avoid.",
    room: "Usable silence",
    narration: "Narration",
    seconds: "{n} s",
    relistenSpeech: "Dialogue found when the silence was re-checked, {from} to {to}: {text}",
  },
  stages: {
    hear: "Hear",
    relisten: "Re-check silences",
    watch: "Watch",
    gaps: "Find silences",
    write: "Write",
    review: "Review",
    voice: "Voice",
    verify: "Final check",
    fix: "Rewrite flagged lines",
    mix: "Mix",
    waiting: "Waiting",
    reused: "reused from an earlier run of this clip",
    skipped: "Nothing to fix",
    running: "Working · {elapsed}",
    done: "{seconds} s",
    doneState: "done",
    runningState: "working",
    stopped: "Stopped",
    lost: "Connection lost",
    stoppedState: "stopped",
    relistenFound:
      "Silences re-checked: {gaps} · missed words found: {words} · silence lost to speech: {blocked}",
    relistenQuiet: "Silences re-checked: {gaps} · no missed speech",
    relistenNone: "No silences to re-check",
    relistenSoundless: "No sound in this clip, so nothing to re-check",
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
    room: "Time available",
    spoken: "Spoken",
    rate: "Speed {rate}×",
    fits: "Fits its silence",
    voiced: "Voiced: {seconds} at {rate}×",
    tooLong: "longer than the {room} it has",
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
      no_room: "Dropped: no free silence to speak it in",
      invalid_placement: "Rejected: it starts outside its silence",
      unchanged: "Rejected: the words did not change",
      review: "Dropped: still broke a rule after rewriting",
      too_long: "Dropped: too long for its silence even after shortening",
    },
    verdict: {
      firstPass: "Passed review on the first draft",
      rejectedOnce: "Rejected once",
      rejectedTwice: "Rejected twice",
      rejectedMany: "Rejected {n} times",
      sentBack: "Rejected by the final check",
      byEditor: "then fixed by an editor",
      sameWords: "then passed with the same words",
      rewritten: "then passed after a rewrite",
      shortened: "shortened to fit",
    },
    evidence: "What the model saw (not spoken)",
    pickHint:
      "Select a narration line on the timeline, or in “Choose a line” (with the keyboard, move to it and press Enter), to see how it was written, reviewed and voiced.",
    play: "Play from here",
    close: "Back to the run",
  },
  metrics: {
    lines: "lines voiced",
    /** `lines` for a result with exactly one. */
    line: "line voiced",
    fit: "fit their silence",
    overlap: "narration over recognized speech",
    caught: "rejected by a check",
    cost: "estimated API cost",
    time: "processing time",
  },
  editor: enEditor,
  coverage: { title: "Moments the reviewer found missing" },
} as const;

type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Widen<U>[]
    : T extends object
      ? { [K in keyof T]: Widen<T[K]> }
      : T;

export type Dictionary = Widen<typeof en>;
