# Evaluation protocol

This folder holds the September 2026 test of Scene's reviewer settings: the clips and their fixed
references ([`cases.json`](cases.json)) and one row per run
([`results-2026-09-22.json`](results-2026-09-22.json), [`.csv`](results-2026-09-22.csv)). The results
and what we learned are in [docs/EVALUATION.md](../docs/EVALUATION.md). This page is the protocol we set
before running it.

## Question and decision rule

Can a cheaper reviewer setting (medium reasoning) replace the default (high reasoning)? Keep the default
unless the cheaper setting adds no factual, timing or essential-coverage errors and no overlap with
independently measured speech or protected sounds. Cost and time come second, and are compared only
when both runs reuse the same saved analysis. This is a descriptive test, not a causal study and not
a study with viewers.

## Design

- One row is one run of one clip, in one narration language, at one density.
- Four development clips and two held-out clips, each run with at most two settings: at most twelve
  runs, counting the first run on the opening clip.
- No automated parameter search. Stop after two provider or compatibility failures in a row, or after
  two candidate changes without a clear quality gain.
- Gemini calls and Google speech (Speech-to-Text and Text-to-Speech) are costed separately. The test
  spends from its own allowance of $10 a day and $20 in total, counting failed calls, and runs one clip
  at a time.

## Clips

- _Tears of Steel_, Blender Foundation, CC BY 3.0.
- _Hanbid speaking Korean_, Wikitongues / Teddy Nee, CC BY-SA 4.0.
- A synthetic clip of coloured squares and beeps, labelled as synthetic, with exact event times and no
  speech.

Sources are used unchanged. Preparation records each clip's hash, source interval and reference before
the candidate runs. The opening clip reuses its earlier subtitle reference and is not blind.

## What we measure

- Incorrect visual descriptions, wrong scene timing, essential omissions, and narration that overlaps
  independent speech or protected-sound intervals.
- An assessment that was not made stays unknown; it is never recorded as zero.
- Subtitles can miss speech and their boundaries are approximate. faster-whisper timings are a
  cross-check from a second recognizer, not a human annotation.
- The reviewer's own verdicts are reported separately from these reference checks.

## Known risks

- Clips from the same film are not independent films.
- Subtitle windows are not exact voice boundaries.
- Reusing saved analysis changes a run's total time and cost.
- A valid JSON answer says nothing about what is missing.
- Fewer lines can lower overlap while making coverage worse.

This sample is too small to support claims about comprehension or satisfaction for blind or low-vision
viewers, or about quality across films.
