# IntelliFix: test matrix (audit of 25 Oct 2026)

Branch `feature/parallax-syntax-repair`. Base commit `1d35e88`, plus the audit fixes listed in §4 (not yet committed). Linux, real `parallaxc` 1.0.0, backend started with `./scripts/run_backend.sh`, Chromium (Playwright), τ = 1.5.

**Evidence types used below:**
- **API**: the case was sent to the running backend (`POST /api/repair`) and the real JSON recorded.
- **UI**: the case was driven in the real website in Chromium, and what the page showed was recorded.
- **Auto**: covered by an existing automated test (file named).
- **Code**: verified by reading the implementation.

Nothing is marked PASS without one of these. Reproduce with the scripts in §6 (`scripts/audit/`).

## 1. Automated suites (all run, all pass)

| Layer | Command | Result |
|---|---|---|
| Compiler unit tests (C++) | `ctest --test-dir compiler/build` | 68/68 (+ smoke test) |
| Backend API (pytest) | `cd backend && python3 -m pytest` | 33/33 |
| Evaluation, catalog, 88 professor cases, fuzzing | `python3 -m pytest evaluation/tests` | 161/161 |
| Frontend typecheck | `cd frontend && npx tsc -b` | pass |
| Frontend unit tests (Vitest) | `cd frontend && npx vitest run` | **227/227** (219 before the audit, 8 regression tests added) |
| End-to-end (real browser) | `PARALLAX_E2E=1 ./scripts/test_all.sh` | 15/15 |

## 2. The 25 requested cases

"Status" is the engine's decision. "Category" and "UI" are what the Workspace showed after the audit fixes.

