import { koEditor } from "./editor";
import type { Dictionary } from "./en";

/** How long generating takes: the same measured numbers as RUN_WAIT in en.ts (see there). */
const RUN_WAIT = {
  detail: "짧은 영상이면 대개 1~3분, 해설할 쉼이 많은 영상이면 9분 가까이",
  range: "영상에 따라 1~9분",
} as const;

export const ko: Dictionary = {
  meta: {
    title: "갭라인 — 대사와 대사 사이에 맞춘 화면해설",
    description:
      "갭라인은 시각장애인 관객을 위한 화면해설을 대사 사이 침묵에 꼭 맞게 쓰고, 검수하고, 낭독해 믹스합니다.",
    project: "{title} — 갭라인",
  },
  nav: { home: "갭라인", language: "English", skip: "본문으로 건너뛰기" },
  landing: {
    eyebrow: "시각장애인을 위한 화면해설",
    title: "대사와 대사 사이에 꼭 맞는 화면해설.",
    lede: "생성하기를 한 번 누르면 모든 단계가 이어집니다. 갭라인은 실제 침묵에 맞춰 해설 문장을 쓰고, 한국의 공개 가이드라인으로 검수하고, 낭독해 길이를 잰 뒤, 최종 점검에서 반려된 문장을 다시 써서 믹스합니다. 다른 표현을 원하면 어떤 문장이든 고칠 수 있고, 갭라인은 그 문장만 다시 낭독해 화면과 나머지 해설에 비춰 검수합니다.",
    ctaSample: "샘플 열어 보기",
    ctaUpload: "내 영상으로 해 보기",
    seven: {
      label: "Tears of Steel, {from}–{to}초",
      title: "대사가 없는 7초",
      body: "“…locked.” 다음 7초 동안 아무도 말하지 않습니다. 시각장애인 관객에게는 말소리 없이 웅웅거리는 소리만 들리다가 “This is pretty freaky.”가 이어집니다. 두 버전을 들어 보세요.",
      original: "원래 소리",
      described: "해설 넣은 소리",
      narration: "해설 언어",
      hidePicture: "눈 감고 듣기",
      idle: "버튼을 누르면 이 7초를 재생합니다.",
      soundtrack: "말소리 없이 배경음만 흐릅니다.",
      waiting: "침묵. 곧 다음 해설이 나옵니다.",
      quiet: "다음 대사가 나올 때까지 침묵이 이어집니다.",
      loading: "불러오는 중…",
      paused: "일시정지했습니다.",
      ended: "재생이 끝났습니다. 버튼을 누르면 이 7초를 다시 재생합니다.",
      failed: "소리를 불러오지 못했습니다. 버튼을 다시 누르면 다시 불러옵니다.",
      pause: "일시정지",
    },
    timelineTitle: "해설은 아무도 말하지 않는 곳에서만 말합니다.",
    timelineLede:
      "갭라인이 보는 샘플 65초입니다. 해설 문장은 침묵 하나를 정해 쓰고, 실제 낭독이 다음 대사 전에 끝나야 합니다.",
    timelineRows: {
      picture: "화면",
      dialogue: "대사",
      dialogueStat: "{n}구간, {s}",
      room: "해설 가능 침묵",
      roomStat: "침묵 {n}곳, {s}",
      narration: "해설",
      narrationStat: "{n}문장",
    },
    shortest: "가장 짧은 침묵: {s}",
    sevenMark: "문제의 7초",
    timelineNote:
      "침묵 구간은 음성 인식기(Chirp 3)의 단어 시각에서 계산하고, 구간마다 한 번 더 따로 들어 봅니다. 두 번째로 들을 때 인식기가 2초 앞에 붙였던 첫 발사 교신을 찾아내, 그 위에는 해설을 넣지 않습니다.",
    flowTitle: "해설 한 줄이 만들어지는 과정",
    flow: [
      {
        name: "듣기",
        detail: "모든 대사의 단어 시각을 잽니다",
        service: "Speech-to-Text · Chirp 3",
      },
      { name: "보기", detail: "장소·인물·화면 글자·중요한 소리", service: "Gemini 3.8 Flash" },
      {
        name: "쓰기",
        detail: "문장마다 침묵 하나를 정해 그 길이에 맞춰",
        service: "Gemini 3.8 Flash",
      },
      {
        name: "검수",
        detail: "가이드라인 조항을 인용하는 8개 규칙",
        loop: "반려되면 검수 의견대로 두 번까지 다시 씀",
        service: "Gemini 3.8 Flash",
      },
      {
        name: "낭독",
        detail: "실제 낭독 길이를 침묵과 비교합니다",
        loop: "길면 빠르게 읽거나 줄이거나 제외",
        service: "Text-to-Speech · Chirp 3 HD",
      },
      {
        name: "최종 점검·믹스",
        detail: "낭독된 트랙 전체를 최종 점검한 뒤, 해설 동안 원음을 낮춥니다",
        loop: "반려된 문장은 다시 쓰고, 자리가 남은 침묵에는 문장을 더하기도 함",
        service: "Gemini 3.8 Flash · Cloud Run의 FFmpeg",
      },
    ],
    rejectionTitle: "반려마다 근거 조항이 붙습니다",
    rejectionLede:
      "샘플 {time} 지점의 문장이 실행 기록에 남은 그대로입니다. 작성과 검수는 같은 모델이 서로 다른 지시로 맡습니다.",
    rejection: {
      step: {
        write: "첫 초안",
        revise: "다시 씀",
        shorten: "줄임",
        add: "누락 보완으로 추가",
        human: "편집자 수정본",
        remove: "편집자가 삭제",
      },
      rejected: "반려",
      sentBack: "최종 점검에서 반려",
      passed: "검수 통과",
      suggestion: "수정 제안",
      next: {
        revise: "갭라인은 이 제안대로 문장을 다시 쓰고 다시 검수했습니다.",
        final:
          "이 초안은 검수를 통과해 낭독까지 됐지만, 낭독된 트랙 전체를 다시 보는 최종 점검이 반려했습니다. 갭라인은 제안대로 문장을 다시 썼습니다.",
        human:
          "다시 써도 규칙을 어겨서 갭라인은 이 문장을 읽지 않고 제외했습니다. 다음 버전은 사람이 직접 썼습니다.",
      },
      fitted: "주어진 {room} 가운데 {spoken} 동안 읽음",
      human: "갭라인은 편집자의 문장을 검수하고 읽지만, 대신 고쳐 쓰지는 않습니다.",
    },
    rulesSummary: "검수 규칙 {n}개와 근거 조항 전체 보기",
    measuredTitle: "샘플에서 잰 값",
    measuredRun:
      "65초 클립의 {language} 해설을 한 번 만드는 데 든 API 비용은 {cost}, 걸린 시간은 {time}입니다. {shipped}문장 중 {fit}문장이 침묵 안에 들어갔고, Chirp 3가 인식한 대사와 겹친 해설은 {overlap}입니다.",
    measuredEdit: "이후 이 문장을 직접 고치는 데 든 비용은 {cost}, 걸린 시간은 {time}입니다.",
    measuredReused:
      "듣기와 보기는 이 클립의 이전 실행 결과를 재사용했기 때문에, 그 비용과 시간은 포함하지 않았습니다.",
    measuredNote: "API 비용만 계산했습니다. Cloud Run과 저장소 비용은 포함하지 않았습니다.",
    whyTitle: "법은 화면해설을 요구하는데, 만드는 속도는 그대로입니다.",
    why: [
      {
        figure: "2026. 9. 3.",
        text: "10년 소송 끝에 대법원이, 화면해설과 자막 없이 영화를 상영하는 것은 3대 극장 체인의 차별이라고 확정했습니다.",
        sources: [
          {
            label: "대법원 2022다203507 보도자료",
            url: "https://www.scourt.go.kr/portal/news/NewsViewAction.work?gubun=6&seqnum=3044&type=0",
          },
        ],
      },
      {
        figure: "3개월",
        text: "2019년 보도 기준, 배리어프리 영화 한 편을 만드는 데 걸리는 시간입니다. 전문가 10여 명이 참여하며, 배리어프리영화위원회 FAQ에 따르면 비용은 1,400만 원(화면해설·자막 포함)입니다.",
        sources: [
          {
            label: "배리어프리영화위원회 FAQ(날짜 미표기)",
            url: "https://barrierfreefilms.or.kr/board_hrgp25/682",
          },
          {
            label: "2019년 인터뷰(보관본)",
            url: "https://web.archive.org/web/20260511062907/https://futurechosun.com/archives/43832",
          },
        ],
      },
    ],
    whyClose:
      "갭라인은 이 간극을 메우려고 만들었습니다. 생성하기를 한 번 누르면 영화의 침묵에 맞는 화면해설 트랙을 쓰고, 검수하고, 낭독해 믹스까지 마칩니다.",
    uploadIntro: `90초, 30MB 이하 영상을 받습니다. 영상 준비는 1분 안에 끝납니다. 해설 생성은 ${RUN_WAIT.detail} 걸리며, 유료 Google Cloud와 Gemini API를 호출합니다. 생성 한도는 하루 단위이며 모든 방문자가 함께 씁니다. 올린 영상은 그 브라우저에서만 열 수 있습니다.`,
    uploadTitle: "내 영상",
    uploadHint:
      "MP4, MOV, WebM, 3초~90초, 30MB 이하. 65초 샘플의 {language} 해설은 생성에 {time} 걸렸고, 비용은 {cost}입니다.",
    uploadChoose: "영상 고르기",
    uploadWorking: "영상을 준비하는 중…",
    uploadTooLong: "90초보다 긴 영상입니다. 한 장면으로 잘라서 다시 올려 주세요.",
    uploadFailed: "이 영상을 읽지 못했습니다. MP4(H.264)로 다시 내보낸 뒤 올려 주세요.",
    footerFilm: "샘플 영화: Tears of Steel, (CC) Blender Foundation | {site}, {license}.",
    footerGuides: "가이드라인: {kmcc}, {netflix}.",
    footerSource: "소스 코드·작동 방식·데모 영상: {repo}.",
    footerLinks: {
      repo: "github.com/emforce77/gapline",
      site: "mango.blender.org",
      license: "CC BY 3.0",
      kmcc: "방미통위(옛 방송통신위원회) 『장애인방송 프로그램 제공 가이드라인』(2019, PDF)",
      netflix: "Netflix 화면해설 스타일 가이드 v2.5(영문)",
    },
  },
  upload: {
    drop: "놓으면 바로 올라갑니다.",
    dropHint: "영상을 여기에 끌어 놓거나 골라 주세요.",
    checking: "파일을 확인하는 중…",
    uploading: "올리는 중 {percent}",
    progressLabel: "업로드 진행률",
    sendingName: "올리는 중…",
    cancel: "업로드 취소",
    cancelled: "업로드를 취소했습니다.",
    preparing: "영상을 변환하고 길이를 재는 중입니다. 보통 1분 안에 끝납니다.",
    errors: {
      too_large:
        "이 파일은 {size}입니다. {max}까지 올릴 수 있습니다. 720p로 내보내거나 한 장면으로 잘라서 다시 올려 주세요.",
      too_long:
        "이 영상은 {length}입니다. {max}까지 받습니다. 한 장면으로 잘라서 다시 올려 주세요.",
      too_short:
        "3초보다 짧은 영상이거나 사진 한 장입니다. 설명을 넣을 틈을 찾으려면 3초 이상인 장면이 필요합니다.",
      not_video: "영상 파일이 아닙니다. MP4, MOV, WebM 파일을 골라 주세요.",
      no_video_stream:
        "소리만 있고 화면이 없는 파일입니다. 갭라인은 화면에 보이는 것을 설명하므로 영상이 필요합니다.",
      missing_file: "파일이 전달되지 않았습니다. 영상을 다시 골라 주세요.",
      forbidden:
        "이 페이지에서 보낸 요청이 아니어서 거부되었습니다. 페이지를 새로 고친 뒤 다시 시도해 주세요.",
      internal:
        "영상을 준비하다가 서버에서 문제가 생겼습니다. 1분 뒤 다시 시도하거나 다른 파일을 올려 주세요.",
      network: "업로드가 갭라인에 닿지 않았습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.",
      unexpected: "갭라인이 오류로 응답했습니다(HTTP {status}). 1분 뒤 다시 시도해 주세요.",
    },
    status: {
      budget_busy: `지금은 다른 방문자의 생성 작업이 오늘 남은 한도를 쓰고 있습니다. 영상은 지금 올릴 수 있고, 그중 하나가 끝나면 생성할 수 있습니다. 생성은 ${RUN_WAIT.range} 걸립니다.`,
      budget_daily:
        "오늘의 실시간 생성 한도를 다 썼습니다. 영상은 지금 올려 두고 한도가 다시 채워진 뒤 생성할 수 있으며, 샘플의 기록된 결과는 언제든 재생됩니다.",
    },
  },
  live: {
    leaveNote: "연결이 끊기면 이 페이지를 새로 고치세요. 진행 중인 생성을 이어서 보여 줍니다.",
    lost: "연결이 끊겼지만 생성은 서버에서 계속됩니다. 몇 초마다 진행 상황을 확인합니다…",
    following: "시작한 생성을 이어서 보고 있습니다. 몇 초마다 진행 상황을 확인합니다…",
    elapsed: `생성을 시작한 지 {elapsed} 지났습니다. 생성은 ${RUN_WAIT.detail} 걸립니다.`,
    confirming: "생성을 시작하는 순간 연결이 끊겼습니다. 서버에서 생성이 시작됐는지 확인하는 중…",
    active: "{time}에 시작한 {language} {density} 해설이 아직 만들어지고 있습니다.",
    follow: "이어서 보기",
    unreachable:
      "갭라인이 응답하지 않아 이 페이지가 생성 진행 확인을 멈췄습니다. 생성은 서버에서 계속되어 끝날 수 있으니, 연결이 돌아오면 다시 확인하거나 나중에 이 페이지를 새로 고쳐 주세요.",
    interrupted: "생성이 끝나지 못하고 멈춰 결과가 저장되지 않았습니다. 다시 생성할 수 있습니다.",
    notStarted: "생성이 시작되지 않았습니다. 다시 시도해 주세요.",
    notStartedChecked:
      "갭라인이 응답하지 않았고 새로 시작된 생성도 보이지 않아, 생성이 시작되지 않은 것으로 보입니다. 인터넷 연결을 확인하고 다시 시도해 주세요.",
    notFound: "이 생성 기록을 찾을 수 없습니다. 다른 브라우저에서 시작한 것일 수 있습니다.",
    loadFailed: "결과를 불러오지 못했습니다. 결과는 저장되어 있으니 잠시 뒤 다시 시도해 주세요.",
    savedNotListed:
      "수정한 내용은 새 결과로 저장됐지만, 이 페이지에서 아직 열지 못했습니다. 페이지를 새로 고치면 볼 수 있습니다.",
    editPending:
      "{line} 수정을 아직 낭독하고 점검하는 중입니다. 저장되면 새 버전이 여기에서 열립니다.",
    editPendingElapsed: "지금까지 {elapsed}",
    editStopped:
      "{line} 수정이 저장되기 전에 멈췄습니다. 수정하기 전 결과는 그대로이니, 이 문장을 다시 수정할 수 있습니다.",
    editUnknown:
      "{line} 수정이 저장됐는지 이 페이지에서 확인하지 못했습니다. 나중에 페이지를 새로 고쳐 확인해 주세요.",
    renews: "{time}에 다시 채워집니다({wait}).",
    reference: "참조 번호: {runId}.",
    retry: "다시 시도",
    checkAgain: "다시 확인",
    littleRoom:
      "이 영상에서 해설을 넣을 만큼 긴 침묵은 모두 {room}뿐입니다. 해설을 제대로 넣으려면 {needed} 이상이 필요합니다. 해설은 아무도 말하지 않는 약 {pause} 이상의 쉼에만 들어가므로, 대사나 내레이션이 계속되는 영상에는 해설이 거의 들어가지 않습니다. 쉼이 긴 장면이 더 잘 맞습니다.",
    status: {
      budget_busy: `지금은 다른 방문자의 생성 작업이 오늘 남은 한도를 쓰고 있습니다. 그중 하나가 끝나면 새로 시작할 수 있습니다. 생성은 ${RUN_WAIT.range} 걸립니다.`,
      budget_daily: "오늘의 실시간 생성 한도를 다 썼습니다. 이미 만든 결과는 계속 재생됩니다.",
      visitor_busy:
        "직접 시작한 다른 해설 생성이나 수정이 아직 진행 중입니다. 방문자마다 한 번에 하나씩 만들 수 있어, 그 작업이 끝나면 새로 시작할 수 있습니다.",
      visitor_daily:
        "오늘 쓸 수 있는 실시간 생성 몫을 다 썼습니다. 이미 만든 결과는 계속 재생됩니다.",
    },
    errors: {
      budget_busy: `지금은 다른 방문자의 생성 작업이 오늘 남은 한도를 쓰고 있어 생성을 시작하지 못했습니다. 그중 하나가 끝나면 다시 시도해 주세요. 생성은 ${RUN_WAIT.range} 걸립니다.`,
      budget_daily: "오늘의 실시간 생성 한도를 다 썼습니다. 이미 만든 결과는 계속 재생됩니다.",
      visitor_busy:
        "먼저 시작한 해설 생성이나 수정이 아직 진행 중입니다. 방문자마다 한 번에 하나씩만 할 수 있으니, 그 작업이 끝나면 다시 시도해 주세요.",
      visitor_daily:
        "오늘 쓸 수 있는 실시간 생성 몫을 다 썼습니다. 이미 만든 결과는 계속 재생됩니다.",
      run_allowance:
        "이번 생성이 비용 상한에 닿아 멈췄고, 결과는 저장되지 않았습니다. 더 짧은 영상은 비용이 덜 듭니다.",
      provider_busy: "모델이 지금 과부하 상태입니다. 1~2분 뒤 다시 시도해 주세요.",
      provider_failed:
        "모델 서비스가 요청을 거부해 생성이 멈췄습니다. 저희 쪽 문제이니 나중에 다시 시도해 주세요.",
      model_output:
        "모델의 답이 정해진 형식을 벗어나, 추측하지 않고 생성을 멈췄습니다. 다시 시도하면 대개 됩니다.",
      speech_failed:
        "Google Speech-to-Text에 연결할 수 없거나 요청이 몰려 생성이 멈췄습니다. 1분 뒤 다시 시도해 주세요.",
      voice_failed:
        "Google Text-to-Speech가 해설을 낭독하다 실패했습니다. 1분 뒤 다시 시도해 주세요.",
      media_failed:
        "영상을 처리하다가 실패했습니다. 다시 시도해도 같은 이유로 실패할 가능성이 높으니 다른 영상을 써 보세요.",
      internal: "서버에서 문제가 생겨 생성이 멈췄습니다. 다시 시도해 주세요.",
      forbidden:
        "이 페이지에서 보낸 요청이 아니어서 거부되었습니다. 페이지를 새로 고친 뒤 다시 시도해 주세요.",
      not_found: "이 영상을 더 이상 찾을 수 없습니다. 페이지를 새로 고쳐 주세요.",
      invalid_request: "요청을 이해하지 못했습니다. 페이지를 새로 고친 뒤 다시 시도해 주세요.",
      run_active:
        "이 영상에서 시작한 생성이 아직 진행 중입니다. 아래에서 이어서 보거나 끝날 때까지 기다려 주세요.",
      connection: "갭라인에 연결할 수 없습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.",
      server_busy:
        "지금 갭라인에 요청이 몰려 생성을 시작하지 못했습니다. 1분 뒤 다시 시도해 주세요.",
      unknown: "생성이 끝나지 못하고 멈췄습니다. 다시 시도해 주세요.",
    },
    noRetry: {
      speech_failed:
        "Google Speech-to-Text가 요청을 거부해 생성이 멈췄습니다. 다시 시도해도 같은 이유로 실패할 가능성이 높습니다. 다른 영상은 될 수도 있지만, 그 영상도 실패하면 저희 쪽 문제입니다.",
      voice_failed:
        "Google Text-to-Speech가 해설 낭독 요청을 거부해 생성이 멈췄습니다. 저희 쪽 문제이니 나중에 다시 시도해 주세요.",
    },
  },
  notFound: {
    metaTitle: "페이지를 찾을 수 없음 — 갭라인",
    title: "이 페이지는 없습니다.",
    body: "올린 영상은 그 브라우저에서만 열립니다. 다른 기기에서 열거나 다른 사람에게 공유한 링크는 이 페이지로 옵니다.",
    sample: "샘플 열어 보기",
    home: "갭라인 처음으로",
  },
  failure: {
    title: "영상을 여는 중에 문제가 생겼습니다.",
    body: "일시적인 문제일 수 있습니다. 다시 시도하거나 페이지를 새로 고쳐 주세요.",
    retry: "다시 시도",
    partial:
      "이 페이지의 일부를 불러오지 못했습니다. 갭라인이 붐비는 중일 수 있으니 새로 고쳐 주세요.",
    reload: "새로 고침",
  },
  workspace: {
    narration: "해설 언어",
    density: "해설 밀도",
    densityStandard: "표준",
    densityBrief: "간결",
    generate: "생성하기",
    regenerate: "다시 생성",
    generating: "생성하는 중…",
    liveNote: `실시간 생성은 유료 API를 호출하며, ${RUN_WAIT.detail} 걸립니다. 새 결과가 나올 때까지 지금 결과는 계속 재생됩니다.`,
    newVersion: "새 버전 (생성하는 중…)",
    unfinishedVersion: "새 버전 (완료되지 않음)",
    loadingRun: "결과를 불러오는 중…",
    runFinished:
      "생성이 끝났습니다. 해설 {lines}이 들어간 영상을 ‘해설과 함께 재생’으로 들을 수 있습니다.",
    runFinishedEmpty:
      "생성이 끝났지만 이 영상의 침묵에 맞는 해설 문장이 없어, 영상에 해설이 들어가지 않았습니다.",
    replayFinished: "다시 보기가 끝났습니다.",
    samplePrivate: "이 샘플에서 만든 버전은 이 브라우저에서 나만 볼 수 있습니다.",
    replay: "과정 다시 보기",
    replaying: "{speed}배속으로 다시 보는 중",
    stopReplay: "다시 보기 멈춤",
    noRun: "생성하기를 누르면 {language} 트랙을 만듭니다.",
    noRunHint: "65초 샘플의 {language} 해설 생성에 {time}, {cost}가 들었습니다.",
    noRunHintHere: "이 영상의 {language} 해설 생성에 {time}, {cost}가 들었습니다.",
    noRunHintFirst:
      "이 수치에는 샘플이 이전 실행에서 재사용한 듣기·보기가 빠져 있습니다. 이 영상의 첫 생성은 둘 다 새로 하므로 더 오래 걸립니다.",
    paidNote: "실시간 생성은 유료 API를 호출합니다.",
    adOn: "해설 켬",
    adOff: "해설 끔",
    eyesClosed: "눈 감고 듣기",
    eyesOpen: "화면 보기",
    listening: "듣는 중",
    play: "재생",
    playDescribed: "해설과 함께 재생",
    pause: "일시정지",
    keys: "플레이어에 초점이 있을 때 단축키: Space·K 재생 · D 해설 · E 눈 감고 듣기",
    captionIdle: "해설이 나오는 동안 여기에 문장이 표시됩니다.",
    dialogue: "인식된 대사",
    videoFailed: "영상을 불러오지 못했습니다.",
    downloads: "내려받기",
    downloadDescribed: "해설 입힌 영상 (MP4)",
    downloadNarration: "해설 음성 트랙 (WAV)",
    downloadVtt: "해설 텍스트 트랙 (WebVTT)",
    downloadScript: "대본·검수 기록 (JSON)",
    notRecorded: "이전 결과에는 기록되지 않음",
    noDescription: "이 결과에는 해설 없음",
    selected: "{line} 선택됨",
    stageAnnounce: "{stage}: {state}",
  },
  versions: {
    original: "자동 생성",
    edit: "수정 {n}",
    restored: "{line} 복원",
    changed: "{line} 수정",
    removed: "{line} 삭제",
    moved: "{line} 위치 이동",
    basedOnMoved:
      "“{parent}”에서 이어진 결과입니다. {line}은 문장은 그대로 두고 시작 위치만 옮겨 다시 낭독했고, 나머지 문장은 그대로 재사용했습니다.",
    basedOn:
      "“{parent}”에서 이어진 결과입니다. 사람이 쓴 문장으로 {line} 한 줄만 다시 낭독했고, 나머지 문장은 그대로 재사용했습니다.",
    basedOnRemoved:
      "“{parent}”에서 이어진 결과입니다. 편집자가 삭제한 문장: {line}. 나머지 문장은 그대로 재사용했고, 남은 해설로 최종 점검을 다시 했습니다.",
  },
  timeline: {
    picture: "화면",
    dialogue: "대사",
    recognized: "인식 결과",
    soundless: "소리가 없는 클립이라 피해야 할 대사가 없습니다.",
    room: "해설 가능 침묵",
    narration: "해설",
    seconds: "{n}초",
    relistenSpeech: "다시 들어 찾은 대사, {from}부터 {to}까지: {text}",
  },
  stages: {
    title: "진행 상황",
    hear: "듣기",
    relisten: "침묵 구간 다시 듣기",
    watch: "보기",
    gaps: "침묵 찾기",
    write: "쓰기",
    review: "검수",
    voice: "낭독",
    verify: "최종 점검",
    fix: "점검 결과 반영",
    mix: "믹스",
    waiting: "대기",
    reused: "이 클립의 이전 실행 결과 재사용",
    skipped: "고칠 점 없음",
    running: "진행 중 · {elapsed}",
    done: "{seconds}초",
    doneState: "완료",
    runningState: "진행 중",
    stopped: "중단됨",
    lost: "연결 끊김",
    stoppedState: "중단됨",
    relistenFound: "침묵 {gaps}곳 · 들린 단어 {words}개 · 줄어든 침묵 {blocked}",
    relistenQuiet: "침묵 {gaps}곳 · 들린 말 없음",
    relistenNone: "다시 들을 침묵 없음",
    relistenSoundless: "소리가 없는 클립이라 다시 들을 구간 없음",
  },
  line: {
    title: "해설 {n}",
    cueLabel: "{line}, {time}, {state}",
    state: {
      fits: "침묵 안에 맞음",
      approved: "검수 통과",
      rejected: "검수 반려",
      dropped: "제외됨",
      removed: "편집자가 삭제함",
      pending: "진행 중",
    },
    room: "자리",
    spoken: "낭독",
    rate: "속도 {rate}배",
    fits: "침묵 안에 맞음",
    voiced: "낭독: {rate}배속으로 {seconds}",
    tooLong: "자리 {room}보다 김",
    history: "이 문장이 만들어진 과정",
    by: {
      write: "초안",
      revise: "다시 씀",
      shorten: "줄임",
      add: "누락 보완으로 추가",
      human: "사람이 수정",
      remove: "편집자가 삭제",
    },
    sameWords: "v{n} 문장과 같음",
    moved: "시작 시각 {from} → {to}",
    passed: "검수 통과",
    rejected: "반려",
    fix: "고칠 점",
    dropped: {
      no_room: "제외: 말할 자리가 없음",
      invalid_placement: "반려: 지정 시각이 해당 공백 밖에 있음",
      unchanged: "반려: 수정 전후 문구가 같음",
      review: "제외: 다시 써도 조항 위반",
      too_long: "제외: 줄여도 침묵보다 김",
    },
    verdict: {
      firstPass: "첫 초안에서 검수 통과",
      rejectedOnce: "한 번 반려",
      rejectedTwice: "두 번 반려",
      rejectedMany: "{n}번 반려",
      sentBack: "최종 점검에서 반려된 뒤",
      byEditor: "편집자가 고쳐서 통과",
      sameWords: "같은 문장으로 다시 통과",
      rewritten: "다시 써서 통과",
      shortened: "길이에 맞춰 줄임",
    },
    evidence: "모델의 장면 메모 (읽지 않음)",
    pickHint:
      "타임라인이나 ‘문장 선택’ 목록에서 해설 문장을 고르면 쓰기·검수·낭독 과정을 볼 수 있습니다.",
    pickHintKeys: "키보드로는 목록에서 문장으로 옮긴 뒤 Enter를 누르면 열립니다.",
    play: "여기부터 재생",
    close: "진행 상황으로",
  },
  metrics: {
    lines: "읽은 문장",
    line: "읽은 문장",
    fit: "침묵 안에 맞음",
    overlap: "인식된 대사와 겹친 해설",
    caught: "점검에서 반려",
    cost: "예상 API 비용",
    time: "처리 시간",
  },
  editor: koEditor,
  coverage: { title: "검수에서 찾은 누락" },
};
