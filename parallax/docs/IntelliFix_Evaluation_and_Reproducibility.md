# IntelliFix — evaluation audit and reproducibility

This document checks every headline number against the stored results, explains where each comes from, and lists what was wrong and fixed during the audit (25 Oct 2026). Method and definitions: [EVALUATION_PROTOCOL.md](EVALUATION_PROTOCOL.md). Full tables: [RESULTS_AND_IMPACT.md](RESULTS_AND_IMPACT.md) and `evaluation/results/report.md` (generated).

## 1. Headline claims, checked

All values come from `evaluation/results/summary.json`. The latest full run was on 2026-10-25 at 12:07 UTC, on the working tree over commit `8ea79eb`. The test split has 540 cases.

| Claim | Stored value | Denominator | Status |
|---|---|---|---|
| 540 held-out test cases | 540 (432 single-error, 108 two-error) | 18 program families | **verified** |
| IntelliFix top-1 = reference AST **71.5%** | 386/540 = 71.48%, Wilson 95% CI [67.5, 75.1] | all test cases | **verified** |
| Least-cost baseline **55.2%** | 298/540 = 55.19% | all test cases | **verified** |
| CPCT+ **about 48–49%** | **47.4–49.1%** over three runs (latest 48.0% / 48.7%) | all test cases | **corrected**: CPCT+ breaks ties nondeterministically, so its value moves between runs (§4) |
| Wrong-but-confident **6.1%** | 33/540 = 6.11% | **all** test cases (not just recommended ones) | **verified** |
| Coverage **50.7%** | 274/540 = 50.74% | all test cases | **verified** |
| Selective risk **12%** | 33/274 = 12.04% (selective accuracy 241/274 = 88.0%) | recommended cases only | **verified**. It misses the 10% target τ was tuned for |
| Forced top-1 wrong-but-confident **28.5%** | 154/540 = 28.52% | all test cases | **verified** |
| Stability evidence **+0.2 points** | P − E = +0.19 points, bootstrap 95% CI [−0.4, +0.9] | paired, 540 | **verified**: not a significant gain |
| P − C **+16.3 points** | +16.30 [13.1, 19.4] | paired, 540 | **verified** |
| P − L (layout evidence) **+8.9 points** | +8.89 [6.7, 11.3] | paired, 540 | **verified** |
| False-confident P − F **−22.4 points** | −22.41 [−25.9, −18.9] | paired, 540 | **verified** |
| τ = 1.5 chosen on dev | dev coverage 45.6%, dev risk 5.5% | 360 dev cases | **verified** |
| Offline re-thresholding = direct `--tau` runs (25/25) | 25/25 in the re-run | 25 sampled test cases | **was not verifiable before; now verified** (§3) |
| Exact localisation 86.7% (P) vs 76.3% (raw parser) | 468/540 vs 412/540 | all test cases | **verified** |
| Panic mode: 3.85 diagnostics per case | 3.85 (mean); 61.1% of cases have at least one spurious diagnostic | all test cases | **verified** |
| Cost: 306 parser invocations per case | 305.9 (median 153, p95 1112) | all test cases | **verified** (deterministic) |
| Engine time ~9.6 ms | **9.6–13.9 ms** mean over three runs | all test cases | **corrected**: timing depends on machine load |

## 2. Leakage and design checks (executed)

| Check | Result |
|---|---|
| Dev and test share a program family | no: 12 dev families and 18 test families, disjoint (also asserted by `test_dataset_splits_by_family`) |
| Dev and test share an original program | no: 0 shared originals |
| Duplicate corrupted inputs | none among the 900 cases |
| Dataset regenerated identically from seed 20261024 | yes: the SHA-256 of `cases.jsonl` and `manifest.json` is unchanged after regeneration |
| Evidence weights or τ changed after the freeze (`03331c0`) | no. `git diff 03331c0` shows no weight or τ change. Later engine changes: a comment rename, Windows binary-mode I/O, whitespace in the displayed repaired source, and the two decision rules in §3 |
| The two new decision rules changed any benchmark result | no: all 900 cases are identical for systems A–F, L and P (per case, ignoring timings) |
| A system can score by refusing | prevented: wrong-but-confident is divided by *all* cases, and coverage and top-1 are reported next to it |
| Seeds | dataset 20261024 · bootstrap 7 (2000 resamples) · τ-check sample `random.Random(1)` · professor-style fuzzing 20261025 |
| Known pre-freeze contact with test data | a 60-case smoke run touched two test families while the harness was being debugged; no weights were changed from it (stated in EVALUATION_PROTOCOL.md §2) |