| ID | Purpose | Exact source | Expected (real implementation) | Actual result | Pass | Evidence |
|---|---|---|---|---|---|---|
| T01 | Valid minimal program | `int main() {\n  return 0;\n}` | accepted, AST, no repair | `NO_REPAIR_NEEDED`, AST 5 nodes; UI *Valid MiniC*, step 3 *not needed* | ✅ | API, UI |
| T02 | Several declarations | `int main() {\n  int a = 1, b = 2;\n  float r = 2.5;\n  bool ok = true;\n  char c = 'x';\n  return a + b;\n}` | accepted | `NO_REPAIR_NEEDED`, 21 nodes; one `DeclStmt` holds two `VarDecl`s | ✅ | API, UI |
| T03 | Operator precedence | `int f(int a, int b, int c) {\n  return a + b * c - a / b;\n}` | `-` at the top, `*` and `/` grouped first | `NO_REPAIR_NEEDED`, 16 nodes; the AST Explorer diagram for `-` has 9 nodes; notes: "+ and - group left to right (left-associative)", "`a / b` is grouped first" | ✅ | API, UI (E2) |
| T04 | Nested parentheses | `int main() {\n  int x = ((1 + 2) * (3 - (4 / 2)));\n  return x;\n}` | accepted; parentheses create no nodes | `NO_REPAIR_NEEDED`, 16 nodes | ✅ | API, UI |
| T05 | Functions and calls | `int add(int a, int b) {\n  return a + b;\n}\n\nint main() {\n  return add(1, add(2, 3));\n}` | accepted; nested `Call` | `NO_REPAIR_NEEDED`, 17 nodes | ✅ | API, UI |
| T06 | if/else, for, while, continue | 16-line program in `scripts/audit/cases.py` (T06) | accepted | `NO_REPAIR_NEEDED`, 47 nodes | ✅ | API, UI (E1) |
| T07 | Missing semicolon | `int main() {\n  int x = 1\n  return x;\n}` | `RECOMMENDED` insert `;` at the end of line 2 | `RECOMMENDED`, margin 2.00; plans: insert `;` at 2:12 (valid), replace `return` with `;`, replace with `+`; diagnostic "3:3 unexpected keyword 'return'"; UI *Missing delimiter*, "previous line (2) is missing its `;`" | ✅ | API, UI, Auto (`app.test.tsx`, E2E) |
| T08 | Missing closing brace | `int main() {\n  int x = 1;\n  if (x > 0) {\n    x = 2;\n  return x;\n}` | error at end of input; `}` inserted | `RECOMMENDED`, margin 1.75: insert `}` at 4:11 (vs 6:2); "7:1 unexpected end of input"; UI *Incomplete code* | ✅ | API, UI |
| T09 | Missing closing parenthesis | `int main() {\n  int x = 1;\n  if (x > 0 {\n    x = 2;\n  }\n  return x;\n}` | `RECOMMENDED` insert `)` | `RECOMMENDED`, margin 4.00, insert `)` at 3:12; 2 diagnostics (the second from recovery). Before the fix the UI said *Several syntax errors*; now *Missing delimiter* | ✅ after fix | API, UI, Auto (`journey.test.ts` X18) |
| T10 | Incomplete expression | `int main() {\n  int price = 5;\n  int total = price + ;\n  return total;\n}` | abstain, ask | `MULTIPLE_PLAUSIBLE`, margin 0.50 < 1.5; plans: delete `+` (0.80), replace with `;` (0.30), placeholder `true` (−0.50); UI question "Is the + extra, or is something missing after it?", fill-in suggests `price` | ✅ | API, UI, Auto, E2E |
| T11 | Multiple syntax errors | `int main() {\n  int x = 1\n  if (x > 0 {\n    x = 2;\n  }\n  return x;\n}` | 2-edit plan | `RECOMMENDED`, margin 3.50: insert `;` at 2:12 + insert `)` at 3:12; 3 diagnostics; UI *Several syntax errors*, roles: first (reliable) + 2 × likely independent; after apply, "Disappeared (3)" | ✅ | API, UI, E2E |
| T12 | Ambiguous repair | `int main() {\n  int a = 1;\n  int b = 2;\n  int c = a b;\n  return c;\n}` | abstain; operator options | `MULTIPLE_PLAUSIBLE`, margin 0.00; plans insert `+`, `-`, `*` …; UI "Which operator did you mean between a and b?", 3 cards | ✅ | API, UI, E2E |
| T13 | Abstain instead of guessing | `int main() {\n  int = 42;\n  return 0;\n}` | `LOW_CONFIDENCE` (a name must be invented) | `LOW_CONFIDENCE`, top plan inserts placeholder `__hole`; UI "What should the name be?"; placeholder cards cannot be chosen | ✅ | API, UI, Auto |
| T14 | User-authored repair (valid) | T10 source; *Something else* → line 3 = `  int total = price + 1;` | parser accepts → usable → applied → verified | "Valid MiniC" → Use this answer → step 4 shows the Error node replaced → Apply → "Verified"; editor line 3 = `int total = price + 1;` | ✅ | UI |
| T15 | User-authored repair (still invalid) | T10 source; line 3 = `  int total = price + * 2;` | rejected, cannot be used | "Not valid yet. Still a syntax error at 3:23: unexpected operator '*'"; **Use this answer** stays disabled | ✅ | UI |
| T15b | Student's own edit in practice mode (invalid) | T07 source; type ` +` at the end of line 2; **Check my fix** | real re-parse, honest feedback | "Not fixed yet. The parser still stops at line 3, column 3: unexpected keyword 'return'." | ✅ | UI |
| T16 | Invalid character | `int main() {\n  int x = 1 $ 2;\n  return x;\n}` | lexical error; operator options | "2:13 lexical error: invalid character '$'"; `MULTIPLE_PLAUSIBLE` (replace `$` with `+`, `-`, `*`); UI *Invalid token (lexical error)*, "What did you mean by $?" | ✅ | API, UI |
| T17a | Empty input | (empty) | "no program to analyze", sample offered | parser accepts (empty program is valid MiniC); UI *Empty input*, "The editor is empty: there is no program to analyze.", **Load a sample program** | ✅ | API, UI, Auto |
| T17b | Comments only | `// a note\n/* nothing else */` | no tokens; empty program | UI *Only comments*, "once the lexer removes them, no program is left" | ✅ | API, UI |
| T18 | Incomplete code at end of input | `int main() {\n  int x = 1;\n` | insert `}` | `RECOMMENDED` (only one distinct repair): insert `}`; UI *Incomplete code* | ✅ | API, UI |
| T19 | Unterminated comment | `int main() {\n  int x = 1;\n  /* the comment never ends\n  return x;\n}` | explain; never delete hidden code | `LOW_CONFIDENCE`: the only plan would replace the whole comment, and the hidden code with it. Before the fix, step 3 showed an empty question ("0 structurally different fixes …"). Now: "IntelliFix does not propose a fix here", the reason, and *Write line 3 yourself* | ✅ after fix | API, UI, Auto (`app.test.tsx`) |
| T20a | Unsupported: `i++` | `int main() {\n  int i = 0;\n  i++;\n  return i;\n}` | `UNSUPPORTED_CONSTRUCT`, no repair, rewrite hint | message "write x = x + 1"; status `UNSUPPORTED_CONSTRUCT`. Before the fix, step 3 offered **Choose this fix** for *delete `++`* (changes meaning). Now: no fix offered; the parser-accepted edits are listed as *not offered* | ✅ after fix | API, UI, Auto |
| T20b | Unsupported: `#include` | `#include <stdio.h>\nint main() {\n  return 0;\n}` | unsupported | "preprocessor directives are not part of MiniC"; `UNSUPPORTED_CONSTRUCT` | ✅ | API, UI |
| T20c | Unsupported: string literal | `int main() {\n  print("hi");\n  return 0;\n}` | unsupported | "string literals are not part of MiniC"; `UNSUPPORTED_CONSTRUCT` | ✅ | API, UI |
| T20d | Unsupported: `struct` | `struct point { int x; };\nint main() {\n  return 0;\n}` | unsupported, no plan | "'struct' is a C keyword that MiniC does not support"; 0 plans; UI banner + write-your-own-line | ✅ | API, UI |
| T21a | Deep nesting, 4000 `(` | `int main() { return ((((…1…)))); }` (4000 pairs) | valid; parentheses leave no nodes | `NO_REPAIR_NEEDED`, AST 5 nodes; AST Explorer shows 5 rows | ✅ | API, UI (E6) |
| T21b | Deep nesting, 6000 `(` | same, 6000 pairs | capacity limit, no repair | "parser resource limit: memory exhausted (nesting too deep)", status `UNSUPPORTED_CONSTRUCT`; UI *Too deeply nested*, "capacity limit, not necessarily a mistake" | ✅ | API, UI, E2E |
| T22 | No safe repair | `hello world this is not code` | `NO_SAFE_REPAIR` | `NO_SAFE_REPAIR`, 0 plans; UI explains, offers hints and *Write line 1 yourself* | ✅ | API, UI |
| T23 | Apply → verify → undo | T07 source; Compare fixes → Use this fix → Apply & verify → Apply → Undo | re-analysis, then restoration | "Verified … the lexer, parser and repair engine ran again", "Disappeared (1)"; after Undo the editor is back to the original and step 2 shows *Missing delimiter* again | ✅ | UI, E2E |
| T24 | AST before/after | T12 source; AST Explorer › Before & after (defaults: option 1 vs option 2) | one changed node | "changed `Binary op=+` → `Binary op=-` (line 4)", "edit on the same line: Option 2 insert `-` at 4:12; Option 1 insert `+` at 4:12"; both trees marked | ✅ | UI, Auto, E2E |
| T25a | Integer out of range | `int main() {\n  return 2147483648;\n}` | lexical error | "integer literal out of range (maximum 2147483647)"; `MULTIPLE_PLAUSIBLE`. The UI category was *Invalid characters* (misleading); now *Invalid token (lexical error)* | ✅ after fix | API, UI, Auto |
| T25b | Identifier of 256 characters | `int aaaa…(256) = 1;` | lexical error | "identifier longer than 255 characters"; `LOW_CONFIDENCE`; UI "What should the name be?" | ✅ | API, UI |
| T25c | Exactly 65,536 bytes | 5,043-line valid program | accepted | `NO_REPAIR_NEEDED`, AST 25,198 nodes; Analyze about 5 s. The Tree step took **10.4 s** to draw before the fix and **0.8 s** after; the AST Explorer opens in 2.7 s with a note that 4,741 branches are not drawn; search takes 136 ms | ✅ after fix | API, UI (E5) |
| T25d | 65,537 bytes | the same + one space | refused | HTTP 413 `INPUT_TOO_LARGE`; UI "Input too large … nothing was analyzed" | ✅ | API, UI, Auto |

