/**
 * English glosses (our translation) for every Korean text the deck and the film show, keyed by the
 * exact Korean from the run records. Wording matches the sample workspace
 * (src/components/workspace/glosses.tsx). `gloss()` throws for a Korean text without an entry, so no
 * Korean line reaches a slide or a film page unglossed.
 */
const EN_GLOSS: Record<string, string> = {
  // The evaluation's default run of the opening (22 Sep 2026, 20260922t051536291-ko-standard-d88b71):
  // its line over the launch call, the "before" of the re-listen.
  "망고 오픈 무비 프로젝트.": "The Mango Open Movie Project.",
  // The automatic sample run of 23 Sep 2026 (20260923t065852164-ko-standard-350b05).
  "거대한 로켓 엔진들이 일제히 화염을 내뿜는다.":
    "Huge rocket engines blast out flames all at once.",
  "로켓이 미래 도시 위로 솟아오른다.": "A rocket rises over a futuristic city.",
  "네덜란드 영화 기금 지원.": "Supported by the Netherlands Film Fund.",
  "40년 후.": "40 years later.",
  "홀로그램 재생창이 뜬다.": "A hologram playback window comes up.",
  "'뜬다'는 화면이나 시청자 입장에서 요소를 프레임화하는 표현입니다.":
    "“Comes up” frames the element from the screen’s or the viewer’s side.",
  "'전체 기억 재생.'과 같이 화면에 나타난 문구를 읽어주는 것으로 수정합니다.":
    "Read the words that appear instead, as in ‘Full memory playback.’",
  "전체 기억 재생.": "Full memory playback.",
  "시뮬레이션 준비 완료.": "Simulation ready.",
  "기계 눈을 한 남자가 뇌를 들여다본다.": "A man with a mechanical eye peers at a brain.",
  "화면이 암전된다.": "The screen goes black.",
  "'화면'이라는 단어를 사용하여 관찰자나 매체의 틀에서 장면을 서술했습니다.":
    "Using the word ‘screen’ describes the scene from the viewer’s or the medium’s frame.",
  "'화면이'를 삭제하고 '암전된다.'로 수정합니다.": "Delete ‘the screen’ and make it ‘Goes black.’",
  "암전된다.": "Goes black.",
  "이야기 이해에 불필요한 연출 및 편집 전문 용어를 사용했습니다.":
    "It uses directing and editing jargon the story does not need.",
  "해설이 시작되는 63초 시점에는 남자가 여전히 뇌를 바라보고 있으며 화면이 어두워지지 않았습니다.":
    "At 63 s, where the line starts, the man is still looking at the brain and the picture has not gone dark.",
  "불필요한 장면 전환 효과 해설을 생략하거나 남자가 뇌를 가만히 응시하는 동작으로 수정합니다.":
    "Leave out the transition, or describe the man gazing steadily at the brain.",
  "남자가 뇌를 응시한다.": "The man gazes at the brain.",
  "앞선 설명에서 이미 남자가 뇌를 들여다보고 있음을 전달했으므로 같은 동작을 불필요하게 반복하며, 암전되는 중요한 시각적 변화를 설명하지 않습니다.":
    "The line before already says the man is looking at the brain, so this repeats it, and it leaves out the key change: the picture going black.",
  "앞선 설명에서 '기계 눈을 한 남자'로 지칭했던 인물을 '남자'라는 다른 표현으로 지칭했습니다.":
    "It calls ‘the man with a mechanical eye’ from the line before just ‘the man’.",
  "블렌더 재단 제공.": "Presented by the Blender Foundation.",
  "운하 다리 난간에서 톰과 기계 팔을 가진 실리아가 대화를 나눈다.":
    "At the canal bridge railing, Thom talks with Celia, who has a mechanical arm.",
  "어두운 시설 안에서 두 사람의 모습이 주황색과 파란색 와이어프레임 홀로그램으로 재생된다.":
    "In a dark facility, two people play back as orange and blue wireframe holograms.",
  // Korea's audio-description guideline (KMCC), p.10, quoted on the constraint slide.
  "화면해설이 침범할 수 없는 영역은 대사와 중요한 음향 효과로 지정하는 것이 바람직함":
    "Dialogue and important sound effects should be zones that description does not enter.",
};

export function gloss(korean: string): string {
  const found = EN_GLOSS[korean];
  if (!found) throw new Error(`no English gloss for Korean text: ${korean}`);
  return found;
}
