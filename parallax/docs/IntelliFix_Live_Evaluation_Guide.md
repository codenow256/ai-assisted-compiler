# IntelliFix — live evaluation guide (when the examiner types their own code)

> **Interface note (v2, 25 Oct 2026):** page names in this document (Code workbench, Repair laboratory, Guided demo, …) refer to the earlier ten-page interface. The app now has three destinations — Workspace, AST Explorer, Research & Method; [`IntelliFix_UX_v2.md`](IntelliFix_UX_v2.md) §4 says where each earlier page now lives.


Every result quoted here was produced by the real compiler, at the UI's threshold τ = 1.5, in the professor-style suite (`docs/IntelliFix_Random_Input_Test_Report.md`, case IDs in brackets). If your screen shows something different, believe your screen and read §5.

## 1. Ten minutes before

| Step | How | You should see |
|---|---|---|
| Compiler built | `compiler/build/parallaxc` (Linux) or `compiler\build\parallaxc.exe` / `compiler\build\Release\parallaxc.exe` (Windows) exists | the file is there |
| Backend running | `./scripts/run_backend.sh` or `scripts\windows\run_backend.ps1` | `Uvicorn running on http://127.0.0.1:8000` |
| Health | open `http://127.0.0.1:8000/api/health` | `"compiler":{"available":true,...}` |
| UI badge | sidebar, bottom left | “Compiler 1.0.0”, not “Compiler missing” |
| Smoke test | Workbench → sample *Missing semicolon* → **Analyze** | all three run rows filled; status **Recommended repair** |
| Clean slate | **Clear** | empty editor, run rows say “not run yet” |

If the badge says **Compiler missing**, nothing will work. Do not improvise: read INSTALLATION_AND_TROUBLESHOOTING.md §3. Never show stored screenshots in place of live output.

## 2. The three buttons, and what each one proves

| Button | Runs | Proves | Where the result appears |
|---|---|---|---|
| **Run lexer** | Flex scanner only | tokens and lexical errors, with exact line:column | *Lexer* row on the workbench, details on **Lexical analysis** |
| **Run parser** | lexer + Bison parser | accept or reject; the first error and the panic-mode diagnostics | *Parser* row; **Grammar & parsing** and **AST explorer** |
| **Repair suggestions** | lexer + parser + repair engine | candidate edits, validation, ranking, decision | *Repair engine* row; **Repair laboratory**, **Hypothesis explorer** |
| **Analyze** | all three | everything above | all three rows |

Each row shows a **current text / earlier text** badge. If you edit after running, the badge tells the examiner that the shown result belongs to the earlier text. Run again.

## 3. What will happen for typical examiner inputs

