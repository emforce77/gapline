"""Run with python3 tests/test_upload_lifecycle.py. All requests are in memory."""

import contextlib
import io
import json
import runpy
import unittest
from datetime import datetime, timezone
from pathlib import Path

policy = runpy.run_path(
    str(Path(__file__).resolve().parents[1] / "deploy/upload-lifecycle.py")
)
rule = json.loads(policy["RULE_FILE"].read_text())
now = datetime(2026, 11, 20, 12, tzinfo=timezone.utc)


class LifecycleTest(unittest.TestCase):
    def setUp(self):
        self.existing = [
            {
                "action": {"type": "SetStorageClass", "storageClass": "COLDLINE"},
                "condition": {"age": 120},
            }
        ]
        self.bucket = {
            "name": policy["BUCKET"],
            "metageneration": "3",
            "lifecycle": {"rule": self.existing},
        }
        self.patches = []
        self.old = {
            "name": "projects/u-abc/clip.mp4",
            "size": "5",
            "generation": "11",
            "timeCreated": "2026-10-21T12:00:00Z",
        }

    def request(self, path, query, patch=None):
        if path == "/o":
            self.assertEqual(
                (query["versions"], query["prefix"]), ("true", "projects/u-")
            )
            if not query.get("pageToken"):
                return {
                    "nextPageToken": "p2",
                    "items": [
                        self.old,
                        dict(self.old, temporaryHold=True),
                        dict(self.old, timeCreated="2026-10-21T12:00:01Z"),
                    ],
                }
            return {
                "items": [dict(self.old, name="projects/u-xyz/strip.jpg", size="7")]
            }
        if patch is not None:
            self.patches.append((query, patch))
            self.bucket.update(patch)
        return self.bucket

    def preview(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            policy["retention"](self.request, now=now)
        return buf.getvalue()

    def test_preview_then_guarded_append(self):
        preview = self.preview()
        self.assertIn("객체 버전 2개  12바이트  업로드 경로 2개", preview)
        self.assertIn("보류·보존 대상 제외 1개", preview)
        self.assertEqual(self.patches, [])
        digest = preview.split()[-1]
        with contextlib.redirect_stdout(io.StringIO()):
            policy["retention"](self.request, digest, now)
            policy["retention"](self.request, digest, now)
        self.assertEqual(
            self.patches,
            [
                (
                    {"ifMetagenerationMatch": "3"},
                    {"lifecycle": {"rule": [*self.existing, rule]}},
                )
            ],
        )

    def test_old_approval_cannot_apply_after_inventory_or_bucket_change(self):
        digest = self.preview().split()[-1]
        for change in ({"metageneration": "4"}, {"metageneration": "3"}):
            self.bucket.update(change)
            if change["metageneration"] == "3":
                self.old["generation"] = "12"
            with (
                self.assertRaises(ValueError),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                policy["retention"](self.request, digest, now)
        self.assertEqual(self.patches, [])


if __name__ == "__main__":
    unittest.main()
