# 결선 시연과 제작자 검증 계획

첫 판매 단위는 90초 이하 한국어 예고편·문화 홍보 영상 한 편이다. 제작자는 합성한 영상과 독립 음성 트랙, 자막, 검수 기록을 받아 자기 편집 프로그램에서 열어 볼 수 있다. 본선에서는 제작자가 실제로 마주치는 두 질문을 보여준다. 원래 소리를 가리지 않고 말할 수 있는가? 그 시점에 관객도 그 사실을 볼 수 있는가?

## 구현 순서와 완료 기준

| 순서 | 해결할 문제 | 구현 방법 | 완료 판단 |
| --- | --- | --- | --- |
| 1. 첫 청취 | 모바일에서는 재생 버튼을 보려면 먼저 스크롤해야 했다. | 홈 첫 화면으로 비교 플레이어를 올리고, 실제 대사와 화면의 준비 완료 문구가 함께 들어가는 49.5~56.5초를 사용한다. | 390×844에서 원음·해설 버튼이 모두 보이고, 같은 구간에서 시작하고 멈춘다. |
| 2. 기술 근거 | 공백 재인식과 지침 검수가 청취 결과를 얼마나 바꿨는지 알기 어려웠다. | 실제 발사 무전 두 버전을 각 실행에 저장된 음량대로 이어 듣고, 영어 샘플의 이른 인물 소개를 원본 프레임과 대조한다. 원래 시작 시각에 이미 보이는 뇌와 전극만 묘사하는 새 음성을 만든다. | 수정 문구가 줄 검수를 통과하고 저장된 음성으로 확인된다. 구버전은 비교할 수 있게 보존한다. |
| 3. 제작자 편집 | 누락 시각을 찾더라도 새 줄을 쓸 수 없었다. | 원음으로 이동하고, 실제로 남는 자리에서만 문장을 추가한다. 기존 비용 예약, 소유자 확인, 합성·길이 실측, 전체 트랙 검수와 버전 저장 경로를 사용한다. 기존 줄을 옮길 때는 원본의 두 프레임을 비교한다. | 반려 사유를 볼 수 있고, 통과한 편집은 별도 재생 가능한 버전으로 저장된다. 새로고침·재시도에서도 같은 결과를 찾고, 다른 방문자는 새 버전을 열 수 없다. |
| 4. 납품 | 제작자가 원시 실행 기록을 읽어야 통과 근거와 남은 문제를 알 수 있었다. | 완료된 실행의 실제 판정·위반 조항·실측값과 누락을 한영 TXT로 생성한다. 오래된 데이터에서 기록이 빠진 항목은 명시한다. | 영상·음성·자막·JSON·검수 보고서를 열고 원본 결과와 대조할 수 있다. |
| 5. 공개 운영 | 로컬에서 성공한 시연이 행사 링크에서도 되는지 확인해야 한다. | 소개 링크를 교정하고, 검증한 커밋으로 새 Cloud Run 리비전을 만든다. 새 리비전에서 샘플을 확인한 뒤 트래픽을 전환하고 짧은 실제 업로드와 편집을 실행한다. | 공개 주소에서 재생, 생성, 편집, 내려받기와 소유권을 확인한다. 진행 중인 생성은 보호하고 서비스의 기존 예산과 용량 설정을 유지한다. |

우선순위는 실제 실패가 기록된 짧은 영상에서 출발했다. 이 경로에서는 모델이 무슨 말을 썼는지, 원본을 다시 들은 결과 무엇을 지켰는지, 사람이 어디를 고쳤는지를 같은 자료로 설명할 수 있다. 독립 워커의 중단 후 재개는 결선 전 별도 검증 항목이다. 장편 분할은 후속 수요에 맞춘다.

## 영어 무대 대본 초안

아래 4분은 리허설용 분량이다. 주최 측 발표·질의 시간, 지정 템플릿, 라이브 생성 의무와 심사 빌드는 확인 후 반영한다. 발표자는 홈과 비교 페이지, 저장된 실행, 원본 음성과 보고서를 미리 연다. 현장 생성이 필요하면 시작할 때 짧은 클립 한 건을 눌러 두고, 끝나기 전까지 저장본으로 진행한다. 관객 QR은 생성 버튼 없이 사례를 들을 수 있는 `/screening`으로 연결한다.

