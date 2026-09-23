/**
 * English glosses (our translation) for every Korean text the deck shows, keyed by the exact Korean
 * from the run records. Wording matches the sample workspace (src/components/workspace/glosses.tsx).
 * `gloss()` throws for a Korean text without an entry, so no Korean line reaches a slide unglossed.
 */
const EN_GLOSS: Record<string, string> = {
  "시뮬레이션 준비 완료.": "Simulation ready.",
  "남자가 전극이 꽂힌 뇌를 들여다본다.": "A man peers at a brain studded with electrodes.",
  "연구원이 콘솔 앞에 앉아 있다.": "A researcher sits at a console.",
  "시뮬레이션 준비 완료라는 문구가 뜬다.": "The words “Simulation ready” appear.",
  "단순히 연구원이 앉아 있는 모습보다 화면에 크게 표시된 핵심 정보인 '시뮬레이션 준비 완료(SIMULATION READY...)' 문구를 설명해야 합니다.":
    "Rather than a researcher sitting there, describe the key information shown large on screen: the words ‘SIMULATION READY…’.",
  "'문구가 뜬다'는 화면에 텍스트가 나타나는 상황을 시청자 관점에서 서술하는 화면 틀 짓기 표현입니다.":
    "“The words appear” frames the picture from the viewer’s side: it narrates text showing up on a screen.",
  "콘솔 위로 '시뮬레이션 준비 완료'라는 홀로그램 문구가 나타난다고 수정합니다.":
    "Say instead that the hologram words ‘Simulation ready’ appear above the console.",
  "화면 틀 짓기 표현을 없애고 '시뮬레이션 준비 완료.'와 같이 화면 속 텍스트 내용만 직접 전달합니다.":
    "Drop the framing and give only the on-screen text itself, as in ‘Simulation ready.’",
  "40년 후.": "40 years later.",
  "40년 후, 두 사람의 홀로그램이 재생된다.": "40 years later, a hologram of two people plays.",
  "주황색과 파란색의 홀로그램 인형들이 다투는 모습을 재현하고, 재생 제어창이 떠오른다.":
    "Orange and blue hologram figures replay a quarrel, and a playback panel comes up.",
  "콘솔 앞 연구원 위로 '시뮬레이션 준비 완료'라는 홀로그램 글자가 나타난다.":
    "Above the researcher at the console, hologram letters appear: ‘Simulation ready’.",
  "운하 다리 위에서 톰과 기계 의수를 한 여자가 대화를 나눈다.":
    "On a canal bridge, Thom talks with a woman who has a mechanical hand.",
  "망고 오픈 무비 프로젝트.": "The Mango Open Movie Project.",
  "화면에 나타나는 자막 'Blender Foundation Presents'":
    "The title on screen, ‘Blender Foundation Presents’",
  "화면에 나타나는 자막 'the Mango Open Movie project'":
    "The title on screen, ‘the Mango Open Movie project’",
  "나무가 늘어선 운하 다리 위에서 톰과 로봇 팔을 장착한 실리아가 대화를 나누는 모습":
    "Thom and Celia, who has a robotic arm, talking on a tree-lined canal bridge",
  "화면해설이 침범할 수 없는 영역은 대사와 중요한 음향 효과로 지정하는 것이 바람직함":
    "Dialogue and important sound effects should be zones that description does not enter.",
};

export function gloss(korean: string): string {
  const found = EN_GLOSS[korean];
  if (!found) throw new Error(`no English gloss for Korean text: ${korean}`);
  return found;
}
