"""Read the public demo's budget ledger and local finalist ledgers. Run from the repository root
with python3 scripts/finalist-spend.py. An extra --local-dir is a known independent DATA_DIR.
UTC dates follow reserveRun/budgetDay. Ledger charges and token estimates are not provider invoices.
"""

import argparse
import json
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

START = "2026-11-20"
BUCKET = "gs://scene-ad-data-117546381357/budget/demo-v2.json"
ROOT = Path(__file__).resolve().parents[1] / "runtime"
STOP = Decimal(4)
TOTAL = Decimal(5)


def parse(raw):
    return json.loads(raw, parse_float=Decimal)


def money(value):
    n = Decimal(str(value))
    if not n.is_finite() or n < 0:
        raise ValueError("음수 또는 유효하지 않은 원장 금액")
    return n


def summarize(live, roots):
    days = defaultdict(Counter)
    seen = {}
    duplicate_calls = set()
    sources = [("live", live)]
    for root in sorted(set(p.resolve() for p in roots)):
        if not root.is_dir():
            raise FileNotFoundError(root)
        for scope in ("demo", "experiment"):
            path = root / "budget" / f"{scope}-v2.json"
            if path.is_file():
                sources.append(("local", parse(path.read_text())))

        # These two measurement drivers use a call ledger without reserveRun. Local run and edit
        # call ledgers are already covered by the settled reservation in their DATA_DIR.
        for task in ("picture-check", "oneshot-baseline"):
            ledger = root / "measure" / task / "ledger.jsonl"
            if not ledger.is_file():
                continue
            occurrences = Counter()
            for line in ledger.read_text().splitlines():
                call = parse(line)
                day = call["at"][:10]
                if day < START:
                    continue
                fingerprint = json.dumps(call, sort_keys=True, default=str)
                occurrences[fingerprint] += 1
                key = (fingerprint, occurrences[fingerprint])
                if key in duplicate_calls:
                    continue
                duplicate_calls.add(key)
                days[day]["calls"] += 1
                days[day]["local_calls_usd"] += money(call["costUsd"])
                if call.get("costKnown") is False or call.get("costSource") == "unknown":
                    days[day]["unknown"] += 1
                    # Include only the amount still at risk above any already recorded subtotal.
                    ceiling = call.get("boundUsd", "0.29" if task == "picture-check" else "0.20")
                    days[day]["unknown_bound"] += max(Decimal(0), money(ceiling) - money(call["costUsd"]))

    for source, state in sources:
        if any(day >= START and money(cost) for day, cost in state["legacy"].items()):
            raise ValueError("결선 기간에 이전 형식 금액이 있습니다. 예약과 중복 여부를 확인하세요.")
        for entry in state["entries"]:
            if entry["date"] < START:
                continue
            key = entry["id"]
            if key in seen:
                origin, previous = seen[key]
                if (entry["date"], entry["amount"], entry["scope"]) != (
                    previous["date"], previous["amount"], previous["scope"]
                ):
                    raise ValueError(f"예약 복사본의 날짜·금액·범위가 다릅니다: {key}")
                if entry == previous or (entry["done"] is False and previous["done"] is True):
                    continue
                if origin == "live" or previous["done"] or not entry["done"]:
                    raise ValueError(f"예약 복사본의 값이 다릅니다: {key}")
            seen[key] = (source, entry)

    for source, entry in seen.values():
        row = days[entry["date"]]
        if entry["done"] is True:
            row[source + "_n"] += 1
            if entry["cost"] is not None:
                row[source + "_usd"] += money(entry["cost"])
            else:
                row["unknown"] += 1
                row["unknown_bound"] += money(entry["amount"])
        elif entry["done"] is False:
            row["pending_n"] += 1
            row["pending_usd"] += money(entry["amount"])
        else:
            raise ValueError("예약 정산 상태를 해석할 수 없습니다")
    return days


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--local-dir", type=Path, action="append", default=[])
    extra = args.parse_args().local_dir
    live = parse(subprocess.check_output(["gcloud", "--configuration=gapline", "storage", "cat", BUCKET]))
    # This staging directory contains the local edit used in the public English sample.
    roots = [ROOT, *ROOT.glob("finalist-en-reveal-*"), *extra]
    days = summarize(live, roots)
    days[datetime.now(timezone.utc).date().isoformat()]
    total = Counter()
    for day, row in sorted(days.items()):
        total.update(row)
        print(f"{day} UTC  라이브 정산 {row['live_n']}건 ${row['live_usd']:.9f}  "
              f"로컬 정산 {row['local_n']}건 ${row['local_usd']:.9f}  "
              f"독립 측정 {row['calls']}호출 ${row['local_calls_usd']:.9f}  "
              f"미정산 {row['pending_n']}건 ${row['pending_usd']:.9f} 예약  "
              f"원장에 명시된 비용 불명 {row['unknown']}건")
    charged = total['live_usd'] + total['local_usd'] + total['local_calls_usd']
    held = total['pending_usd'] + total['unknown_bound']
    print(f"11/20 이후 원장 합계 ${charged:.9f}, 미정산·미확정 예약 상한 ${held:.9f}. "
          f"결선 외 중지선 ${STOP}, 결선 포함 총예산 ${TOTAL}.")
    if charged >= STOP:
        print("중지선 도달. 결선 당일 외 유료 작업을 중지하세요.")
    elif total['unknown'] or charged + held >= STOP:
        print("보류. 미확정 비용 또는 예약을 확인한 뒤 남은 예산을 판단하세요.")
    else:
        print("조회한 원장 기준 중지선 미도달. 정산액에는 사용량 추정·보수적 차감이 포함될 수 있습니다.")


if __name__ == "__main__":
    main()