| 시간 | 조작 | 영어 대사 |
| --- | --- | --- |
| 0:00–0:30 | 그림을 숨긴 채 홈의 원음과 해설을 같은 구간에서 재생한다. “locked” 뒤를 들려준다. | “Listen for the pause after ‘locked.’ What changed on screen? Now hear the same moment with description. The display says the simulation is ready. The actors keep speaking at exactly the same time as before.” |
| 0:30–1:20 | 비교 페이지에서 발사 장면을 두 번 듣는다. 두 번째 재생 때에는 말을 멈춘다. | “A producer has to decide where a narrator can speak. In this early cut, a voice reads a production credit over the launch controller. Our transcript had marked that spot as silence. Gapline sent just that slice back to the speech recognizer. Listen to the radio in the next cut.” |
| 1:20–2:05 | 뇌와 전극이 보이는 장면에서 원래 해설을 듣고, 다음 프레임을 보인 뒤 수정본을 재생한다. | “The first draft introduces a man with a robotic eyepiece. Hold the picture there. You can see the brain and its electrodes. Now advance the picture. There’s the eyepiece. A producer changed the line to ‘Thin electrodes protrude from a brain.’ It gives the listener the reveal when the film does.” |
| 2:05–2:45 | 한국어 트랙에서 ‘전체 기억 재생’의 검수 기록과 음성을 연다. | “Here the narrator described a hologram coming up. The review pointed to a guideline, and the rewrite reads the message on the display: ‘Full memory playback.’ Gapline recorded the new words, measured the voice against the silence, and mixed that take. The producer can hear it in place.” |
| 2:45–3:30 | 보고서에서 검수 조항과 해결하지 못한 누락을 가리킨다. 한국어 인터뷰를 짧게 들려준다. | “In this interview, Hanbid keeps speaking. Gapline leaves that speech alone and lists what it couldn’t describe. A producer can listen at the flagged moment, decide what matters and edit the track. The report keeps that decision visible.” |
| 3:30–4:00 | 라이브 결과가 준비됐으면 연다. 대기 중이면 저장본임을 밝히고 납품 파일을 보여준다. | “A producer can take the video to a screening, drop the narration and captions into an editor, and keep the script and review report with the cut. Our first delivery is a short Korean trailer. Next we want describers and blind and low-vision listeners to tell us where the track still gets in the way.” |

검증 결과가 바뀔 때만 해당 구간의 대사를 바꾼다.

- 11월 20일 재검수에서 영상만 본 검수와 사진을 함께 본 검수 모두 기계 눈의 이른 등장을 지적했다. 사진을 넣은 검수는 정상으로 정해 둔 로켓 상승 줄도 반려했다. 무대에서는 제작자가 기계 눈 줄을 고친 전후 음성을 사용한다. 자동 검수 실험을 묻는다면 “Both checks caught the eyepiece. Adding stills also flagged a rocket line we had accepted. The producer listened against the original and changed the wording.”이라고 답한다.
- 같은 모델·같은 대사표로 한 번 생성한 대조군에서 실제로 들리는 문제가 있으면, 인터뷰 대신 같은 구간의 두 음성을 재생하고 “Same scene, model and transcript. Listen for where the narrator starts speaking.”이라고 소개한다. 문제가 들리지 않으면 기존 인터뷰를 쓴다.
- 태그 리비전에서 중단 후 같은 실행이 끝난 기록이 있으면 “We interrupted this run after review. It resumed from its saved work and finished the track.”이라는 말과 녹화를 함께 쓴다. 삭제 경로가 배포되고 공개 주소에서 확인되면 준비해 둔 발표자 소유 업로드에서 삭제 결과를 보여준다.
- 라이브 생성이 거절되거나 네트워크가 끊기면 “This is a recording of an earlier run. You’ll hear the original soundtrack and its saved narration.”이라고 알리고 로컬 녹음·보고서를 연다. 현장에서 원래 무전과 대사, 해설이 객석에서 구별되는지 리허설한다.

## 예상 질문과 답안

각 영어 답변 아래의 한국어 메모는 발표자용이다. 제품 상태에 관한 답은 11월 20일 리비전을 기준으로 작성했다.

