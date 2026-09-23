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
  save: "Review and re-voice",
  saving: "Reviewing your edit…",
  hint: "A new result preserves the original. Only this line is re-voiced; your words are never automatically shortened.",
  legacy: "Generate a new result to edit lines with missing audio.",
  restoreHint:
    "An editor removed this line. Submit its words, as they are or changed, to review and voice it and put it back.",
  remove: {
    open: "Remove this line",
    confirm:
      "Remove this line from the narration? Scene makes a new result without it and checks again what the track still misses. The current result stays as it is.",
    yes: "Remove line",
    no: "Keep it",
    removing: "Removing and re-checking…",
  },
  history: "Result version",
  reviewNeeded: "Final check · notes",
  checked: "Final check passed",
  autoFixed: "After the final check, Scene fixed {lines} by itself, without an editor.",
  lines: { one: "1 line", other: "{n} lines" },
  optional: "Any line can still be changed by hand.",
  noRoom: "no free silence left here",
  uncertainty: "API cost is unresolved; the displayed amount is a known subtotal.",
  seek: "Playback position",
  track: "Audio track",
  picture: "Picture visibility",
  failed: "The edit could not be completed. Your original is preserved.",
  errors: {
    too_long:
      "Spoken, these words run past the {room} of room from {start}. Shorten them or start earlier.",
    review:
      "The reviewer rejected these words. Scene does not rewrite an editor's words; change them and try again.",
    placement:
      "The start has to stay between {min} and {max} seconds, clear of the lines around it.",
    unchanged: "Change the words or the start time first.",
    busy: "This edit is still being made. Wait a moment, then reload the page to see it.",
  },
} as const;

export const koEditor: Dictionary["editor"] = {
  chooseLine: "문장 선택",
  title: "이 문장 수정",
  text: "해설 문장",
  start: "시작 시각(초)",
  save: "재검수 · 재합성",
  saving: "수정 문장을 검수하는 중…",
  hint: "원본을 보존한 새 결과를 만듭니다. 이 문장만 재합성하며, 작성한 문구를 자동으로 줄이지 않습니다.",
  legacy: "문장별 음성이 없는 결과입니다. 새로 생성한 뒤 편집할 수 있습니다.",
  restoreHint:
    "편집자가 삭제한 문장입니다. 그대로 또는 고쳐서 제출하면 다시 검수하고 녹음해 해설에 되돌립니다.",
  remove: {
    open: "이 문장 삭제",
    confirm:
      "이 문장을 해설에서 뺄까요? 이 문장을 뺀 새 결과를 만들고, 트랙에서 빠진 정보를 다시 점검합니다. 지금 결과는 그대로 남습니다.",
    yes: "삭제",
    no: "취소",
    removing: "삭제하고 다시 점검하는 중…",
  },
  history: "결과 버전",
  reviewNeeded: "최종 점검 · 참고",
  checked: "최종 점검 통과",
  autoFixed: "최종 점검 뒤 씬이 편집자 없이 {lines}을 스스로 고쳤습니다.",
  lines: { one: "1문장", other: "{n}문장" },
  optional: "필요하면 어떤 문장이든 직접 고칠 수 있습니다.",
  noRoom: "남은 침묵이 없음",
  uncertainty: "API 비용이 미확정입니다. 표시 금액은 확인된 비용의 합계입니다.",
  seek: "재생 위치",
  track: "음성 트랙",
  picture: "화면 표시",
  failed: "수정을 완료하지 못했습니다. 원본은 보존되어 있습니다.",
  errors: {
    too_long:
      "읽는 시간이 {start}부터 남은 자리({room})보다 깁니다. 문장을 줄이거나 더 일찍 시작해 주세요.",
    review:
      "검수에서 반려되었습니다. 씬은 편집자의 문장을 대신 고치지 않으니, 직접 고친 뒤 다시 시도해 주세요.",
    placement: "시작 시각은 앞뒤 문장과 겹치지 않게 {min}초에서 {max}초 사이여야 합니다.",
    unchanged: "문장이나 시작 시각을 바꾼 뒤 저장해 주세요.",
    busy: "이 수정은 아직 처리 중입니다. 잠시 후 페이지를 새로 고쳐 확인해 주세요.",
  },
};
