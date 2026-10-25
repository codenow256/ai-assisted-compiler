# Testing

## One command

```bash
cd parallax
./scripts/test_all.sh                    # compiler, backend, evaluation, frontend; E2E reported as SKIPPED
PARALLAX_E2E=1 ./scripts/test_all.sh     # + Playwright E2E (needs ./scripts/run_backend.sh running)
```

The script prints `PASS` / `FAIL` / `SKIPPED` for each layer and exits non-zero on any failure. A skipped layer is never reported as passed.

## Layers

| Layer | Command | Count | What it covers |
|---|---|---|---|
| Compiler unit tests (C++) | `ctest --test-dir compiler/build` (runs `parallax_tests` and a `parallaxc version` smoke test) | 68 test functions | lexer (20), parser/AST/names (22), repair engine (26, including 2 regression tests from the 25 Oct audit) |
| Backend API (pytest) | `cd backend && python3 -m pytest` | 33 | every endpoint, schemas, error codes, timeouts, crashes, missing compiler, concurrency, grammar report, docs and doc-image path safety, live evaluation |
| Evaluation + error catalog (pytest) | `python3 -m pytest evaluation/tests` | 161 (10 metric/dataset + 61 catalog cases + 88 professor-style cases + fuzzing + HTTP sequences) | metric definitions, Wilson/bootstrap, τ rule, split by family, dataset reproducibility, every catalog expectation |
| Frontend unit (vitest) | `cd frontend && npx vitest run` | 132 (incl. 102 explanation tests over real compiler responses for all 88 professor-style inputs) | positions, diff, lexer-rule lookup, API client errors and aborts, navigation, accept/undo, stale responses, evaluation rendering; fixtures are **real captured backend responses** |
| Frontend typecheck | `cd frontend && npx tsc -b` | — | strict TypeScript |
| End-to-end (Playwright) | `cd frontend && node tests/e2e/run-e2e.mjs` | 12 checks | real compiler + backend + built UI: sample loading, RECOMMENDED repair, accept/confirm/undo, refresh persistence, token highlighting with the Flex rule, LR items, abstention on an ambiguous case, hypothesis stability, AST compare, evaluation page, guided demo, no page errors |

## Latest recorded outcome

Run on 2026-10-25 with `PARALLAX_E2E=1 ./scripts/test_all.sh`, all layers PASS (Linux, g++ 13.3, Bison 3.8.2, Flex 2.6.4, Python 3.13.17, Node 22.22, Chromium via the preinstalled Playwright):

| Layer | Passed | Failed | Skipped |
|---|---|---|---|
| C++ (`parallax_tests`) | 68 | 0 | 0 |
| ctest entries | 2 | 0 | 0 |
| Backend API | 33 | 0 | 0 |
| Evaluation + catalog + professor-style | 161 | 0 | 0 |
| Frontend unit | 132 | 0 | 0 |
| End-to-end | 17 | 0 | 0 |

**Also run:** the Windows build (MinGW-w64 cross-compile) under Wine 9.0: 68/68 C++ tests, catalog output identical to Linux. Seeded fuzzing: 800 inputs, 0 invariant violations (`docs/IntelliFix_Random_Input_Test_Report.md`).

**Not done:** cross-browser E2E (Chromium only), testing on a real Windows machine or with MSVC, the PowerShell scripts, macOS.

## Regression tests from bugs found during development

| Bug | Regression test |
|---|---|
| Stop-at-first parsing could report a second diagnostic after error recovery shifted `error ;` | `parser_panic_mode_recovers_multiple_errors` |
| yacc.c compiled as C++ could not grow its stack, so nesting failed at depth 200 | `parser_deep_nesting_hits_resource_limit_without_crashing` |
| asyncio semaphore bound to one event loop deadlocked concurrent requests in tests | `test_concurrent_requests_do_not_interfere` |
| A valid program nested deeper than the parser stack was "repaired" by deleting braces after a 3.5 s search | `repair_parser_nesting_limit_is_reported_not_repaired`; professor case P86 |
| An unterminated `/*` was replaced by `}`, silently discarding the code inside it | `repair_never_recommends_discarding_an_unterminated_comment`; professor case P73 |
| Lexer and parser results were not shown on the workbench | "Run lexer and Run parser show their results on the workbench itself" (vitest) |
| Mixed-case documentation pages were listed but returned HTTP 400 | `test_mixed_case_docs_open_and_doc_images_are_served_safely` |
| The backend did not find `parallaxc.exe` (Windows) or MSVC's `build\Release\` folder | `test_health_reports_compiler` (accepts `parallaxc` or `parallaxc.exe`); lookup in `config.locate_compiler` |
| dataset generator glued tokens when deleting (`f(x` → `fx`) | `test_glue_detection`, `test_dataset_generation_is_reproducible` |
| `true`/`false` insertions were not counted as invented content | `repair_missing_identifier_abstains_with_low_confidence`, catalog S10 |
| repaired text spelled `while ( x` after inserting `(` | catalog S04 |
| diff paired the wrong lines for inline highlighting | covered by `lineDiff` tests and visual check |
| mobile topbar overflow (horizontal scroll at 390 px) | checked with Playwright screenshots (scrollWidth = viewport) |

## Performance and robustness

- Benchmark: 900 cases × 6 IntelliFix configurations + diagnostics + 2 CPCT+ replicates in about 28 s on 4 CPUs. Per case, IntelliFix averages 306 parser invocations and about 10 ms of engine time (p95 about 28 ms).
- Pathological input: 6000 nested parentheses reach the parser stack limit and are reported; 64 KB inputs are accepted; larger inputs are rejected with 413.
- Determinism: the C++ test `repair_is_deterministic` compares two full JSON reports (timings stripped). A full evaluation re-run reproduced every IntelliFix metric exactly.