## 3. AST Explorer checks (UI)

| ID | Check | Result | Pass |
|---|---|---|---|
| E1 | Expand/collapse, sibling and parent navigation, search (T06) | default 35 rows; Collapse all → 1; Expand all → 47; on `For`, **next sibling →** goes to `While`; the parent link goes to `Block`; search "While" marks 1 node | ✅ |
| E2 | Expression diagram only where it makes sense (T03) | `Param`: no diagram; `Function`: no diagram; `Binary -`: 9-node diagram with precedence and associativity notes | ✅ |
| E3 | Partial tree after a syntax error (T09) | banner "Partial tree: your code has syntax errors"; 3 real `Error` nodes from recovery; *After the fix* → "AST after the top-ranked repair (insert ')' at 3:12)" | ✅ |
| E4 | Empty / unavailable tree | empty input → 1 row (`Program`, a valid empty program); `hello world …` → "The parser could not build even a partial tree … Nothing is drawn rather than inventing nodes" (wording improved in the audit) | ✅ |
| E5 | Very large tree (25,198 nodes) | stays responsive (see T25c) | ✅ after fix |
| E6 | Deep nesting (4000 parentheses) | 5 rows; no node for parentheses | ✅ |
| E7 | Source → node | clicking the `;` of `return a + b * c;` selects `Return` | ✅ (E2E) |
| E8 | Grammar rule, absorbed tokens | `Binary +` → `add_expr → add_expr '+' mul_expr`; `+` "stored as the operator (op)" | ✅ (E2E, `astModel.test.tsx`) |
| E9 | Every node kind the parser can emit has an explanation and a grammar rule | 26 kinds in `ast.hpp`, 26 in `astInfo.ts`; the rule is checked for every node of every fixture tree | ✅ (Auto, Code) |
| E10 | Specialist pages reachable with a back link | Token table, Parser state, All candidates, Hypothesis lanes, Evaluation, Learning, Documentation all load with 0 console errors | ✅ (UI) |
| E11 | Phone width 390 px | no horizontal page scroll | ✅ (E2E) |

