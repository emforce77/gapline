"""Endnotes: outside sources behind the deck's claims, numbered in the order the slides cite them.

The texts are the HTML deck's checked notes (phase-1 research of 2026-09-23, reworded there on
2026-09-28), kept word for word; the rule sources come from the pipeline's own guideline table.
Notes carry outside sources only: no run ids, sample figures or build checks (owner, 2026-09-28).
"""

from __future__ import annotations

from dataclasses import dataclass, field

FIXED_NOTES = {
    "hand_made": (
        "Barrier-Free Film Committee FAQ (undated): about ₩14M per Korean film, description and "
        "captions together. 3 months, about 10 people: committee interview, The Better Future "
        "(Futurechosun), 2019. ₩1,358 per US$ (22 Sep 2026)."
    ),
    "filed": (
        "Filed 17 Feb 2016 by blind and deaf moviegoers against CJ CGV, Lotte Cultureworks and "
        "Megabox (MaxMovie; Kyunghyang)."
    ),
    "first_ruling": (
        "Seoul Central District Court 2016가합508596, 7 Dec 2017: the duty covered films whose "
        "producer or distributor supplied description or caption files (화면해설 또는 자막 파일)."
    ),
    "appeal": (
        "Seoul High Court, 25 Nov 2021: open screenings at 3% of each chain’s screenings, only at "
        "multiplexes with a 300-seat hall."
    ),
    "supreme_court": (
        "Supreme Court 2022다203507, 3 Sep 2026 (press release): discrimination upheld; the "
        "appeals court’s cap weighed the chains’ costs too heavily and was sent back. "
        "No new quota yet."
    ),
    "streaming": (
        "Korea Media & Communications Commission (KMCC) notice amended 29 Jun 2026: streaming "
        "services get a duty to make efforts, with no quota or penalty reported (ZDNet Korea; "
        "Digital Daily)."
    ),
    "zones": (
        "Korea Media & Communications Commission (KMCC), 『장애인방송 프로그램 제공 가이드라인』 "
        "(guideline for accessible broadcasting), p.10: “화면해설이 침범할 수 없는 영역은 대사와 "
        "중요한 음향 효과로 지정하는 것이 바람직함”; our translation."
    ),
    "rules": (
        "The 8 rules come from Korea’s audio-description guideline (Korea Media & Communications "
        "Commission) and Netflix’s Audio Description Style Guide v2.5."
    ),
    "words_per_second": (
        "2.5 words a second is MediaScribe’s published budget and Gapline’s own writing budget."
    ),
    "landscape": (
        "Read 23 Sep 2026. MediaScribe (mediascribe.ai): silences of 3 s or more, 2.5 words a "
        "second, overruns summarized and re-voiced. ViddyScribe (docs.viddyscribe.com): 53 "
        "languages including Korean; auto-fit; extended description. Microsoft "
        "(github.com/microsoft/ai-audio-descriptions): measures every line at render and speeds it "
        "up to at most 1.15× in tempo, else the render fails; no review stage; English defaults. "
        "3Play Media, Verbit: human QA; extended description."
    ),
    "supplier": (
        "The 2017 ruling tied cinemas’ duty to films whose producer or distributor supplies the "
        "file; streaming services have had a duty to make efforts since June 2026."
    ),
    "kofic": (
        "The Korean Film Council (KOFIC) runs a barrier-free program for Korean releases (KOFIC "
        "via "
        "Newspim, 24 Mar 2026)."
    ),
}


def data_notes(data: dict) -> dict[str, str]:
    """Notes composed from the exported facts, so a source line changes in one place."""
    audience = data["facts"]["audience"]
    rules = {rule["title"]: rule["source"] for rule in data["product"]["rules"]}
    rejected = ". ".join(f"{title}: {rules[title]}" for title in data["reviewer"]["rejectedFor"])
    prices = " ".join(
        f"{p['who']}: ${p['low']:g}–${p['high']:g} a minute ({p['source']})."
        if p["low"] != p["high"]
        else f"{p['who']}: ${p['low']:g} a minute ({p['source']})."
        for p in data["facts"]["prices"]
    )
    return {
        "reviewer_rules": f"{rejected}.",
        "korea_audience": (
            f"{audience['koreansRegistered'].capitalize()} registered: {audience['koreaSource']}."
        ),
        "asia_pacific": (
            f"About {audience['asiaPacificShare'].removeprefix('about ')} of the world’s "
            f"{audience['worldBlind']} blind people: {audience['worldSource']}."
        ),
        "prices": prices,
    }


@dataclass
class NoteBook:
    """Numbers notes by first citation and remembers the section that first cited each."""

    texts: dict[str, str]
    order: list[tuple[str, str]] = field(default_factory=list)  # (key, section)

    def mark(self, key: str, section: str) -> str:
        if key not in self.texts:
            raise KeyError(f"no note text for {key!r}")
        for i, (seen, _) in enumerate(self.order, 1):
            if seen == key:
                return str(i)
        self.order.append((key, section))
        return str(len(self.order))

    def grouped(self) -> list[tuple[str, list[tuple[int, str]]]]:
        groups: list[tuple[str, list[tuple[int, str]]]] = []
        for number, (key, section) in enumerate(self.order, 1):
            if not groups or groups[-1][0] != section:
                groups.append((section, []))
            groups[-1][1].append((number, self.texts[key]))
        return groups
