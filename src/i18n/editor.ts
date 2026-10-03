import type { Dictionary } from "./en";

/**
 * The line editor's strings (edit, restore, remove, and why an edit was refused), kept apart so each
 * catalog file stays short. en.ts and ko.ts place them under `editor`.
 */
export const enEditor = {
  chooseLine: "Choose a line",
  title: "Edit this line",
  text: "Description",
  start: "Start (seconds)",
  /** The same starts the field takes and a placement refusal names; {end} is where the room ends. */
  startRange: "Start between {first} and {last} s; the spoken line has to end by {end} s.",
  save: "Review and re-voice",
  /** The button while an edit runs; the step is told from its usual timing (see use-elapsed.ts). */
  saving: {
    voicing: "Voicing… {elapsed}",
    reviewing: "Reviewing… {elapsed}",
    long: "Still reviewing… {elapsed}",
  },
  /** Under the button while an edit runs: what Gapline is doing, announced once per step. */
  progress: {
    voicing:
      "Voicing your words and measuring how long they run. Then Gapline reviews your line against the picture and the rest of the track, and mixes it.",
    reviewing:
      "Reviewing your line against the picture and the rest of the track, then mixing. This usually takes under a minute.",
    long: "This review is taking longer than usual.",
  },
  saved: "Saved as a new result.",
  hint: "A new result preserves the original. Only this line is re-voiced; your words are never automatically shortened.",
  legacy: "Generate a new result to edit lines with missing audio.",
  restoreHint:
    "An editor removed this line. Submit its words, as they are or changed, to review and voice it and put it back.",
  remove: {
    open: "Remove this line",
    confirm:
      "Remove this line from the narration? Gapline saves a new result without it and re-checks what the track is now missing. Your current result is kept.",
    yes: "Remove line",
    no: "Keep it",
    removing: {
      reviewing: "Re-checking… {elapsed}",
      long: "Still re-checking… {elapsed}",
    },
    progress: {
      reviewing:
        "Reviewing the track again without this line, then mixing. This usually takes about a minute.",
      long: "This review is taking longer than most; some take three minutes or more.",
    },
  },
  /** Beside a reviewer's note written in the narration's language, when the page has no gloss of it. */
  reviewerLanguage: "Reviewer's note in {language}",
  /** Read before each change in a version's words, so a screen reader says what was struck or added. */
  diff: { removed: "removed:", added: "added:" },
  history: "Result version",
  reviewNeeded: "Final check · notes",
  checked: "Final check passed",
  autoFixed: "After the final check, Gapline fixed {lines} on its own.",
  lines: { one: "1\u00a0line", other: "{n}\u00a0lines" },
  missingLead: "Moments that still have no line:",
  failingLead: "Lines it still flags:",
  takenOutLead: "Lines Gapline took out instead of fixing:",
  unvoicedLead: "Lines Gapline wrote but did not voice:",
  noLines: "No description was added",
  noLinesWhy: {
    no_room:
      "This clip has no pause of about {pause} or more without speech or a key sound, so there is nowhere a line could be spoken.",
    unwritten: "Gapline found {room} without speech but wrote no line for it.",
    removed:
      "An editor removed every voiced line, so none is spoken. Choose a line to put it back or try other words.",
    dropped:
      "Every line Gapline wrote was too long for its silence or still broke a rule after rewriting, so none is voiced. Choose a line to try other words.",
  },
  littleCovered: "Only part of this clip is described",
  coverage:
    "Narration: {lines}, {narrated} in all. It speaks only where nobody else does: {room} of this {clip} clip.",
  checkedNote: "The final check passed.",
  optional: "You can still change any line.",
  noRoom: "no free silence left here",
  uncertainty: "API cost is unresolved; the displayed amount is a known subtotal.",
  seek: "Playback position",
  /** The slider's spoken value, in words: screen readers read "0:15.4" as digits. */
  seekValue: "{time} of {total}",
  track: "Audio track",
  picture: "Picture visibility",
  failed: "The edit could not be completed. Your original is preserved.",
  errors: {
    too_long:
      "Spoken, these words run longer than the {room} s available from {start} s. Shorten them or start earlier.",
    spoken:
      "Spoken, these words take {spoken} s, but from {start} s there are only {room} s. Cut about {over} s.",
    spokenEarlier:
      "Spoken, these words take {spoken} s, but from {start} s there are only {room} s. Cut about {over} s, or start at {latest} s or earlier.",
    review:
      "The reviewer rejected these words. Gapline does not rewrite an editor's words; change them and try again.",
    why: "Why",
    suggestion: "Suggested fix",
    placement:
      "The start has to stay between {min} and {max}\u00a0seconds, clear of the lines around it.",
    unchanged: "Change the words or the start time first.",
    busy: "This edit is still being made. Wait a moment, then reload the page to see it.",
    /** The platform answered for the app (Cloud Run's 429, a gateway error): pressing again is safe. */
    server_busy: "Gapline is busy right now. Your original is preserved. Try again in a minute.",
    /** An edit that stopped (edit_failed's cause), in edit terms; other codes use the run catalog. */
    stopped: {
      budget_busy:
        "Other visitors' runs are using the rest of today's allowance, so the edit did not start. Your original is preserved; try again once one of them finishes.",
      run_allowance: "This edit reached its spending cap and stopped. Your original is preserved.",
      provider_failed:
        "The model service refused the request, so the edit stopped. Your original is preserved; the problem is on our side, so try again later.",
      model_output:
        "The model's answer came back in the wrong shape, so the edit stopped instead of guessing. Your original is preserved; trying again usually works.",
      speech_failed:
        "Google Speech-to-Text could not be reached or was overloaded, so the edit stopped. Your original is preserved; try again in a minute.",
      voice_failed:
        "Google Text-to-Speech failed while voicing the line, so the edit stopped. Your original is preserved; try again in a minute.",
      media_failed:
        "Mixing the new track failed, so the edit stopped. Your original is preserved; try again in a minute.",
      internal:
        "Something broke on our side and the edit stopped. Your original is preserved. Try again.",
      not_found: "This result is not here any more. Reload the page.",
    },
    /** For a code whose failure may or may not repeat, when the edit said it would (retryable: false). */
    stoppedNoRetry: {
      speech_failed:
        "Google Speech-to-Text refused the request, so the edit stopped. Your original is preserved; the problem is on our side, so try again later.",
      voice_failed:
        "Google Text-to-Speech refused to voice the line, so the edit stopped. Your original is preserved; the problem is on our side, so try again later.",
    },
  },
  /** Before an edit or removal the server would refuse; {reason} is the run panel's notice. */
  unavailable: "Lines cannot be edited or removed right now. {reason}",
} as const;