| The examiner types… | Lexer | Parser | Repair status | What to say |
|---|---|---|---|---|
| a correct program (P01–P04) | clean | accepted | **No repair needed** | “Valid MiniC: the AST explorer shows the tree.” |
| `int x = 5;` alone (P07) | clean | accepted | No repair needed | “A global declaration is a complete MiniC program.” |
| `x = 5;` alone (P05) | clean | rejected 1:1 | Multiple plausible | “Statements must be inside a function; IntelliFix will not pretend to know which fix you meant.” |
| missing `;` (P22–P24) | clean | rejected on the **next** line | **Recommended**: insert `;` at the end of the previous line | “The parser *detects* the error at the next token; IntelliFix *localises* it to the line end.” |
| missing `(`, `)` or `}`, extra `)` (P28–P33) | clean | rejected | Recommended | point at the diff and the validated result |
| extra `}` (P34), missing `{` before an indented body (P35) | clean | rejected | **Multiple plausible** (margins 1.2 and 1.45, just under τ = 1.5) | “The right fix is ranked first, but an alternative is close, so IntelliFix does not recommend it on its own.” |
| two or three errors (P47, P48) | clean | rejected at the first | Recommended, a multi-step plan | open **Hypothesis explorer**: one step per error |
| `int = 4;` (P36) | clean | rejected | **Low confidence**: inserts a placeholder `__hole` | “The variable's name is gone; no tool can know it.” |
| `a b` or `4 * ;` (P37–P39) | clean | rejected | **Multiple plausible** | “`+`, `-`, `*` all parse; the alternatives are in the Repair lab.” |
| `x = 6 @ 3;` (P43) | `invalid character '@'` | rejected | Multiple plausible | “Lexical error first, then the parser; the repair is not certain which operator was meant.” |
| `i++`, `+=`, `switch`, `?:`, `#include`, strings, `do` (P64–P71, P18) | `UNSUPPORTED` token with a message | rejected | **Unsupported construct** | “This is C, not MiniC. IntelliFix says so instead of inventing a repair.” |
| `int *p;` (P68) | clean | rejected | Recommended: delete `*` | “MiniC has no pointers; the parser-valid fix is to drop `*`.” Be ready: that changes the type, so it is a syntax fix, not a semantic one. |
| `class A { public: … }` (P69) | `:` unsupported | rejected 1:1 | No safe automatic repair | “Not MiniC at all.” |
| empty, spaces, comments only (P53–P55) | clean | accepted | No repair needed | “An empty program is valid MiniC.” |
| `12abc`, `99999999999` (P75, P76) | malformed or out of range | rejected | Low confidence | “The lexer flags it; the replacement has to invent a value.” |
| smart quotes `‘a’`, a BOM, emoji, `é` (P79, P83, P85) | `non-ASCII character outside a comment` | rejected | varies | “MiniC is ASCII; Unicode is fine inside comments (P78).” |
| unterminated `/*` (P73) | `unterminated block comment` | rejected | **Low confidence** | “Removing the comment would delete the code hidden inside it, so IntelliFix will not recommend it.” |
| 3000 nested `{` (P86) | clean | parser stack limit | **Unsupported construct** | “Capacity limit, not a syntax error. It is reported, not repaired, and it does not crash.” |
| 64 KB+ of text | — | — | the request is refused (HTTP 413) | “Input limit; the next request works normally (H02).” |

## 4. Two answers you must give honestly

- **`whlie (i < 3) {` gets a Recommended `;` (P41).** That makes `whlie(i < 3);` a call to an unknown function. It parses, but it is not what the programmer meant. Say: *“Parser acceptance does not prove intent. This is a known confident error, documented in KNOWN_LIMITATIONS.md; we did not tune it away because that would be tuning on what we had seen.”*
- **A deleted `while` (P62).** This is the same pattern: inserting `;` turns the loop into an expression and a block.

Never claim “IntelliFix always finds the right fix”. The measured claim: on the synthetic test split, 71.5% of top-ranked repairs restore the original program. Among the repairs it *recommends*, 88.0% are correct.

## 5. Decision tree when something unexpected happens

```
Something looks wrong
├─ Red banner “Backend not reachable”     → the API is down: restart run_backend; refresh the page
├─ “Compiler not built” / COMPILER_UNAVAILABLE → binary missing: stop; build it (Installation §3); do not fake output
├─ COMPILER_TIMEOUT (HTTP 504)             → input is pathological or huge: say so; show a smaller input
├─ HTTP 413                                → over 64 KB: expected limit
├─ Result shows the “earlier text” badge   → you edited after running: click the button again
├─ Status surprises you
│   ├─ Is the input MiniC? (MINIC_LANGUAGE_SPEC §3) → no: Unsupported or No safe repair is correct
│   ├─ Did the parser accept it?          → yes: No repair needed is correct, even for odd code (P21, P61)
│   ├─ Does it need a name or value back? → Low confidence is by design
│   └─ Several operators fit?             → Multiple plausible is by design
├─ A Recommended repair looks wrong       → open the Repair lab, show the evidence rows and the margin;
│                                           admit a confident error is possible (6.1% of test cases)
└─ Anything else (crash, blank page, garbled output)
    → copy the input; say “that is a bug, I'll file it”; check uvicorn's log; continue with a prepared example
```

## 6. Ready-made inputs that are safe to show

The workbench sample dropdown (from `examples/`) contains one example per status. The professor-style case IDs above are reproducible: `python -m evaluation.professor.run_professor_tests` re-runs all of them in about 15 s.
