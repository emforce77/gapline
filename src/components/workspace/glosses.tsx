/**
 * English glosses for the Korean sample result that the landing page and the sample workspace show,
 * keyed by the exact Korean text in the pinned run
 * (runtime/projects/tos-opening/runs/edit-6c4ddb3c…/script.json). A text without an entry is shown
 * without a gloss; add entries here when the pinned run changes.
 */
const EN_GLOSS: Record<string, string> = {
  "망고 오픈 무비 프로젝트.": "The Mango Open Movie Project.",
  "거대한 로켓 엔진에서 거센 불길이 뿜어져 나온다.":
    "Fierce flames burst from giant rocket engines.",
  "운하가 흐르는 미래 도시 위로 로켓이 솟아오른다.":
    "A rocket rises over a futuristic city laced with canals.",
  "“40년 후”라는 자막이 뜬다.": "The caption “40 years later” appears.",
  "자막이 뜬다": "the caption appears",
  "화면을 매개하는 표현인 '자막이 뜬다' 대신 텍스트 내용만 직접 전달해야 합니다.":
    "Instead of the screen-framing ‘the caption appears’, give only the text itself.",
  "'자막이 뜬다'라는 표현을 삭제하고 '40년 후.'라고 간결하게 수정합니다.":
    "Drop ‘the caption appears’ and shorten it to ‘40 years later.’",
  "40년 후.": "40 years later.",
  "40년 후, 두 사람의 홀로그램이 재생된다.": "40 years later, a hologram of two people plays.",
  "운하 다리 위에서 톰과 기계 의수를 한 여자가 대화를 나눈다.":
    "On a canal bridge, Thom talks with a woman who has a mechanical hand.",
  "연구원이 콘솔 앞에 앉아 있다.": "A researcher sits at a console.",
  "연구원이 콘솔 앞에 앉아 있다": "A researcher sits at a console",
  "시뮬레이션 준비 완료라는 문구가 뜬다.": "The words “Simulation ready” appear.",
  "문구가 뜬다": "the words appear",
  "시뮬레이션 준비 완료.": "Simulation ready.",
  "남자가 전극이 꽂힌 뇌를 들여다본다.": "A man peers at a brain studded with electrodes.",
  "단순히 연구원이 앉아 있는 모습보다 화면에 크게 표시된 핵심 정보인 '시뮬레이션 준비 완료(SIMULATION READY...)' 문구를 설명해야 합니다.":
    "Rather than a researcher sitting there, describe the key information shown large on screen: the words ‘SIMULATION READY…’.",
  "콘솔 위로 '시뮬레이션 준비 완료'라는 홀로그램 문구가 나타난다고 수정합니다.":
    "Say instead that the hologram words ‘Simulation ready’ appear above the console.",
  "'문구가 뜬다'는 화면에 텍스트가 나타나는 상황을 시청자 관점에서 서술하는 화면 틀 짓기 표현입니다.":
    "“The words appear” frames the picture from the viewer's side: it narrates text showing up on a screen.",
  "화면 틀 짓기 표현을 없애고 '시뮬레이션 준비 완료.'와 같이 화면 속 텍스트 내용만 직접 전달합니다.":
    "Drop the framing and give only the on-screen text itself, as in ‘Simulation ready.’",
};

/** The English gloss of a Korean line, only for an English page. */
export function glossFor(text: string, pageLang: string, textLang: string): string | undefined {
  if (pageLang !== "en" || textLang !== "ko") return undefined;
  return EN_GLOSS[text];
}

/** A gloss under a Korean text on an English page; nothing otherwise. */
export function Gloss({
  text,
  pageLang,
  textLang,
}: {
  text: string;
  pageLang: string;
  textLang: string | null;
}) {
  const gloss = textLang ? glossFor(text, pageLang, textLang) : undefined;
  return gloss ? <span className="gloss">{gloss}</span> : null;
}
