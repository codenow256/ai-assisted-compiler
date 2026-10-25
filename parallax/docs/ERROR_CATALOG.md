# Error catalog

This catalog lists realistic error situations, the behaviour IntelliFix should show, and where that behaviour is tested. It has two kinds of entries:

1. **Language-level cases** (lexical, syntax, repair). They are *executable*: `evaluation/catalog/catalog.py` runs every case through `parallaxc`, pytest asserts the expectation (`evaluation/tests/test_catalog.py::test_catalog_case[<ID>]`), and the **observed** behaviour is generated into [ERROR_CATALOG_RESULTS.md](ERROR_CATALOG_RESULTS.md). At the last run, **61 of 61** cases behaved as expected.
2. **System-level cases** (missing tools, timeouts, concurrency …), tested by the backend, frontend and E2E suites listed below.

Regenerate the observed table with `python -m evaluation.catalog.catalog` (from `parallax/`).

## 1. Lexical cases (IDs L01–L16)

| ID | Case | Expected behaviour |
|---|---|---|
| L01 | illegal character `@` | `ERROR` token “invalid character '@'”; parse error at it; repair offers delete/replace |
| L02 | unterminated block comment | `ERROR` from `/*` to EOF |
| L03 | unterminated char literal | `ERROR` to end of line |
| L04 | malformed numeric literal `12abc` | one `ERROR` token |
| L05 | malformed exponent `1.5e+` | one `ERROR` token |
| L06 | invalid escape `'\q'` | `ERROR` “invalid escape sequence” |
| L07 | two decimal points `1.2.3` | one `ERROR` token |
| L08 | integer out of range | `ERROR` |
| L09 | keyword/identifier boundary `intx` | identifier; parses |
| L10 | multi-character operators | correct longest match; parses |
| L11 | tabs + CRLF | parses; positions correct (also in lexer unit tests) |
| L12 | no final newline | parses |
| L13 | empty input | valid empty program, `NO_REPAIR_NEEDED` |
| L14 | Unicode in comments | parses; columns counted in code points (unit tests) |
| L15 | 256-character identifier | `ERROR` “longer than 255” |
| L16 | `i++` | `UNSUPPORTED_CONSTRUCT` status |

## 2. Syntax cases (S01–S35)

Missing semicolon (S01), extra top-level semicolon (S02), missing `)` (S03), missing `(` (S04), extra `)` (S05), missing `}` at EOF (S06), extra `}` (S07), missing comma (S08), misplaced comma (S09), missing operand (S10), unexpected binary operator (S11), malformed unary expression (S12), assignment in a condition (S13), assignment to a literal (S14), missing identifier (S15), duplicate delimiters (S16), incomplete function declaration (S17), incomplete call (S18), malformed argument list (S19), incomplete conditional (S20), malformed `for` header (S21), incomplete return (S22), array declaration without size (S23), unexpected keyword (S24), statement at top level (S25), error at the very beginning (S26), error in nested blocks (S27), two errors (S28), cascading errors (S29), unusual but valid expressions (S30), empty blocks and statements (S31), dangling else (S32), EOF inside an expression (S33), EOF inside an argument list (S34), excessive nesting (S35).

The expected status for each is in `catalog.py`. Where several statuses are acceptable (e.g. `RECOMMENDED` or `MULTIPLE_PLAUSIBLE`), the set says so explicitly. **Known limitation** shown by S33/S34: an error that needs three or more inserted tokens at one site is outside the cost-2 search, and the honest outcome is `NO_SAFE_REPAIR`.

## 3. Repair-specific cases (R01–R10)