## 4. Problems found and fixed in this audit

| # | Severity for the demo | Problem | Fix | Evidence |
|---|---|---|---|---|
| 1 | **High** (wrong advice) | For unsupported C (`i++`, `#include`, strings) step 3 offered **Choose this fix** for deleting the construct. The engine refuses to repair these because deletion changes the meaning. | No fix is offered; the parser-accepted edits are listed under "not offered, because they change what the program means"; *write the line yourself* is available | new test in `app.test.tsx`; UI re-run T20a–c |
| 2 | **High** (misleading text) | Unterminated comment: step 3 showed a question with no real options and "0 structurally different fixes all make the code parse" | No question is shown when every plan would delete hidden code; it explains why and offers *write line N yourself* | new test in `app.test.tsx`; UI re-run T19 |
| 3 | Medium (slow page) | Tree step / AST Explorer took 10 s for a 64 KB program (25k nodes drawn) | The outline draws at most 1,500 rows; the selected node and its ancestors, and search hits, are always drawn; a note says how many branches are hidden | new test in `astModel.test.tsx`; T25c 10.4 s → 0.8 s |
| 4 | Medium (wrong label) | A single missing `)` was labelled *Several syntax errors* because recovery produced a second report | *Several errors* now requires the best valid plan to need several edits (or no valid plan with several reports) | `journey.test.ts` X18; UI re-run T09 |
| 5 | Low | Out-of-range numbers and over-long names were labelled *Invalid characters* | Label *Invalid token (lexical error)* with an accurate description | `journey.test.ts` |
| 6 | Low | "How the 1 options differ" | "The only option the engine found" | code |
| 7 | Low | The no-tree message gave examples that did not apply ("ends inside a comment …") | Neutral message pointing to the diagnosis | UI E4 |
| 8 | Low | The guide described a Learning-center link on Research & Method that did not exist | Link added | code |
| 9 | Test only | One unit test could miss a hint under heavy load (it checked immediately instead of waiting) | It now waits for the element; 3 consecutive full runs pass | `app.test.tsx` |

