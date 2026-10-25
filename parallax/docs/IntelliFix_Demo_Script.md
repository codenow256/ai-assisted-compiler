# IntelliFix — live demo script (8 minutes)

> **Interface note (v2, 25 Oct 2026):** page names in this document (Code workbench, Repair laboratory, Guided demo, …) refer to the earlier ten-page interface. The app now has three destinations — Workspace, AST Explorer, Research & Method; [`IntelliFix_UX_v2.md`](IntelliFix_UX_v2.md) §4 says where each earlier page now lives.


Every step uses a built-in sample, so the results are reproducible. Expected results are those observed on 25 Oct 2026 at τ = 1.5. If the screen differs, say so and describe what you see; never narrate the expected result over a different screen.

**Before you start:** the badge shows **Compiler 1.0.0**; the browser is at 100% zoom on the **Code workbench**; Clear has been pressed. Checklist: [IntelliFix_Live_Evaluation_Guide.md §1](IntelliFix_Live_Evaluation_Guide.md).

| Time | Do | Say | Expect on screen |
|---|---|---|---|
| 0:00 | Sample **Missing semicolon** | “Line 3 has no semicolon. Watch where the compiler complains.” | explanation card; run rows say *not run yet* |
| 0:30 | **Run lexer** | “The lexer only splits text into tokens. Spelling is fine, so no error.” | Lexer row: 38 tokens, 0 lexical errors, 1 comment |
| 1:00 | **Run parser** | “The parser stops at `int` on **line 4**, where it detects the error. The mistake is on line 3.” | Parser row: rejected … at 4:3; `int` underlined |
| 1:30 | **Analyze** | “IntelliFix tried 60 edits, and the real parser accepted 3. The best adds `;` at the end of line 3. It leads the next alternative by 2.0, above our threshold of 1.5, so it is recommended.” | green *Recommended repair*; margin 2.00 ≥ 1.50; diff |
| 2:15 | Sidebar → **Grammar & parsing** | “This is Bison's real state 47. The parser has just read `0` and can only continue with an operator, `;` or `,`.” | 15 expected tokens; state 47 items |
| 2:45 | Sidebar → **Repair laboratory**, scroll to *Evidence breakdown* | “Why this fix? Cost −1, parses completely +2, `;` exactly at a line end +0.75. The runner-up writes a comma instead of `int` and loses points for overwriting a keyword.” | scores 1.75 / −0.25 / −4.00; evidence bars |
| 3:30 | Back to workbench → **Accept repair**, then **Analyze** | “Accepting edits the code. Rerun: no repair needed.” | *No repair needed* |
| 4:00 | Sample **Ambiguous operator** → **Analyze** | “`a b`: plus, minus, times… 20 operators all parse and score the same. IntelliFix says so instead of guessing.” | *Multiple plausible*; margin 0.00; top fix “not recommended” |
| 4:45 | Sample **Missing variable name** → **Analyze** | “The name is gone. Any fix must invent one, so: low confidence, with a visible `__hole`.” | *Low confidence*; “1 placeholder token(s)” |
| 5:15 | Sample **Unsupported C construct** → **Analyze** | “`i++` is C, not MiniC. IntelliFix recognises it and tells you how to write it.” | *Unsupported construct*; “write x = x + 1” |
| 5:45 | Sample **Two errors** → **Analyze** → **Hypothesis explorer** | “Two mistakes. Each lane starts from a different first fix and keeps repairing. The best plan fixes both.” | *Recommended*; plan with 2 edits; lanes |
| 6:30 | Sidebar → **Evaluation & impact** | “Measured on 540 held-out synthetic cases: 71.5% of top fixes restore the original program, against 55.2% for least-cost. Only 6.1% of cases get a wrong fix presented as confident.” | headline cards; *caveat* labels |
| 7:15 | Point at the *caveat* rows | “What did not work: stability evidence gave no measurable gain, and the risk target was missed, 12% against 10%.” | caveat rows |
| 7:45 | — | “Examiners are welcome to type their own code.” | → switch to the Live Evaluation Guide |

## If something goes wrong

| Problem | Do |
|---|---|
| Badge says **Compiler missing**, or rows show `COMPILER_UNAVAILABLE` | Stop the demo. Explain that the native compiler is not built on this machine (screenshot 18 shows exactly this state). Build it or switch machines. Never present screenshots as live output. |
| **Backend not reachable** | Restart `run_backend`, then refresh. The draft source survives the refresh. |
| A result row says **earlier text** | You edited after running; click the button again. |
| A different status than in this script | Read what the screen says and explain the decision rule it shows. The code may have changed since 25 Oct. |

## Guided demo (built in)

The **Guided demo** button (bottom left) walks through the same samples, with explanations, using live compiler runs. It is a good fallback if you lose your place.