| ID | Case | Expected |
|---|---|---|
| R01 | obvious single insertion | `RECOMMENDED` |
| R02 | obvious deletion plus a second error | an abstaining or recommending status, never a crash |
| R03 | substitution (`:` for `;`) | substitution candidate; `:` is an unsupported token, so `UNSUPPORTED_CONSTRUCT` is acceptable |
| R04 | several plausible repairs | `MULTIPLE_PLAUSIBLE` |
| R05 | structurally equivalent candidates | fewer classes than candidates; `RECOMMENDED` |
| R06 | abstention despite a valid candidate | `LOW_CONFIDENCE` while a parser-valid candidate exists |
| R07 | budget exhausted (`--max-parses 10`) | `budget.exhausted = true` |
| R08 | missing `{` (indentation evidence) | plan contains `while (i < 10) {` |
| R09 | candidate that only defers the error | some candidate rejected as `defers-error` |
| R10 | duplicate candidates | some candidate marked `duplicate` |

Also covered by C++ unit tests (`compiler/tests/test_repair.cpp`): repairs that parse but change meaning (the ambiguous-operator test), candidates that create more diagnostics (`cascade` evidence), different ASTs (classes), equally ranked candidates (deterministic tie-break), malformed internal candidates (round-trip check; `repair_reconstruction_never_glues_tokens`), oversized input (CLI/API).

## 4. System-level cases

| Case | Expected behaviour | Status | Test | Remaining limitation |
|---|---|---|---|---|
| compiler binary missing | HTTP 503 `COMPILER_UNAVAILABLE` with build hint; health `degraded`; UI banner | implemented | `test_missing_compiler_is_503` | — |
| Flex or Bison missing at build time | CMake `find_package(... REQUIRED)` fails with a clear message | implemented | manual (documented in INSTALLATION) | not automated |
| Bison < 3.6 | CMake requires 3.6 (`parse.error custom`) | implemented | manual | — |
| backend starts while compiler missing | starts; health `degraded`; compiler endpoints 503 | implemented | `test_missing_compiler_is_503` | — |
| malformed JSON | 422 `MALFORMED_JSON` | implemented | `test_malformed_json` | — |
| invalid request schema | 422 `INVALID_REQUEST` with field details | implemented | `test_schema_violation` | — |
| backend unavailable | UI: “Backend not reachable” + start command; no fake data | implemented | `api.test.ts`, `app.test.tsx` (offline) | — |
| compiler crash / non-zero exit | 500 `COMPILER_FAILURE`, labelled as not the user's fault | implemented | `test_compiler_crash_is_500` | — |
| compiler emits invalid JSON | 500 | implemented | `test_compiler_garbage_output_is_500` | — |
| timeout | process killed, 504 `COMPILER_TIMEOUT` | implemented | `test_timeout_is_504` | — |
| concurrent requests | isolated processes; identical results | implemented | `test_concurrent_requests_do_not_interfere`, `parser_is_reentrant_across_threads` | — |
| stale frontend response | only the newest response of each kind is applied | implemented | `app.test.tsx` “stale responses” | — |
| empty editor | valid empty program, `NO_REPAIR_NEEDED` | implemented | `test_empty_source_is_valid` | — |
| frontend refresh | editor draft and label restored from browser storage; results recomputed on demand | implemented | E2E “a page refresh keeps the editor draft” | private browsing may disable storage (draft then not kept) |
| unsupported sample id | only existing files are listed; unknown ids are ignored | implemented | `test_examples_are_real_files` | — |
| network interruption mid-request | `BACKEND_UNAVAILABLE` or `TIMEOUT` error banner with retry | implemented | `api.test.ts` | — |
| oversized input | 413 `INPUT_TOO_LARGE` (characters or UTF-8 bytes); UI shows the size limit | implemented | `test_oversized_input`, `test_oversized_after_utf8_encoding` | — |
| excessive nesting | parser resource limit, no crash | implemented | `parser_deep_nesting_…`, catalog S35 | limit fixed at 5000 stack entries |
| dependency installation failure | troubleshooting guide | documented | — | not automated |
| optional Rust/CPCT+ unavailable | capabilities report `available: false` with reason; evaluation records “not run” | implemented | `test_capabilities` | — |

Not every possible input error is handled perfectly. This catalog distinguishes tested coverage from cases that are only documented.
