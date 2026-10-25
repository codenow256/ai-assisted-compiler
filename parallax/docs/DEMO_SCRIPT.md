# Live demo script (about 12 minutes)

**Setup** (before the audience arrives): `cd parallax && ./scripts/run_backend.sh`, then open <http://127.0.0.1:8000> in a 1440-px-wide window. Every output below is computed live. The built-in **Guided demo** (sidebar) follows the same sequence with Next/Back controls and can be exited at any time.

| Time | Action | What the audience sees (real output) | Point to make |
|---|---|---|---|
| 0:00 | Overview page | pipeline of 7 stages; three idea cards | “Detect → generate → validate → rank → group → explore → decide.” |
| 0:45 | Workbench → sample **Valid program** → *Analyze* | `No repair needed`; stage timings (µs–ms) | the compiler is real; timings are measured |
| 1:30 | Lexical analysis; click a token | table of tokens with spans; source highlight; the Flex rule that emitted it | positions are bytes / lines / code-point columns |
| 2:15 | AST explorer → Tree; click `Binary` | tree; source span highlighted | parse tree vs AST: no parentheses or semicolons in the AST |
| 3:00 | Workbench → **Missing semicolon** → run | detection at 4:3 (`int i`), one line *after* the cause; status **Recommended repair**; `insert ';' at 3:16` | detection ≠ localisation |
| 3:45 | Grammar & parsing | exact expected tokens (LAC); the LR state's items, e.g. `declarator: "identifier" . "=" expr` | why the parser failed, from Bison's own report |
| 4:30 | Repair laboratory | candidates table; evidence bars; top: cost −1, resolves +2, line_end_semicolon +0.75 | “edit cost is one feature among 13” |
| 5:15 | Compare tab (ranks 1 and 2 are pre-selected) | rank 2 is `replace 'int' with ','`, giving the *valid* `int total = 0, i = 1;`. It loses on cost (1.5 vs 1), `deleted_content` (−0.75) and the missing line-end support (margin 2.0) | a different, valid program, rejected for stated reasons |
| 5:45 | Rejected tab | e.g. `defers-error: only moves the error 1 token` | validated by the real parser; moving the error is not a fix |
| 6:15 | Sample **Extra ')'** → AST classes tab | class 0 has two members (`delete ')'` and `insert '('`) | the same AST counts as one hypothesis |
| 7:00 | Sample **Two errors** → Hypothesis explorer | lanes: `insert ';'` → `insert ')'` → valid; alternatives; follow-on sites “stable across tested hypotheses” | stability is evidence, not proof |
| 8:00 | Sample **Ambiguous operator** → Repair lab | **Multiple plausible repairs**, margin 0 < τ = 1.5; 20 classes | abstention instead of guessing `+` |
| 8:45 | Sample **Missing variable name** | **Low confidence**: the best repair invents `__hole` | parser-valid ≠ intended |
| 9:15 | Sample **Missing semicolon** → Accept → Apply | confirmation listing the replaced range; editor updated; “1 repair applied”; Undo available | the user stays in control |
| 9:45 | AST explorer → Compare “Before last accepted repair” vs “Current” | “Cannot compare”: the before-version does not parse. Compare two plans or candidates instead | honest states |
| 10:15 | Evaluation & impact | top-1 71.5% vs 55.2% (least-cost) vs ≈48% (CPCT+); wrong-confident 6.1% vs 28.5%; caveats in yellow | numbers are measured; negative results shown |
| 11:15 | Click a failure case (e.g. a deleted `while`) | loads the corrupted program; live run reproduces a confident wrong repair | known failure mode: cheap valid repairs that change meaning |
| 12:00 | Q&A | — | — |

## Expected outputs per bundled example (documented outcomes; asserted in `test_examples_match_documented_status`)

| Example | Lexer | Parser | Top repair | Status | Why it matters |
|---|---|---|---|---|---|
| 01_valid_basic | 53 tokens, no errors | valid; AST | — | NO_REPAIR_NEEDED | baseline |
| 02_missing_semicolon | ok | `unexpected type-keyword 'int'` at 4:3 | `insert ';' at 3:16` | RECOMMENDED | detection vs cause |
| 03_missing_parenthesis | ok | `unexpected punctuation '{'` | `insert ')'` | RECOMMENDED | one clear repair |
| 04_missing_brace | ok | `unexpected keyword 'return'` at 9:3 | `insert '{' at 5:16` | MULTIPLE_PLAUSIBLE (margin 1.45 < 1.5) | indentation ranks the intended repair first, honestly |
| 05_malformed_expression | ok | `unexpected punctuation ';'` | `delete '*'` | MULTIPLE_PLAUSIBLE | delete operator vs invent operand |
| 06_multiple_errors | ok | first error at `if` | `insert ';'` + `insert ')'` | RECOMMENDED | lanes and stability |
| 07_ambiguous_operator | ok | `unexpected identifier 'b'` | `insert '+'` (one of 20 classes) | MULTIPLE_PLAUSIBLE | abstention |
| 08_abstain_missing_name | ok | `unexpected operator '='` | `insert '__hole'` | LOW_CONFIDENCE | invented content |
| 09_valid_nested | ok | valid | — | NO_REPAIR_NEEDED | deeper AST |
| 10_lexical_error | `ERROR '@'` | error at `@` | replace/delete `@` (14 classes) | MULTIPLE_PLAUSIBLE | lexical → syntax |
| 11_unsupported_construct | `UNSUPPORTED '++'` | error at `++` | — | UNSUPPORTED_CONSTRUCT | “not MiniC” ≠ typo |
| 12_extra_token | ok | `unexpected punctuation ')'` | `delete ')'` (grouped with `insert '('`) | MULTIPLE_PLAUSIBLE (margin 1.0) | grouping; near-equivalent runner-up |

Exact token counts and positions are shown live; regenerate this table with the CLI if the examples change.