export const koEditor: Dictionary["editor"] = {
  chooseLine: "문장 선택",
  title: "이 문장 수정",
  text: "해설 문장",
  start: "시작 시각(초)",
  startRange: "{first}초에서 {last}초 사이에 시작하고, 낭독은 {end}초까지 끝나야 합니다.",
  save: "다시 검수 · 다시 낭독",
  saving: {
    voicing: "낭독 중… {elapsed}",
    reviewing: "검수 중… {elapsed}",
    long: "아직 검수 중… {elapsed}",
  },
  progress: {
    voicing:
      "고친 문장을 낭독하고 길이를 재고 있습니다. 이어서 이 문장을 화면과 나머지 해설에 비춰 검수하고 믹스합니다.",
    reviewing:
      "고친 문장을 화면과 나머지 해설에 비춰 검수한 뒤 믹스합니다. 보통 1분 안에 끝납니다.",
    long: "평소보다 검수가 오래 걸리고 있습니다.",
  },
  saved: "새 결과로 저장했습니다.",
  hint: "원본은 그대로 두고 새 결과를 만듭니다. 이 문장만 다시 낭독하고, 고친 문장은 자동으로 줄이지 않습니다.",
  legacy: "문장별 음성이 없는 결과입니다. 새로 생성한 뒤 편집할 수 있습니다.",
  restoreHint:
    "편집자가 삭제한 문장입니다. 그대로 또는 고쳐서 제출하면 다시 검수하고 낭독해 해설에 되돌립니다.",
  remove: {
    open: "이 문장 삭제",
    confirm:
      "이 문장을 해설에서 뺄까요? 이 문장을 뺀 새 결과를 만들고, 트랙에서 빠진 정보를 다시 점검합니다. 지금 결과는 그대로 남습니다.",
    yes: "삭제",
    no: "취소",
    removing: {
      reviewing: "다시 점검 중… {elapsed}",
      long: "아직 점검 중… {elapsed}",
    },
    progress: {
      reviewing: "이 문장을 뺀 트랙 전체를 다시 검수한 뒤 믹스합니다. 보통 1분쯤 걸립니다.",
      long: "평소보다 검수가 오래 걸리고 있습니다. 3분 넘게 걸리기도 합니다.",
    },
  },
  reviewerLanguage: "검수 의견 원문({language})",
  diff: { removed: "삭제:", added: "추가:" },
  history: "결과 버전",
  reviewNeeded: "최종 점검 · 참고",
  checked: "최종 점검 통과",
  autoFixed: "최종 점검 뒤 갭라인이 {lines}을 스스로 고쳤습니다.",
  lines: { one: "1문장", other: "{n}문장" },
  missingLead: "아직 해설이 없는 순간:",
  failingLead: "여전히 지적된 문장:",
  takenOutLead: "고치지 못해 갭라인이 뺀 문장:",
  unvoicedLead: "갭라인이 썼지만 낭독하지 않은 문장:",
  noLines: "해설을 넣지 못했습니다",
  noLinesWhy: {
    no_room:
      "이 클립에는 말소리나 중요한 소리 없이 약 {pause} 이상 이어지는 구간이 없어 해설을 넣을 자리가 없습니다.",
    unwritten: "말소리가 없는 구간 {room}을 찾았지만 해설 문장을 쓰지 않았습니다.",
    removed:
      "편집자가 낭독되던 문장을 모두 삭제해 해설이 들리지 않습니다. 문장을 골라 되살리거나 다른 표현으로 고쳐 볼 수 있습니다.",
    dropped:
      "갭라인이 쓴 문장이 모두 침묵보다 길거나 다시 써도 조항을 어겨, 낭독한 문장이 없습니다. 문장을 골라 다른 표현으로 고쳐 볼 수 있습니다.",
  },
  littleCovered: "클립의 일부에만 해설이 들어갔습니다",
  coverage:
    "해설 {lines}, 모두 {narrated}. 해설은 아무도 말하지 않는 구간에만 들어가며, 이 {clip} 클립에서 그런 구간은 {room}입니다.",
  checkedNote: "최종 점검을 통과했습니다.",
  optional: "어떤 문장이든 직접 고칠 수 있습니다.",
  noRoom: "남은 침묵이 없음",
  uncertainty: "API 비용이 미확정입니다. 표시 금액은 확인된 비용의 합계입니다.",
  seek: "재생 위치",
  seekValue: "{total} 중 {time}",
  track: "음성 트랙",
  picture: "화면 표시",
  failed: "수정을 완료하지 못했습니다. 원본은 보존되어 있습니다.",
  errors: {
    too_long:
      "읽는 시간이 {start}초부터 남은 자리({room}초)보다 깁니다. 문장을 줄이거나 더 일찍 시작해 주세요.",
    spoken:
      "읽으면 {spoken}초가 걸리는데, {start}초부터 남은 자리는 {room}초뿐입니다. 약 {over}초 줄여 주세요.",
    spokenEarlier:
      "읽으면 {spoken}초가 걸리는데, {start}초부터 남은 자리는 {room}초뿐입니다. 약 {over}초 줄이거나, {latest}초까지 앞당겨 시작해 주세요.",
    review:
      "검수에서 반려되었습니다. 갭라인은 편집자의 문장을 대신 고치지 않으니, 직접 고친 뒤 다시 시도해 주세요.",
    why: "이유",
    suggestion: "수정 제안",
    placement: "시작 시각은 앞뒤 문장과 겹치지 않게 {min}초에서 {max}초 사이여야 합니다.",
    unchanged: "문장이나 시작 시각을 바꾼 뒤 저장해 주세요.",
    busy: "이 수정은 아직 처리 중입니다. 잠시 후 페이지를 새로 고쳐 확인해 주세요.",
    server_busy:
      "지금 갭라인에 요청이 몰려 있습니다. 원본은 그대로 보존되어 있으니 1분 뒤 다시 시도해 주세요.",
    stopped: {
      budget_busy:
        "지금은 다른 방문자의 생성 작업이 오늘 남은 한도를 쓰고 있어 수정을 시작하지 못했습니다. 원본은 그대로이니, 그중 하나가 끝나면 다시 시도해 주세요.",
      run_allowance: "이번 수정이 비용 상한에 닿아 멈췄습니다. 원본은 그대로 보존되어 있습니다.",
      provider_failed:
        "모델 서비스가 요청을 거부해 수정이 멈췄습니다. 원본은 그대로입니다. 저희 쪽 문제이니 나중에 다시 시도해 주세요.",
      model_output:
        "모델의 답이 정해진 형식을 벗어나, 추측하지 않고 수정을 멈췄습니다. 원본은 그대로이며, 다시 시도하면 대개 됩니다.",
      speech_failed:
        "Google Speech-to-Text에 연결할 수 없거나 요청이 몰려 수정이 멈췄습니다. 원본은 그대로이니 1분 뒤 다시 시도해 주세요.",
      voice_failed:
        "Google Text-to-Speech가 문장을 낭독하다 실패해 수정이 멈췄습니다. 원본은 그대로이니 1분 뒤 다시 시도해 주세요.",
      media_failed:
        "새 트랙을 믹스하다 실패해 수정이 멈췄습니다. 원본은 그대로이니 1분 뒤 다시 시도해 주세요.",
      internal: "서버에서 문제가 생겨 수정이 멈췄습니다. 원본은 그대로이니 다시 시도해 주세요.",
      not_found: "이 결과를 더 이상 찾을 수 없습니다. 페이지를 새로 고쳐 주세요.",
    },
    stoppedNoRetry: {
      speech_failed:
        "Google Speech-to-Text가 요청을 거부해 수정이 멈췄습니다. 원본은 그대로입니다. 저희 쪽 문제이니 나중에 다시 시도해 주세요.",
      voice_failed:
        "Google Text-to-Speech가 문장 낭독 요청을 거부해 수정이 멈췄습니다. 원본은 그대로입니다. 저희 쪽 문제이니 나중에 다시 시도해 주세요.",
    },
  },
  unavailable: "지금은 문장을 수정하거나 삭제할 수 없습니다. {reason}",
};
