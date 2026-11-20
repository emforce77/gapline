"""Preview Gapline's upload retention rule. Applying it requires the approved preview digest."""

import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BUCKET = "scene-ad-data-117546381357"
ENDPOINT = f"https://storage.googleapis.com/storage/v1/b/{BUCKET}"
PREFIX = "projects/u-"
RULE_FILE = Path(__file__).with_name("upload-lifecycle-rule.json")


def instant(timestamp):
    return datetime.fromisoformat(timestamp.replace("Z", "+00:00"))


def storage_request(token, resource="", query=None, patch=None):
    url = ENDPOINT + resource + "?" + urlencode(query or {})
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
    request = Request(
        url,
        headers=headers,
        method="GET" if patch is None else "PATCH",
        data=None if patch is None else json.dumps(patch).encode(),
    )
    with urlopen(request, timeout=45) as response:
        return json.load(response)


def eligible_objects(request, now):
    query = {
        "prefix": PREFIX,
        "versions": "true",
        "maxResults": 1000,
        "fields": "nextPageToken,items(name,generation,size,timeCreated,temporaryHold,eventBasedHold,retentionExpirationTime,retention)",
    }
    cutoff = now - timedelta(days=30)
    eligible = []
    protected = 0
    while True:
        page = request("/o", query)
        for obj in page.get("items", []):
            name = obj["name"]
            if not name.startswith(PREFIX):
                raise ValueError("Unexpected object outside the upload prefix")
            if instant(obj["timeCreated"]) > cutoff:
                continue
            expiries = (
                obj.get("retentionExpirationTime"),
                obj.get("retention", {}).get("retainUntilTime"),
            )
            if (
                obj.get("temporaryHold")
                or obj.get("eventBasedHold")
                or any(t and instant(t) > now for t in expiries)
            ):
                protected += 1
                continue
            eligible.append((name, obj["generation"], int(obj["size"])))
        if not page.get("nextPageToken"):
            return sorted(eligible), protected
        query["pageToken"] = page["nextPageToken"]


def retention(request, approved=None, now=None):
    rule = json.loads(RULE_FILE.read_text())
    if rule != {
        "action": {"type": "Delete"},
        "condition": {"age": 30, "matchesPrefix": [PREFIX]},
    }:
        raise ValueError("Unexpected upload lifecycle rule; check its scope")
    fields = {"fields": "name,metageneration,lifecycle,softDeletePolicy"}
    bucket = request("", fields)
    if bucket["name"] != BUCKET:
        raise ValueError("Unexpected bucket")
    existing = bucket.get("lifecycle", {}).get("rule", [])
    now = now or datetime.now(timezone.utc)
    objects, protected = eligible_objects(request, now)
    projects = {name.split("/")[1] for name, _, _ in objects}
    size = sum(item[2] for item in objects)
    generation = bucket["metageneration"]
    review = json.dumps(
        [BUCKET, generation, rule, objects, protected], sort_keys=True
    ).encode()
    digest = hashlib.sha256(review).hexdigest()
    print(
        f"{now.isoformat()}  버킷 {BUCKET}  설정 버전 {generation}  기존 규칙 {len(existing)}개"
    )
    print(
        f"대상 객체 버전 {len(objects)}개  {size:,}바이트  업로드 경로 {len(projects)}개  보류·보존 대상 제외 {protected}개"
    )
    print(
        "소프트 삭제 보존 기간(초):",
        bucket.get("softDeletePolicy", {}).get("retentionDurationSeconds", 0),
    )
    if rule in existing:
        print("30일 업로드 규칙이 이미 적용되어 있습니다.")
        return
    if approved is None:
        print("조회만 수행했습니다. 승인할 검토값:", digest)
        return
    if approved != digest:
        raise ValueError(
            "현재 대상이나 설정이 검토값과 다릅니다. 새 검토 결과의 승인이 필요합니다."
        )
    rules = [*existing, rule]
    request("", {"ifMetagenerationMatch": generation}, {"lifecycle": {"rule": rules}})
    if request("", fields).get("lifecycle", {}).get("rule") != rules:
        raise RuntimeError("적용 후 읽은 규칙이 검토한 규칙과 다릅니다.")
    print("기존 규칙을 보존한 채 업로드 규칙을 추가했고 버킷에서 다시 확인했습니다.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply-approved",
        metavar="DIGEST",
        help="apply the separately approved inventory",
    )
    args = parser.parse_args()
    token = subprocess.check_output(
        ["gcloud", "--configuration=gapline", "auth", "print-access-token"], text=True
    ).strip()
    try:
        retention(lambda *a: storage_request(token, *a), approved=args.apply_approved)
    except HTTPError as err:
        raise SystemExit(f"Cloud Storage HTTP {err.code}: {err.reason}")


if __name__ == "__main__":
    main()
