# How well it works

## In short

**What we tested.** On 22 September 2026 we ran Gapline on six openly licensed clips: three scenes from
the open movie _Tears of Steel_, two excerpts of a Korean-language interview, and a synthetic clip of
coloured squares and beeps. Two of the six were held back and run only after the other four had
decided the reviewer setting. For each clip we wrote down a short list of essential facts in advance
(for example "40 YEARS LATER marks the change to a laboratory") and checked the finished track against
that list, sampled frames, subtitles and an independent speech recognizer.

**Since then.** On 23 September Gapline gained a fix stage after the final check and a third review
round ([architecture](ARCHITECTURE.md#the-loop-that-makes-each-line)). The results below predate both
and have not been re-run. _Review needed_ is what a result with open findings was called then; it now
reads _Final check · notes_. The automatic sample runs of 23 September are under
[The automatic sample track](#the-automatic-sample-track).

**What we learned.**

- 4 of 6 clips produced a described track. The other 2 stopped because the speech recognizer returned
  words whose start and end times were identical. Gapline stopped instead of guessing where the
  silences were. Since then, Gapline treats such words as speech and carries on (see "How we checked").
- All 18 lines in the four finished tracks fit their room by measured audio, and none overlaps the
  speech Chirp 3 recognized. One of them, in the opening, still talks over dialogue: Chirp 3 had put
  the launch call about 2 s early (see "The opening's launch call").
- On the two scored film clips, every fixed essential fact made it into the finished track.
- Every finished track came back _Review needed_, with a list of what the track still missed. On the
  Korean interview, which leaves only 2.46 s of usable silence, both essential facts were missing and
  the final check said so.
- A 45–65 second clip took 3 min 11 s to 5 min 49 s and $0.13–0.24 in API calls when nothing had been
  analysed before.

**The decision.** We also tried a cheaper reviewer setting (medium instead of high reasoning). On the
opening it lost the "40 years later" time jump without listing it as missing, and it marked the Korean
interview as checked while both essential facts were absent. We kept the stricter reviewer.

## Results with the default settings

| Clip                                       | Narration | Result                          | Lines in the finished track | Essential facts missed | Flagged by the independent recognizer | Time     | API cost |
| ------------------------------------------ | --------- | ------------------------------- | --------------------------- | ---------------------- | ------------------------------------- | -------- | -------- |
| _Tears of Steel_ opening, 65 s             | Korean    | Described, _Review needed_      | 5                           | 0 of 4                 | 1 line, 1.89 s                        | 349.29 s | $0.2407  |
| _Tears of Steel_ city scene, 45 s          | English   | Described, _Review needed_      | 9                           | 0 of 4                 | none                                  | 219.03 s | $0.1708  |
| _Tears of Steel_ lab scene, 45 s, held out | English   | Described, _Review needed_      | 3                           | not scored (see below) | 1 line, 0.03 s                        | 240.97 s | $0.1664  |
| Korean interview, 45 s                     | Korean    | Described, _Review needed_      | 1                           | 2 of 2                 | 1 line, 0.46 s                        | 191.31 s | $0.1302  |
| Korean interview, later 40 s, held out     | Korean    | Stopped: zero-length word times | none                        | n/a                    | n/a                                   | n/a      | $0.0159  |
| Synthetic squares and beeps, 30 s          | Korean    | Stopped: zero-length word times | none                        | n/a                    | n/a                                   | n/a      | $0.0139  |

Times are for a first run on each clip, with nothing reused. API cost is Gemini plus Google speech
list prices. Hosting, storage, build and network costs are not included. The line flagged in the
opening was checked on 23 September and covers dialogue (see "The opening's launch call"); the
other two flags have not been checked.

## Default reviewer against a cheaper setting

The cheaper setting ran on the four development clips, reusing the default run's saved analysis, so
its time and cost are not comparable and are left out.

| Clip                        | Default reviewer                                                                                             | Cheaper reviewer                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _Tears of Steel_ opening    | 5 lines. Kept "40 years later". Final check listed two missing moments (holograms, "simulation ready" text). | 5 lines. The "40 years later" line started at 45.40 s, just before its silence began at 45.41 s, so it was dropped rather than moved. The final check did not list it as missing. |
| Korean interview            | 1 line. Final check listed both missing facts.                                                               | 1 line. Marked checked, with both essential facts missing.                                                                                                                        |
| _Tears of Steel_ city scene | 9 lines, all four facts covered. Final check listed a newspaper headline that had been dropped as too long.  | 9 lines, all four facts covered. Marked checked.                                                                                                                                  |
| Synthetic squares and beeps | Stopped: zero-length word times.                                                                             | Stopped: zero-length word times.                                                                                                                                                  |

After seeing the first two rows, we did not run the cheaper setting on the held-out clips.

## How we checked

- **Clips and references.** Every source, interval, licence, file hash and fixed fact is in
  [`evals/cases.json`](../evals/cases.json). The references were written before the runs, except for
  the opening: an earlier result on that clip was already known when its facts were written down.
- **Essential facts.** We compared each finished track with the fixed facts and with sampled frames.
  These counts cover only the listed facts; they are not a full quality score.
- **Held-out lab scene.** Its reference said the transformation happens inside the laboratory. Looking
  at the frames afterwards showed the street outside turning into a sunny canal town. We kept the
  original reference and the correction, and did not score omissions for this clip.
- **Speech overlap.** "No overlap with the recognized speech" is measured against Chirp 3, the
  recognizer Gapline uses. As a cross-check we ran faster-whisper 1.2.1 (small model, CPU, int8), and
  subtitles where they exist, and listed each disagreement as a line to check rather than a confirmed
  overlap.
- **The opening's launch call.** On 23 September we checked the flag in the opening. Chirp 3 had
  timed "We have main engine start." at 2.32–3.96 s and missed the "Roger, Roger" spoken in that
  stretch. faster-whisper places the call at 4.21–6.17 s over the whole clip. Recognized as separate
  slices, 1.8–4.4 s returns "Roger, Roger.", 4.4–6.7 s returns "We have main engine start." at
  4.40–6.16 s, and 6.7–10.0 s returns "Four, three, two, one." A spectrogram shows voice at 4.8–6.3 s.
  So Chirp 3 put the call about 2 s early. It placed the countdown after it correctly ("4 3 2" at
  6.84–8.92 s, "1" at 9.28–9.76 s). The line "망고 오픈 무비 프로젝트." (The Mango Open Movie Project.),
  voiced at 4.50–6.39 s in a silence Gapline had found at 4.21–6.59 s from Chirp 3's timings, talks
  over the call. The sample track's other lines overlap neither recognizer's words.
- **What we changed.** Gapline now recognizes every usable silence a second time, on its own
  ([architecture](ARCHITECTURE.md#what-runs-on-google-cloud)). A test replays this clip's recorded
  first pass with the call at 4.40–6.16 s and checks that the silence at 4.21–6.59 s closes and the
  line can no longer be placed there. On 23 September the re-listen ran on the real audio, in run
  `20260923t064439178-ko-standard-837b9f`: of 6 silences recognized again, one held 5 new words, "We
  have main engine start" at 3.71–6.47 s, which closed the 2.38 s silence at 4.21–6.59 s. The sample
  track reuses that hearing and has no line there. `npm run relisten -- tos-opening` repeats that
  check. (On the earlier sample track the line was removed by hand; see "Edits on the earlier sample
  track".)
- **The two stopped runs.** The held-out Korean excerpt starts in the middle of a sentence. One
  diagnostic request showed Chirp 3 returning its first three words, "어쩔 수 없고요" ("can't be
  helped"), with start and end both at zero. The synthetic clip, which has no speech, failed the same
  check. Gapline now blocks each stretch of untimed words as speech, from the previous timed word to the
  next one, instead of stopping. Replaying the saved response for the Korean excerpt through the
  current code blocks its first 1.24 s and leaves three silences, 5.95 s in total. We have not re-run
  the paid evaluation with this change.
- **What stays unknown.** Factual errors beyond the fixed facts, exact dialogue intrusions and
  intrusions on important sounds are recorded as unknown (`null`) in the results file, not as zero.

## What these results do not show

- This is a small test: six clips, three of them from the same film. It shows how the system behaves,
  not how good it is across films.
- No blind or low-vision listeners took part yet, so there is no measure of comprehension or
  satisfaction. Listening sessions are our next step.
- After the test, inspecting the runs showed two prompt problems shared by both settings: silence
  boundaries were shown to one decimal place (45.41 became 45.4), and the writer was told to use a
  phrasing the reviewer rejects as viewer framing. The final check's instructions also tied omissions
  to free room. All three were fixed and covered by tests. The results above come from before those
  fixes, and we did not re-run the test afterwards.
- Drafts vary from run to run, so not every difference between the two settings comes from the
  reviewer alone.

## Spending

The whole test, ten runs including the three that stopped, cost $0.847577 in Gemini calls plus
$0.134520 in Google speech at list price: $0.982097 in total. Every charge was known. One separate
diagnostic speech request cost about $0.010667.

## Edits on the earlier sample track

Until 23 September, the Korean sample track was the automatic run of 22 September on the opening plus
three edits. That track is still in the sample's run list. Each edit made a new version and kept the
one before it.

1. **A line rewritten.** We changed the line at 45.5 s from "40년 후." (40 years later.) to
   "40년 후, 두 사람의 홀로그램이 재생된다." (40 years later, a hologram of two people plays.). The edit
   took 67.83 s and $0.041100 in API calls.
2. **A dropped line filled.** The automatic loop had dropped the line at 54.2 s: the reviewer rejected
   "연구원이 콘솔 앞에 앉아 있다." (A researcher sits at a console.) because the "SIMULATION READY" text
   mattered more, then rejected the rewrite "시뮬레이션 준비 완료라는 문구가 뜬다." (The words "Simulation
   ready" appear.) as viewer framing. We typed the reviewer's suggested fix, "시뮬레이션 준비
   완료." (Simulation ready.). It was voiced in 2.26 s with 2.80 s of room and passed review. The track
   then had six lines, and the other five audio files were reused unchanged. The edit took 96.49 s
   and $0.088032, and the final check listed one missing moment.
3. **A line removed.** After the launch-call check above, we removed "망고 오픈 무비 프로젝트."
   (The Mango Open Movie Project.). Nothing was voiced: the five remaining audio files were reused
   byte for byte, the mix and text track were rebuilt, and the final check ran again. It now lists
   three missing moments, among them the "the Mango Open Movie project" title the removed line had
   read. That title is on screen while the launch call and the countdown are spoken, so no usable
   silence is left to read it in. The removal took 75.94 s and $0.045488. A first attempt ended when
   the model provider's stream broke; that call's charge was not reported.

That track has five lines, two of them typed by hand, and every one passed review and fits its room
by measured audio. Across the automatic run and the three edits, it took $0.415 in API calls, plus
the time spent editing. Since 23 September the automatic loop rewrites a rejected line a second time
itself, and the fix stage acts on what the final check finds.

## The automatic sample track

Since 23 September the app's Korean sample is one automatic run
(`20260923t065852164-ko-standard-350b05`): the opening, Korean narration, standard density, made
after the fix stage and the third review round were added. It was started from the command line
(`npm run pipeline`), which calls the same run code as the Generate button.

- 7 lines voiced, all inside their silence by measured audio, and 0 s of narration over the speech
  Chirp 3 recognized. None overlaps faster-whisper's words either.
- One line, at 63.0 s, failed three reviews and was dropped: "화면이 암전된다." (The screen goes
  black.) and "암전된다." (Goes black.) were rejected as viewer framing, the second also as not on
  screen, and "남자가 뇌를 응시한다." (The man gazes at the brain.) as redundant and inconsistent
  naming.
- The final check sent one line back: "홀로그램 재생창이 뜬다." (A hologram playback window comes up.),
  which had passed review and been voiced in 2.32 s, as viewer framing. Its fix suggested reading the
  words on screen instead ("MEMORY PLAYBACK - GLOBAL" at 48.5 s), and Gapline rewrote the line to
  "전체 기억 재생." (Full memory playback.). The rewrite passed review and was voiced in 1.74 s of
  2.63 s of room.
- The fix stage added no line (`finalFix`: 1 failing, 3 missing, 1 rewritten, 0 added), and the check
  left 3 notes. A conversation on a canal bridge at 25.1 s and a hologram of two people at 39.8 s have
  no free silence left. The credit at 2.0 s, "블렌더 재단 제공." (Presented by the Blender Foundation.),
  had 1.0 s of free room (1.07–2.07 s by `freeRoom`), yet no line was added there. We have not
  checked why.
- It took 8 min 6 s and $0.317 in API calls. Review, final check included, was $0.276 of that (87%).
  Hearing and watching were reused from run `20260923t064439178-ko-standard-837b9f`, started
  14 minutes earlier on the same clip: $0.039 (first pass $0.019, re-listen $0.010, watching $0.011)
  and 25 s, with hearing (then its re-listen) and watching running side by side. With them the track
  cost $0.357, or $0.33 per minute of film.

Automatic runs of the same sample that day:

| Run                                     | Time        | API cost               | Note                                                                                         |
| --------------------------------------- | ----------- | ---------------------- | -------------------------------------------------------------------------------------------- |
| `20260923t064439178-ko-standard-837b9f` | 12 min 24 s | $0.453                 | Analysed from scratch, reused by the sample; ran a second audit after the fix, since removed |
| `20260923t065852164-ko-standard-350b05` | 8 min 6 s   | $0.317                 | The pinned sample; analysis reused                                                           |
| `20260923t070742966-ko-standard-bca29a` | 5 min 11 s  | $0.175, known subtotal | Analysis reused; one rate-limited call has unknown cost; 5 lines, no notes                   |

These are single runs of one clip, not a re-run of the test above.

## Reproducing the test

```sh
npm run samples
node --env-file=.env.local --import tsx scripts/prepare-upgrade-eval.ts
uv run --with faster-whisper scripts/independent-speech.py
node --env-file=.env.local --import tsx scripts/screen-upgrade.ts development
node --env-file=.env.local --import tsx scripts/screen-upgrade.ts confirmation high
node --import tsx scripts/summarize-upgrade.ts
```

Preparation downloads the sources and writes the references. The paid step skips clip and
setting pairs already in its journal (`runtime/evaluation/runs.jsonl`) and stops at twelve runs. It
spends from its own allowance, $10 a day and $20 in total, and runs one clip at a time.

Results: [run-level JSON](../evals/results-2026-09-22.json), [CSV](../evals/results-2026-09-22.csv),
[protocol](../evals/README.md).

## 2026-10-03: faster re-reviews and no fitting line lost

QA found runs of 4–9 minutes, most of it reviewer calls at high thinking, and lines that had been
voiced and fit dropped by the fix stage. The changes
([architecture](ARCHITECTURE.md#the-loop-that-makes-each-line), steps 4–7):

- Re-reviews of a few rewritten, added or shortened lines think at medium. The first review of the
  whole script and the final check stay at high, the setting the September test kept.
- A failed fix never costs a voiced line: it goes back to its voiced words and audio, with the
  check's verdict listed (`finalFix.kept`).
- A rewrite or shortening with the words of any earlier version counts as unchanged, and rewrite
  requests list the wordings that already failed and why.
- A take up to 15% too long is sped up with FFmpeg `atempo` instead of being voiced again.
- Trimming removes the drift below 80 Hz before finding the speech.
- A clip with no silence skips writing and the final check.
- The 360p watching copy is kept beside the clip, named after the clip's size and modification
  time so a clip prepared again in place is encoded again; run events and paid-call records are
  written in batches.

**Runs.** Same machine and code, except the files changed above. _Tears of Steel_ opening (65 s,
English, analysis reused) at standard and brief, and the team scene (45 s, English, standard), twice
before and twice after the change, three runs at a time. A fresh copy of the team scene with nothing
reused ran once after. Run directories are in the QA scratchpad, not in the repository.

| Clip, density            | Before: time, cost         | After: time, cost          | Lines shipped of written, before → after |
| ------------------------ | -------------------------- | -------------------------- | ---------------------------------------- |
| Opening, standard        | 333 s $0.372; 216 s $0.246 | 385 s $0.433; 290 s $0.325 | 7/7, 7/8 → 8/8, 8/8                      |
| Opening, brief           | 140 s $0.150; 218 s $0.236 | 274 s $0.307; 265 s $0.327 | 3/3, 3/3 → 4/4, 4/4                      |
| Team scene, reused       | 225 s $0.231               | 197 s $0.213; 166 s $0.183 | 3/4 → 3/3, 3/3                           |
| Team scene, from scratch | 258 s $0.269               | 212 s $0.215               | 3/3 → 3/3                                |

What the change did, by stage (medians over all runs above):

- **Re-reviews:** 15 calls, 21.4 s and 4.6k thinking tokens each, before; 11 calls, 9.9 s and 1.7k
  each, after. Mean cost $0.026 → $0.015 per call.
- **Fix stage:** 54–88 s in the 4 runs that had one, before; 9.5–41 s in 5 runs, after.
- **Shortening:** 4 shortenings before, none after. Every take that overran was sped up and fit (5
  lines, 1.05–1.15×).
- **Watching copy:** writing started 3.7–6.3 s after the silences were found in 4 of the 5 runs
  that reused the analysis, before; at once in every run after, from the kept copy.
- **Trimming:** re-trimming the 26 stored takes of the "before" runs removes a median 0.31 s more
  (up to 0.73 s) than the old trim kept.
- **Lines lost:** 2 of 28 written lines were dropped before (one after three rejections, one added
  and rejected); 0 of 33 after. No fix failed in these runs, so the restore never ran here; a mocked
  test covers it (`tests/run-loop.media.ts`).

**Overall speed: not measured.** The version measured above was slower overall on the opening.
The two calls at high, the first review and the final check, thought longer. On the opening, the
medians were 29.9k and 29.6k thinking tokens after, against 10.5k and 21.4k before (4 finished runs
each). Over both clips they were 28.7k and 26.3k after, against 13.2k and 19.8k before. That version
also showed each line's length limit to every review, to stop fixes the writer copies from running
long. A replay of one first review of the opening (an 8-line draft from the after-runs), three times
each way, thought 34.7–36.3k tokens (129–130 s) with limits and 28.3–32.9k (103–124 s) without. With
the earlier instructions it thought 26.6k (88 s, once). So the limits added about 13% (means 35.4k
and 31.2k), not the doubling. The rest is not explained by these data: the same draft also
thought far more than the before-runs' own first reviews of the opening (6.4–22.0k). Limits are now
given on re-reviews only. The first review and the final check get the same instructions as before
the change. This version was not measured end to end: the prepaid credits ran out during the
replay, and the owner asked for no new paid runs. With limits, 0 of 14 rewrites were over their
length budget, against 3 of 13 before.

**Lines against the picture** (frames every 0.5 s). Both versions read the same facts in the
opening: "40 years later" at 45.5 s, the holograms, "Simulation ready", the man with the eyepiece.
Both describe him about 2 s before he is shown: "A man with a cybernetic eyepiece examines a brain"
at 57.0 s, while only the brain is shown until about 59 s. After the change, one opening run also
read the Netherlands Film Fund credit at 19.3 s; a line for it was rejected before. In the team scene,
the line at 36.4–40.5 s was "He puts an arm around Tom and pulls him close" before. After, it was the
same in one run and "He points back toward the window" in another, after two rejections. The man
does point back at 36–40 s and puts his arm around the grey-haired man at 41 s. The line at 5.0 s says "microphone"
for a hand-held device in both versions.

**Not adopted: caching the video for Gemini.** The clip goes inline with every call. Prompt tokens,
video included, were 11–19% of the Gemini cost of these runs, and Gemini's implicit cache matched in
12 of 109 calls. An explicit cache would save at most part of that share, and nothing for clips below
its minimum size, at the cost of a cache to create and expire per run. Keeping the watching copy
removed the encode, which was the larger wait.

**Not measured.** Batching the event and call logs targets Cloud Storage's limit of about one write
per second per object; it was tested locally only. Replaying the event times of the 13 finished
runs above through the batching gives 8–20 writes of the event log per run (median 14), 1–4 of them
less than a second after the previous one (median 3). Writing every event on its own gave 26–57
(median 38), 19–47 of them that close (median 26). Only a stage's start and the run's start and end
are written before the run goes on; a refused write keeps its lines for the next one. The runs above, the replay and one run stopped by
the daily allowance cost $4.61 together.