## 3. Problems found by the audit, and what was done

1. **Harness bug: the τ check was never recorded.** In `run_experiments.py`, the CPCT+ block reused the variable `agree` and overwrote the τ-check count with a list of 900 replicate-agreement booleans. So the stored report showed a list instead of "x/25", and the docs' "25/25 identical" was not backed by stored results. Fixed by renaming the variable to `tau_agree`. The re-run records **25/25**.
2. **Engine: valid but very deeply nested input was "repaired".** Found by the professor-style suite (P86). See [IntelliFix_Random_Input_Test_Report.md](IntelliFix_Random_Input_Test_Report.md). Fixed: the engine now reports `UNSUPPORTED_CONSTRUCT` without searching. This also changes catalog case S35 from `NO_SAFE_REPAIR` to `UNSUPPORTED_CONSTRUCT`.
3. **Engine: an unterminated comment was replaced, discarding the code inside it.** Found in the same suite (P73). Fixed: such plans are capped at `LOW_CONFIDENCE`.
4. **CPCT+ and timing figures were quoted as single values.** They vary between runs; the docs now give ranges.
5. **Not fixed, on purpose:** two confident-but-unintended repairs (`whlie (…) {` and a deleted `while`). Changing the weights after seeing them would be tuning on observed cases. They are documented in KNOWN_LIMITATIONS.md.

## 4. Run-to-run variation

| Quantity | 24 Oct 18:45 | 25 Oct 12:05 | 25 Oct 12:07 |
|---|---|---|---|
| P top-1 / coverage / wrong-confident | 71.5 / 50.7 / 6.1 | identical | identical |
| CPCT+ replicate 1 / 2 top-1 (%) | 48.1 / 49.1 | 47.4 / 48.3 | 48.0 / 48.7 |
| CPCT+ replicate agreement (%) | 70.1 | 68.6 | 68.6 |
| P mean engine ms | 9.6 | 13.9 | 12.2 |
| Total wall time (s, 4 workers) | 27.5 | 39.7 | 34.3 |

Systems A–F, L and P are deterministic: same input, same output, verified per case. CPCT+ (grmtools) chooses among equal-cost repair sequences nondeterministically.

## 5. How to reproduce

```bash
cd parallax
cmake -S compiler -B compiler/build -DCMAKE_BUILD_TYPE=Release && cmake --build compiler/build -j
./scripts/run_evaluation.sh            # regenerates the dataset, runs all systems; CPCT+ only if nimbleparse is on PATH
python3 -m evaluation.catalog.catalog  # 61 hand-written catalog cases → docs/ERROR_CATALOG_RESULTS.md
python3 -m evaluation.professor.run_professor_tests   # professor-style suite → docs/IntelliFix_Random_Input_Test_Report.md
python3 -m pytest -q evaluation/tests  # metric, dataset, catalog and professor tests
```

On Windows, use the same Python commands from PowerShell after building `parallaxc.exe` (see INSTALLATION_AND_TROUBLESHOOTING.md §3). The evaluation scripts find `compiler\build\parallaxc.exe` or `compiler\build\Release\parallaxc.exe`. **Not executed on real Windows.**

Expected output: systems A–F, L and P reproduce the numbers in §1 exactly. CPCT+ falls within roughly the range in §4. Timings depend on the machine.

## 6. What the evaluation does not show

- Nothing about real student errors. The cases are synthetic single-token mutations of 30 programs written by one author.
- No probability calibration. The margin is a score difference, not a probability.
- That IntelliFix is a better *recovery* algorithm than CPCT+. CPCT+ optimises a different objective; we only measured how often its first repair restores the original program.
- Statistical significance for the small ablations. Stability (+0.2) and grouping (top-1 identical, coverage −1.8 points) are within noise or show no gain.
