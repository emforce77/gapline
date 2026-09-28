/**
 * Facts from outside the repo, typed by hand from the checked phase-1 research (impact.md,
 * landscape.md, 2026-09-23). Each carries the short source line printed under it. Numbers measured by
 * Gapline itself are not here: they come from runtime/ through data/.
 */

export interface DatedEvent {
  /** ISO date; the slide places it on a year axis. */
  date: string;
  label: string;
  source: string;
}

/** The Korean cinema lawsuit, from filing to the Supreme Court. */
export const LAWSUIT = {
  filed: "2016-02-17",
  parties: "Blind and deaf moviegoers v. CGV, Lotte Cinema and Megabox",
  events: [
    {
      date: "2017-12-07",
      label:
        "First ruling: the duty covers only films that arrive with description or caption files",
      source: "Seoul Central District Court 2016Gahap508596",
    },
    {
      date: "2021-11-25",
      label: "Appeals court caps it at 3% of screenings",
      source: "Seoul High Court",
    },
    {
      date: "2026-09-03",
      label: "Supreme Court: discrimination confirmed, cap set aside and sent back",
      source: "Supreme Court 2022Da203507",
    },
  ] satisfies DatedEvent[],
};

export const STREAMING_DUTY: DatedEvent = {
  date: "2026-06-29",
  label: "Regulator extends accessible-broadcast duties to streaming, as a duty to make efforts",
  source: "KMCC notice amendment",
};

/** One accessible (described and captioned) Korean film, made by hand. */
export const HAND_MADE = {
  months: 3,
  specialists: 10,
  wonMillions: 14,
  /** A foreign film, with Korean dubbing added (same FAQ). */
  foreignWonMillions: 31,
  usdThousands: 10,
  source:
    "Barrier-Free Film Committee FAQ (undated; covers description and captions); The Better Future (Futurechosun) 2019 interview",
};

export const AUDIENCE = {
  koreansRegistered: "about 244,000",
  koreaSource: "Ministry of Health and Welfare, end of 2025 (9.3% of 2,627,761 registered)",
  asiaPacificShare: "about 64%",
  worldBlind: "43 million",
  worldSource: "our sum of GBD 2020 regional rows, Lancet Global Health 2021",
};

/** Per-minute prices for description, as published. */
export const PRICE_POINTS = [
  { who: "Human writer and voice", low: 15, high: 75, source: "3Play Media, 2022" },
  {
    who: "Human writer, synthetic voice",
    low: 7.25,
    high: 11.25,
    source: "UW–Madison contract, 2026",
  },
  {
    who: "AI vendor (MediaScribe)",
    low: 0.67,
    high: 0.67,
    source: "$4,000 for 100 hours, mediascribe.ai",
  },
];

export type Support = "yes" | "partly" | "no" | "unknown";
export interface CompetitorCell {
  support: Support;
  note: string;
  /** Cells to the right this one also covers (one note for several columns). */
  span?: number;
}
export const COMPARE_COLUMNS = [
  "Fits measured voice",
  "Re-checks every change",
  "Cites a guideline",
  "Reports what it missed",
  "Korean guideline, voice",
  "Pauses the film",
];
/**
 * Rows from landscape.md (vendor pages and code read 23 Sep 2026). "unknown" is drawn as a dash: the
 * vendor does not document it. "no" is used only where the vendor's own code or pages show it.
 */
export const COMPETITORS: { name: string; kind: string; cells: CompetitorCell[] }[] = [
  {
    name: "MediaScribe",
    kind: "",
    cells: [
      { support: "yes", note: "summarizes, re-voices" },
      { support: "unknown", note: "" },
      { support: "unknown", note: "" },
      { support: "unknown", note: "" },
      { support: "unknown", note: "" },
      { support: "unknown", note: "" },
    ],
  },
  {
    name: "ViddyScribe",
    // Gemini API Developer Competition winner, 2024: in the slide's note, to keep the face short.
    kind: "",
    cells: [
      { support: "partly", note: "" },
      { support: "unknown", note: "" },
      { support: "unknown", note: "" },
      { support: "unknown", note: "" },
      { support: "partly", note: "Korean voices" },
      { support: "yes", note: "" },
    ],
  },
  {
    name: "Microsoft, open source",
    kind: "",
    cells: [
      // Its tempo cap, 1.15×, said in words: the slide face carries no multipliers.
      { support: "yes", note: "up to 15% faster" },
      { support: "partly", note: "fit only; render fails" },
      { support: "no", note: "" },
      { support: "no", note: "" },
      { support: "no", note: "English only" },
      { support: "no", note: "" },
    ],
  },
  {
    name: "3Play Media, Verbit",
    kind: "",
    cells: [
      { support: "unknown", note: "" },
      { support: "yes", note: "human QA" },
      { support: "partly", note: "US DCMP guide" },
      { support: "unknown", note: "" },
      { support: "unknown", note: "" },
      { support: "yes", note: "" },
    ],
  },
];
/** Gapline's own row. Guideline names are said in words: the slide face carries no acronyms. */
export const SCENE_ROW: CompetitorCell[] = [
  { support: "yes", note: "speed, shorten, drop" },
  { support: "yes", note: "rewrites, shortenings, fixes" },
  { support: "yes", note: "Korea, Netflix" },
  { support: "yes", note: "" },
  { support: "yes", note: "" },
  { support: "no", note: "" },
];

/** KOFIC's barrier-free film program in 2025, via Newspim (24 Mar 2026); single secondary source. */
export const KOFIC_2025 = {
  source: "KOFIC via Newspim, 24 Mar 2026",
};

/**
 * Links and names the close slide prints once the owner has them. `npm run deck -- --final` refuses
 * to build while any is missing or the Gemini access label still names the development route.
 */
export const SUBMISSION: {
  /** The deployed Cloud Run URL, once the service is up again for judging. */
  demoUrl: string | null;
  repoUrl: string | null;
  videoUrl: string | null;
  team: string | null;
} = {
  demoUrl: null,
  repoUrl: null,
  videoUrl: null,
  team: null,
};

export const FILM_CREDIT = "Tears of Steel © Blender Foundation, CC BY 3.0, mango.blender.org";
export const THEME = "Media, Content & Digital Experiences";
/** The impact category the themes page asks entrants to name (rules.md §2). */
export const CATEGORY = "Accessibility";
