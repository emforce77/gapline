"""Prints stage timing (server vs arrival) and the result of a logged SSE run."""
import json
import sys

rows = [line.rstrip("\n").split("\t", 1) for line in open(sys.argv[1])]
t0 = float(rows[0][0])
first_stage = None
for ts, line in rows:
    if not line.startswith("data:"):
        continue
    e = json.loads(line[5:])
    if e["type"] == "stage":
        first_stage = first_stage if first_stage is not None else float(ts) - t0
        print(f"{float(ts)-t0:6.1f}s arrive  {e['t']:6.1f}s server  {e['stage']} {e['state']}")
    elif e["type"] == "cue_reviewed" and not e["verdict"]["pass"]:
        print("   rejected", e["cueId"], [(v["rule"], v["quote"]) for v in e["verdict"]["violations"]])
    elif e["type"] in ("cue_dropped", "coverage", "run_failed"):
        print("  ", e["type"], {k: v for k, v in e.items() if k not in ("type", "t")})
    elif e["type"] == "run_done":
        s = e["summary"]
        print({k: s[k] for k in ["cuesShipped", "cuesFitting", "cuesRejected", "overlapWithSpeechSeconds", "costUsd", "wallSeconds"]})
        for c in e["cues"]:
            print("  ", c["id"], c["status"], c["start"], "v%d" % len(c["versions"]), c["versions"][-1]["text"])
print("first stage event after", first_stage, "s")