1. **How is this different from ViddyScribe?** “ViddyScribe offers standard and extended description. Our focus is a producer working against a locked cut. In our launch scene you can hear the radio call that a first pass missed, and the producer can trace why that pause was taken off the table.”

   메모: 상대도 원래 길이를 유지하는 표준 해설을 제공한다. 경쟁사가 항상 영상을 멈춘다고 소개하지 않는다. [ViddyScribe의 두 모드 설명](https://viddyscribe.com/)
2. **Is this dubbing?** “Dubbing puts a new voice where an actor spoke. For description we have to find time when nobody is speaking, then use that time to tell the listener something the soundtrack leaves out.”

   메모: 무전 위로 크레딧을 읽었던 장면을 예로 든다.
3. **Why wouldn’t I just prompt Gemini?** “Gemini can draft the line. It can even write a perfectly accurate fact too early. Here you can hear the words, look at the picture at their start, and check the measured recording against the next line of dialogue.”

   메모: 단순 생성 대조 음성은 같은 조건에서 저장해 확인한 경우만 제시한다.
4. **Can I use it on a feature film?** “Our current delivery unit is a clip of up to ninety seconds. A feature would need continuity of names and choices across scenes, besides processing the longer soundtrack.”

   메모: 장편 분할은 후속 개발이다.
5. **What happens if the server dies?** “A completed run and its files are in Cloud Storage. On the November build, closing the browser lets an ongoing run continue, but losing the serving instance can interrupt it. We can play a completed run during the demo.”

   메모: 브라우저 종료와 서버 종료를 구분한다. 워커 실검증 뒤에는 실제 중단 위치와 재개한 단계만 답한다.
6. **Who has evaluated the descriptions?** “Our current evidence is the original footage, the generated audio and our review of those examples. Sessions with blind and low-vision listeners and professional describers, followed by a producer handoff, are our next step.”

   메모: 청취자 효과, 작가 시간 절감, 고객 인수를 수치로 주장하지 않는다.
7. **How much does a finished clip cost?** “The run records the model and speech charges. The amount depends on the material and on which lines need another take. We would quote a customer after agreeing on the clip and the human review it requires.”

   메모: 고객 가격과 API 사용료를 구분한다. 금액 공개 범위는 발표자 확인 전까지 보류한다.
8. **Who is legally required to provide this?** “The Korean case we cite concerned cinema operators. The Supreme Court upheld a discrimination finding over access to description, captions and the equipment to receive them, and sent the scope of the remedy back for review.”

   메모: 모든 영상·광고에 적용되는 의무라고 확대하지 않는다. [대법원 2022다203507 보도자료](https://www.scourt.go.kr/portal/news/NewsViewAction.work?gubun=6&seqnum=3044&type=0)
9. **Who can open an upload, and when is it deleted?** “Within the app, access to an upload and its results is tied to the browser that created it. We store the material in Cloud Storage. The November build has no scheduled expiration for uploads.”

   메모: 소유자 삭제 기능과 저장소 보관 정책은 별개다. 각각 배포·적용을 확인한 뒤 지원 범위만 갱신한다.
10. **What languages can you deliver?** “We support Korean and English. The writer budgets Korean lines in syllables and English lines in words. The final fit uses the duration of the actual voice in either language.”

    메모: 추가 언어는 해당 언어 지침과 음성 길이 검증이 필요하다.
11. **What if the reviewer gets it wrong?** “The editor shows the reason for a rejection and the guideline behind it. A producer can listen against the source, revise the line and compare the saved versions. The early eyepiece line is an example where that judgment mattered.”

    메모: 검수 모델도 틀릴 수 있다. 사람의 편집과 확인이 필요한 사례로 답한다.
12. **Where does Google Cloud come in?** “Chirp times the dialogue and listens again to candidate pauses. Text-to-Speech voices the accepted wording. The app runs on Cloud Run, stores the work in Cloud Storage, and calls Gemini directly for visual understanding, drafting and review.”

    메모: Gemini API와 Cloud Run, 음성 API의 역할을 나누어 설명한다.
13. **Why does it take minutes?** “We listen again to the candidate pauses, review the lines in the context of the film, synthesize them, then measure the audio and check the track. A rewrite can require another recording. While that runs, a completed track is available to audition.”

    메모: 프레임 첨부가 실제 켜진 최종 점검에 한해서만 사진을 다시 본다고 설명한다.

## 현장에 가져갈 파일

`runtime/finalist-offline/gapline-offline.zip`을 노트북에 복사하고 압축을 푼다. 동봉한
`README.txt`에 실행 방법이 있다. Python 3과 H.264/AAC를 재생할 브라우저가 있으면 발사 무전,
영어 수정 전후 음성, 인터뷰, 한영 완성본과 검수 보고서를 열 수 있다. Node.js로 동봉된 앱을
시작하면 같은 노트북에서 저장된 실행을 편집 화면으로 열어 줄별 검수와 원본 프레임을 확인할 수 있다.
동봉된 앱의 빌드 환경은 Linux x64다. 행사 노트북에서는 리허설 때 편집 화면과 소리를 직접 확인한다.
새 영상 생성과 수정본 저장은 온라인 서비스에서 한다. 키트의 PDF는 공개 제출본이며 결선 양식이 확인되면 교체한다. 관객 인쇄물에는
같은 폴더의 `screening-qr.png`를 쓴다. 노트북의 재생은 오프라인으로 가능하고 QR을 스캔한
관객의 휴대폰은 인터넷 연결이 필요하다.

이 서버의 저장소 루트에서 bash로 다시 만들 때는 `NEXT_DIST_DIR=.next-verify npm run build` 후
`uv run --env-file .env.local scripts/demo/build-offline-kit.py`를 실행한다. 저장된 공개 실행에서 검수
보고서를 만들고, 동봉할 PDF가 기존 릴리스 파일과 일치하는지 확인한다. [생성 스크립트](../scripts/demo/build-offline-kit.py)

## 샘플의 출처

- 발사 비교 영상은 같은 원본의 2~9초를 두 번 연결했다. 옛 실행은 `20260922t051536291-ko-standard-d88b71`, 재청취 뒤 실행은 `20260923t064439178-ko-standard-837b9f`다. 두 믹스의 저장 음량을 사용했다. 작품은 Blender Foundation의 *Tears of Steel*, CC BY 3.0이다.
- 두 정지 화면은 같은 영화의 원본 56.7초와 59.3초에서 추출했다. 영어 해설이 56.7초에 시작한다는 수치는 저장된 실행 `20260928t064307205-en-standard-221ceb`의 자막과 실제 음성을 기준으로 했다. 두 프레임은 기계 눈이 처음 보이는 정확한 프레임을 측정한 결과로 쓰지 않는다.
- 한국어 원본은 Wikitongues / Teddy Nee의 *Hanbid speaking Korean*이다. 45초 평가 영상 중 21~29초를 실행 `20260922t052555638-ko-standard-cb49f5`의 믹스에서 발췌했다. 발췌본도 CC BY-SA 4.0으로 공개한다. 실제 고객이 맡긴 영상과 청취자 검증은 별도다.
- 공개 미디어의 추출 시각과 원본 파일은 [생성 스크립트](../scripts/demo/screening-media.ts)에 있다. 당시 실험과 미해결 항목은 [평가 기록](EVALUATION.md)에 있다.

## 이번 편집에서 확인한 결과

- 영어 샘플에서는 “A man with a robotic eyepiece inspects a brain”을 “Thin electrodes protrude from a brain”으로 고쳤다. 시작은 56.70초, 합성 후 길이는 1.81초였다. 수정본의 다른 다섯 음성 파일은 원본과 바이트가 같았다. 원래 줄과 나란히 놓고 들을 수 있다.
- 11월 20일 공개 서비스에서 한국어 샘플의 이전 실행 `20260922t051536291-ko-standard-d88b71`을 열어 누락된 화면 글자에 “자막, 시뮬레이션 준비 완료.”를 추가했다. 편집본에서는 2.50초 자리에 2.02초 음성이 들어갔고 누락이 두 건에서 한 건으로 줄었다. 원본과 기존 음성 다섯 개는 보존됐다. 내려받기 다섯 종을 확인했고, 다른 브라우저로 편집본의 비공개 자료를 요청하자 404를 받았다.

## 결선 이후 제작자·작가·청취자 검증

| 순서 | 실행 | 결과를 기록할 단위 |
| --- | --- | --- |
| 1. 원본 확보 | 제작자 1곳에서 30~90초 한국어 원본과 검수·본선 공개 범위를 서면으로 받아 둔다. 필수 화면 문구와 보존할 원음을 먼저 정한다. | 사용 가능한 장면, 공개 허용 범위, 제작자가 원하는 납품 파일 |
| 2. 작가 검수 | 작가 1명에게 길이와 난도가 비슷한 두 장면을 배정해 처음부터 작성하는 작업과 생성본을 검수하는 작업을 각각 진행한다. | 작가가 직접 쓴 시간, 시스템 대기 시간, 줄 단위 수정 이유, 납품 인수 여부 |
| 3. 청취 검증 | 시각장애·저시력 청취자 3~5명이 처음 듣는 장면을 사용한다. 두 장면의 원음·해설 조건 배정을 참가자별로 바꾼다. | 시각적 사실 한 문항과 이야기 이해 한 문항의 정답 수/응답 수, 원래 소리를 식별했는지, 휴대폰에서 첫 재생까지 걸린 시간과 도움 횟수 |
| 4. 발표 갱신 | 가장 자주 발생한 오해 한 가지를 고쳐 전후 음성을 비교하고 제작자에게 WAV·VTT를 전달한다. | 공개 동의를 받은 인용, 수정 전후 한 문장, 제작자의 실제 인수 결과 |

이 표는 앞으로 확보할 증거다. 장편 분할 생성, 같은 영상의 단순 생성 기준선과의 독립 비교, 서버 중단 후 단계 재개는 각각 장편 수요, 품질 비교, 장시간 작업 복구라는 별도 질문에 답한다. 이번 짧은 영상 시연을 근거로 세 가지가 검증됐다고 발표하지 않는다.
