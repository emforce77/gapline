# September 22 upgrade screening

**Keep the high-effort reviewer. Do not promote the medium-effort candidate.** The lower-effort setting lost the essential “40 years later” transition in the opening case and marked a Korean interview as model-checked while introductory visual context remained absent. This small screen does not establish the quality of either setting for unattended publication.

The screen contains **10 run records over six clip cases: seven completed and three failed**. The four development cases received both settings. Only the retained high setting ran on two separate held-out cases, because the medium candidate had already failed the coverage criterion. No tuning loop followed, and the twelve-run ceiling was not filled merely to spend the budget.

Both settings include this upgrade's integrity fixes. This is a comparison of reviewer effort, **not** a controlled before/after test of the entire old and new application.

Post-screen inspection found two shared prompt defects: gap boundaries were rendered at one decimal place (45.41 became 45.4), and the writer was told to use wording the reviewer could reject as viewer framing. The final-audit system instruction also still conditioned omissions on free room. These were corrected after screening and covered by focused checks. The frozen runs are not presented as a paid validation of those later prompt corrections; no further tuning or cost-comparison claim was added. Stochastic drafts also prevent attributing every paired difference solely to reviewer effort.

## Independent evidence and observed failures

| Case                                          | High reviewer             | Medium reviewer           | Evidence and decision                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Film opening → Korean, 65 s                   | Five lines; review needed | Five lines; review needed | Medium omitted the fixed essential time jump. Its invalid 45.40 s placement was rejected rather than relocated to a 45.41 s gap. High retained the time jump but still flagged holograms and simulation text. |
| Native Korean interview, 45 s                 | One line; review needed   | One line; model checked   | Both omitted the two fixed introductory visual-context facts. Medium failed to flag that absence. Dense speech leaves only 2.46 s of allowed room; forced additions would be inappropriate.                   |
| Film city/action → English, 45 s              | Nine lines; review needed | Nine lines; model checked | Both cover the four fixed broad facts in sampled frames. High additionally flags a newspaper headline. This does not reverse the candidate's failed essential-coverage decision.                              |
| Synthetic color/sound signals, 30 s           | Failed                    | Failed                    | Invalid zero-duration recognition intervals were rejected. Neither failed run is scored as a quality success. The visual analysis also returned no sound events despite authored beeps.                       |
| Native Korean held-out speech, 40 s           | Failed                    | Not run                   | One bounded raw-response diagnosis confirmed real words returned with start and end both zero at the clip boundary. No timing was invented and the words were not silently discarded.                         |
| Held-out film team/laboratory → English, 45 s | Completed; review needed  | Not run                   | Unresolved coverage remains in the model report; independent full listening acceptance is open.                                                                                                               |

The source intervals, licenses, hashes and essential facts are in [cases.json](../evals/cases.json). The opening smoke result was already known when its metadata was consolidated, so this case is not blinded. Other initial references preceded their runs. The held-out film reference misread the transformation as happening inside the laboratory; later output/frame inspection showed the exterior street becoming a sunny canal town. Its original fact and subsequent correction are both retained, and this case has no independent omission score. Several excerpts share a film; they are not independent productions.

Source subtitles, sampled frames and **faster-whisper 1.2.1 / small / CPU int8** provide evidence independent of the generating Gemini/Chirp pipeline. Whisper is another recognizer, not a human annotation. It disagrees with Chirp about the opening mission-control speech timing; these intervals are stored as overlap **candidates**, not confirmed intrusions. Source subtitles also omit that speech. Unknown factual errors, exact dialogue intrusions and important-sound intrusions remain `null`, not zero, in the machine-readable report.

The known omission counts refer only to the fixed facts and inspected frames. They are not exhaustive semantic scores. No blind/low-vision participants were recruited; no comprehension, satisfaction, accessibility-outcome or population-wide quality claim is supported.

## Spending and performance

Screening used **$0.847577 OpenRouter** plus **$0.134520 Google speech list-price estimates**, totaling **$0.982097 API cost**. All screening ledger charges are known; failed calls are included. A separate diagnostic STT request cost about $0.010667. Demo narration and actual editor demonstrations are production/verification costs, recorded separately. Infrastructure, build, storage and network charges are excluded.

The pinned 65-second cold generation took **349.29 s** and **$0.240700 API cost**. The paired medium run reused its analysis, so their total time and cost are **not** compared as evidence of an efficiency improvement. Each pair uses the same clip, output language, density and analysis. The cheaper candidate was rejected on coverage before performance selection.

The implementation enforces a $20 total/$10 daily experiment allowance, serial experiments, and a separate $5 daily public-demo allowance through conditional reservations. Unknown charges retain their hold. The OpenRouter key limit was not changed and no balance was recharged.

## Reproduction and artifacts

```sh
npm run samples
node --env-file=.env.local --import tsx scripts/prepare-upgrade-eval.ts
uv run --with faster-whisper scripts/independent-speech.py
node --env-file=.env.local --import tsx scripts/screen-upgrade.ts development
node --env-file=.env.local --import tsx scripts/screen-upgrade.ts confirmation high
node --import tsx scripts/summarize-upgrade.ts
```

Preparation downloads licensed sources and writes references. Paid screening skips journaled case/setting pairs and never exceeds twelve records. Do not delete the journal to hide failures or bypass the limit. This checkpoint deliberately does not rerun failed recognition cases with invented ground truth.

[Run-level JSON](../evals/results-2026-09-22.json) · [CSV](../evals/results-2026-09-22.csv) · [Protocol](../evals/README.md)

The selected demo remains a reviewable production example. Its real editor actions restore missing information while preserving the original WAVs and parent run. A model approval is still not a listening-quality certificate. **Full-length human listening and important-sound acceptance remain outstanding before final contest submission.**

The selected final edit restored “시뮬레이션 준비 완료.” at 54.2 seconds, producing six fitting lines in 96.49 seconds for $0.088032 API cost. The remaining coverage finding stays visible. English and Korean demo drafts are each 175.00 seconds, 1920×1080 H.264/AAC, with English captions. Full decoding passed; measured true peaks are −0.8 and −0.9 dBFS respectively, with −16.2 LUFS integrated loudness. Both presenters finish before the recorded listening section. The eight-page English presentation and technical media checks are under `runtime/demo-v2/`; these runtime artifacts are intentionally excluded from Git.