## 5. Known limitations and observations (not fixed)

- The 413 message says "exceeds 65536 characters" (from the request schema), while the limit is enforced in **bytes** (`check_bytes`). For ASCII code they are the same.
- After **Expand all / Collapse all** the tree updates one frame later. It is not visible to a person, but an automated check that reads the row count instantly sees the old count.
- In the read-only source pane of the AST Explorer, nodes are selected with the mouse. Keyboard users navigate with the arrow keys in the tree instead.
- The "likely consequence / likely independent" labels use the rank-1 candidate only. In T11, the two later reports are labelled *likely independent of the first*. That is true, but they are side effects of the *second* error, and they disappear after the two-edit plan (shown in step 5).
- Step 5 matches reports by message text. The partial → complete tree match in step 4 is line-based.
- The command-line default τ is 1.0; the website uses 1.5 (chosen on the dev split). At τ = 1.0, coverage is 58.0%.
- **Not tested here:** browsers other than Chromium, real Windows, macOS, screen readers, real users.

## 6. Reproduce

```bash
cd parallax
(cd frontend && npm run build)
./scripts/run_backend.sh &                    # http://127.0.0.1:8000
PARALLAX_E2E=1 ./scripts/test_all.sh          # every automated layer, incl. 15 browser journeys
cd scripts/audit
python3 run_api.py                            # §2 through the API
python3 make_cases_json.py && node run_ui.cjs # §2 through the website
node run_ui2.cjs                              # T14, T15, T23, T24 and §3
```

Every case's exact source is in `scripts/audit/cases.py`. To try a case by hand:
1. Paste its source into **Workspace**.
2. Press **Analyze**.
3. Compare the category, the headline and step 3 with the "Actual result" column.

## 7. Reliability update (26 Oct 2026): sequential correction, repair safety, truthful status

| Case | Source | Verified behaviour (browser, real compiler) | Evidence |
|---|---|---|---|
| R1 sequential multi-error | `int main() {\n  int price = 5\n  int total = price + ;\n  total++;\n  return total\n}` | 3 reports on the first analysis, with "more may appear" explained. Round 1: recommended `;` at 2:16, applied, re-analyzed; a `;` error on line 3 is *newly visible*. Round 2: question "Is the + extra…?", fill-in `price` checked ("This error is fixed; later errors remain"). Round 3: `total++;` → rewrite `total = total + 1;` (parser-checked). Round 4: `;` at 5:15. Then "Verified: every check IntelliFix performs passes", 4 corrections listed, plus what is and is not checked | E2E step "sequential correction…", `reliability.test.tsx` |
| R2 destructive plan | `price + ;` + `total++;` | the engine's complete plan (delete `+`, delete `++`) is never recommended or offered as the main option: it sits under "complete plan … removes code" with the warnings "removes `+`" and "the increment is lost", and the button reads "Choose it anyway (I understand it removes code)" | `reliability.test.tsx`, browser run |
| R3 undeclared name | `total = tal + 1;` | the compiler reports `'tal' is used but not declared` (CLI `analyze` and `repair`, `/api/parse`, `/api/repair`). The UI now shows *Syntax OK, name problems* instead of "valid MiniC", and step 3 says a name problem remains. Completion is blocked until it is fixed | E2E step "undeclared name…", `reliability.test.tsx` |
| R4 risky edits | any plan deleting/replacing operators, names, values, keywords, unsupported constructs | labelled "removes code" and never shown as *Recommended*; punctuation-only fixes (missing `;`) are still recommended | `reliability.test.tsx`, existing E2E |
