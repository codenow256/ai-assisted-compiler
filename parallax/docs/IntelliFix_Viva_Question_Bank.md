# IntelliFix — viva question bank (96 questions)

Answers are short on purpose: say the first sentence, then add detail only if asked. **[F]** marks where to point in the files or UI. Numbers are from the held-out test split (540 cases) unless stated.

## A. Compiler basics (1–12)

1. **What is a compiler front end?** The lexer, the parser and (usually) semantic analysis: from text to a checked tree. IntelliFix implements the lexer, the parser, the AST, name resolution (used as evidence) and repair. No code generation.
2. **Lexer vs parser?** The lexer groups characters into tokens using regular expressions. The parser checks token order using a context-free grammar and builds structure.
3. **Why separate them?** Each is simpler and faster. Regular languages suffice for tokens; the grammar then works on about 40 token kinds instead of characters.
4. **What is a token?** A kind, a lexeme (exact text) and a span (line, column, byte offsets). Example: `IDENT total 3:7–3:12`.
5. **What is a context-free grammar?** Rules of the form `A → α`, where the left side is one nonterminal. MiniC has 97 rules. **[F]** `compiler/grammar/minic.y`
6. **Parse tree vs AST?** A parse tree records every rule application and every token. The AST keeps only meaning: `(a + b) * c` becomes `Binary(*, Binary(+, a, b), c)`, with no parentheses. **[F]** AST explorer → “Parse tree vs. AST”
7. **What does LR mean?** Left-to-right scan, rightmost derivation in reverse: the parser shifts tokens and reduces rules bottom-up.
8. **What is LALR(1)?** LR(1) with states that have the same core merged. Smaller tables, rarely weaker. It is Bison's default.
9. **Shift/reduce conflict?** In some state, the table could either shift or reduce. MiniC has none: `%expect 0` makes the build fail if one appears.
10. **How is the dangling `else` resolved?** `else` binds to the nearest `if`, via `%precedence LOWER_THAN_ELSE` and `%precedence T_ELSE`.
11. **What is the correct-prefix property?** An LR parser reports an error at the first token that cannot extend any valid prefix. So detection is as early as possible, but not necessarily where the mistake is.
12. **Why are syntax errors hard to localise?** The parser sees a problem only when the input stops making sense. A missing `;` is noticed at the next line's first token.

## B. MiniC and the lexer (13–22)

13. **What is MiniC?** A C subset for teaching: four types, functions, 1-D arrays, `if/while/for`, `return/break/continue`, and arithmetic, comparison and logical operators. **[F]** MINIC_LANGUAGE_SPEC.md
14. **Why not full C?** Typedef names make C's grammar context-sensitive; the preprocessor and declarator syntax would also dominate the project. A subset keeps the repair research testable.
15. **Why is assignment a statement?** It keeps the grammar LALR(1) without tricks and makes `=` vs `==` errors detectable: `if (x = 1)` is rejected.
16. **What happens with `i++`?** The lexer emits an `UNSUPPORTED` token with the message “write x = x + 1”. The status is *Unsupported construct*, so IntelliFix does not fake a repair.
17. **Why recognise unsupported C at all?** Students write C. Saying “this is C, not MiniC” is more useful than “unexpected `+`”.
18. **What Flex options matter?** `reentrant` (no global state, safe per request), `nounistd` (builds on Windows), `nodefault` (every input matches a rule), `8bit`, and `never-interactive`.
19. **How are lexical errors handled?** As `ERROR` tokens with a message; lexing continues. Examples: invalid character, malformed number (`12abc`, `.5`), out-of-range integer, unterminated comment, non-ASCII outside comments, identifiers over 255 characters.
20. **How are positions computed?** Lines start only at `\n` (CRLF counts once); columns are 1-based in Unicode code points; offsets are UTF-8 bytes. On Windows, stdin is switched to binary mode, so CRLF offsets stay exact.
21. **What is maximal munch?** Flex takes the longest match: `<=` is one token. That is also why `- -i` needs a space (otherwise `--`).
22. **What happens to comments?** They are kept as trivia (not tokens), so a repaired program keeps the user's comments and spacing.

## C. Parser and Bison (23–34)

23. **Which Bison features do you use?** A pure parser (`api.pure full`), `parse.error custom` (our own messages), `parse.lac full` (exact expected sets), `parse.trace`, error productions for panic mode, and `%expect 0`.
24. **What is LAC and why does it matter?** Lookahead correction: before default reductions, Bison checks that the lookahead can actually be shifted. Without it, “expected” lists can be wrong because of default reductions and LALR state merging. IntelliFix generates candidates from those lists.
25. **How does IntelliFix ask “what could come next at position p”?** It re-parses with a probe that forces an error at token p and reads the exact LAC expected set there (`expected_at`).
26. **How many states, and how do you show one?** 168. The Grammar & parsing page shows the state at the error, with its items and actions, read from Bison's own `parser.output`.
27. **In the missing-semicolon example, which state is the parser in at the error?** State 47: `add_expr: mul_expr .`, having just reduced `0`. It expects an operator, `;` or `,`, and sees `int`.
28. **What is panic-mode recovery?** On error, pop states until one can shift `error`, then skip tokens to `;` or `}`, and continue. **[F]** the `error T_SEMI` and `error T_RBRACE` rules.
29. **Why not rely on panic mode?** It reports spurious errors: 3.85 diagnostics per test case on average, with 61% of cases having at least one spurious diagnostic. And it never says what to change.
30. **What is the parser stack limit?** `YYMAXDEPTH` 5000 entries: about 2500 nested blocks or 5000 nested parentheses. Beyond that, the parser reports a resource limit, and IntelliFix reports *Unsupported construct* without searching.
31. **Is the parser thread-safe?** Yes: re-entrant and pure. The only process-wide flag is Bison's `yydebug` tracing, which is safe because each request is its own process.
32. **Why do lexing and parsing run as a subprocess per request?** Isolation (a crash cannot take down the server), timeouts, and the same binary for the CLI, the evaluation and the UI.
33. **What does `parse.error custom` give you?** Messages like “unexpected type-keyword 'int'” with token categories, plus a structured expected list, instead of Bison's generic text.
34. **How do you know the grammar matches the spec?** Parser tests over fixtures, 61 catalog cases, and a fuzzer that generated 200 random valid programs, all of which parsed.

## D. Repair engine (35–52)

35. **What is a repair candidate?** One or two token edits (insert, delete, replace) applied to a copy of the token stream.
36. **Edit costs?** Insert 1, delete 1, replace 1.5. A replace is cheaper than delete plus insert, but not free.
37. **Where are candidates generated?** At the error token and the 3 before it, for every LAC-expected kind. Layout generators reach up to 60 tokens back. Two-edit combinations are tried only if no single edit works.
38. **What are the layout generators?** A `;` at line ends; `{` after `)` or `else` when the next line is indented; `}` before a dedent; deleting a doubled delimiter.
39. **When is a candidate accepted?** The whole program parses (`valid`), or the parser gets at least 3 tokens past the edit (`local-repair`). Moving the error by less (`defers-error`), not moving it (`same-location`), or creating an earlier error is rejected.
40. **Why 3 tokens?** The classic Burke–Fisher-style progress criterion. Too few accepts edits that just shift the error; too many rejects good local fixes before the next real error.
41. **What is the source round trip?** Rebuild the text from the edited tokens with the user's own whitespace and comments, re-lex it, require identical tokens, and re-parse it. It catches edits that would print wrongly, e.g. tokens gluing together.
42. **What is a placeholder?** A visible invented token for something unknowable: `__hole` for a missing name, `0` for a number. It forces *Low confidence*.
43. **How many candidates are typical?** 60 for the missing-semicolon example (3 accepted); on test, a mean of 306 parser invocations per case (median 153). That is about 10–14 ms of engine time, depending on the machine.
44. **What is the search budget?** 30,000 parser invocations or 4 s. It was never exhausted on the benchmark; when it is, the status says so.
45. **What is an AST equivalence class?** Candidates whose repaired programs have identical canonical ASTs, e.g. `(a + 2)` and `(a) + 2`. They are one alternative.
46. **Why group by AST?** So two edits that mean the same thing do not shrink the margin and make IntelliFix falsely “unsure”.
47. **What are hypothesis lanes?** For the top 3 first-error classes, repair the next error (2 alternatives per step), up to depth 4 and 12 leaves. Each path is a possible complete plan.
48. **What is the stability report?** Which later error sites appear under every explored hypothesis (stable) and which only under some. It is evidence, not proof.
49. **How are multiple errors handled?** Through lanes: one step per error. Example: a missing `;` and a missing `)` are fixed by the plan `insert ';' at 2:16 + insert ')' at 3:13`.
50. **What if the error needs 3 or more edits at one site?** Out of scope by design: the result is *No safe repair* (catalog S33/S34).
51. **Is the engine deterministic?** Yes. Ties are broken by cost, then generation order; 40 fuzz inputs re-run gave identical results.
52. **What did the professor-style suite find in the engine?** Two defects, both fixed with regression tests. A valid program nested too deeply was “repaired” by deleting braces. And an unterminated `/*` was replaced with `}`, silently discarding the code inside it; that is now capped at *Low confidence*.

## E. Evidence and decision (53–66)

53. **How is a candidate scored?** `score = Σ value × weight` over 13 named features. **[F]** REPAIR_ALGORITHM.md §5; Repair lab → Evidence breakdown.
54. **Name five features and their signs.** `edit_cost` −1.0; `resolves_all_errors` +2.0; `placeholder_tokens` −1.5; `line_end_semicolon` +0.75; `name_warnings` −0.75.
55. **Recompute the missing-semicolon winner.** −1.00 (cost) + 2.00 (resolves) + 0.75 (line-end `;`) = 1.75.
56. **Why does `replace 'int' with ';'` score −4.00?** −1.5 cost, +2 resolves, −0.75 for a deleted keyword, and −3.75 for 5 name warnings (`i` becomes undeclared).
57. **How were the weights chosen?** By hand, on the dev split only. They were frozen at commit `03331c0` before the first test run.
58. **Why not learn the weights?** No real error corpus; a learned model on synthetic data would overfit our mutation generator. Interpretability was a goal. Learning is future work.
59. **Is the score a probability?** No. It only ranks. The margin is a score difference; no calibration is claimed.
60. **What is the margin?** The score of the best AST class minus the score of the second-best class.
61. **What is τ and how was it chosen?** The minimum margin required to recommend: 1.5. It is the τ with the largest dev coverage whose dev selective risk is ≤ 10% (dev coverage 45.6%, risk 5.5%).
62. **List the seven statuses.** No repair needed, Recommended, Multiple plausible, Low confidence, No safe repair, Budget exhausted, Unsupported construct.
63. **In what order are they decided?** Valid → unsupported (or nesting limit) → no candidates → incomplete plan, placeholder or discarded code (low confidence) → margin < τ (multiple plausible) → recommended.
64. **Give an example of each.** Valid program; missing `;` (margin 2.00); `a b` (margin 0.00); `int = 4;` (placeholder); `class A { … }`; a deliberately tiny budget (catalog R07); `i++`.
65. **Why is an extra `}` only “multiple plausible”?** Its margin is 1.20 < 1.5: `insert '{' at 2:12` is a close alternative. The right fix is still ranked first.
66. **Can a Recommended repair be wrong?** Yes: 33 of 274 test recommendations (12.0%). Live example: `whlie (i < 3) {` gets `insert ';'`, which parses as a call. Parser-valid is not intent.

## F. Evaluation (67–80)

67. **Describe the benchmark.** 30 hand-written valid programs; 24 single-error and 6 two-error mutations each; 900 cases; seed 20261024.
68. **How was it split, and why?** By program: 12 dev (360 cases), 18 test (540). Mutations of one program are near-duplicates, so a case split would leak.
69. **Which systems were compared?** A raw parser, B panic mode, C least-cost, D no grouping, E no stability, F no abstention, L no layout, P full IntelliFix, G CPCT+.
70. **What is the main metric?** Top-1 AST match: the first plan's canonical AST equals the original program's.
71. **Why AST rather than text?** Formatting and redundant parentheses should not count as wrong. Exact token match is also reported (70.9%).
72. **Headline results?** P 71.5% [67.5, 75.1]; C 55.2%; CPCT+ 47.4–49.1%; P − C +16.3 [13.1, 19.4].
73. **What does abstention buy?** Wrong-but-confident falls from 28.5% (forced) to 6.1% at 50.7% coverage; selective accuracy is 88.0%.
74. **Denominators?** Top-1, coverage and wrong-but-confident: all 540. Selective accuracy and risk: the 274 recommendations.
75. **What did not work?** Stability evidence: +0.2 points, CI [−0.4, 0.9]. Grouping: a small coverage gain only. τ missed its 10% risk target (12.0%).
76. **What is AURC?** The area under the risk–coverage curve: mean risk as you accept cases by decreasing confidence. P 0.139 vs C 0.378 (oracle 0.045).
77. **Why paired bootstrap?** Both systems are scored on the same cases, so pairing removes case difficulty from the variance. 2000 resamples, seed 7.
78. **Why does CPCT+ vary between runs?** It breaks ties among equal-cost repairs nondeterministically. Its two replicates agree on only 68.6–70.1% of cases.
79. **What was found in the evaluation audit?** A harness bug overwrote the τ-check count with CPCT+ data, so “25/25” was not stored. It is fixed, and the re-run shows 25/25. All other non-CPCT+ results reproduced exactly.
80. **Threats to validity?** Synthetic errors; 30 programs by one author with consistent indentation (which flatters layout evidence); weights hand-tuned on dev; AST match ignores intent beyond structure; several comparisons.

## G. Engineering (81–90)

81. **Architecture?** React/TypeScript UI → FastAPI backend → `parallaxc` C++ binary over stdin/stdout JSON. **[F]** ARCHITECTURE.md
82. **Why a subprocess, not Python bindings?** Isolation, timeouts, one binary for all uses, and no ABI issues across platforms.
83. **How does the backend avoid blocking?** `subprocess.run` runs in a worker thread (`asyncio.to_thread`), limited by a bounded semaphore (4 concurrent by default). This also works on every Windows event loop.
84. **What errors can the API return?** 413 input over 64 KB; 422 malformed request; 503 compiler unavailable; 504 timeout; 500 compiler crash or bad JSON. None returns fake results.
85. **Why did the UI say “Compiler not built” on Windows?** The backend looked only for `build/parallaxc`, without `.exe`, and missed MSVC's `build\Release\`. Also, no C++ compiler was installed (`cl` missing). Both the lookup and the build instructions were fixed.
86. **What Windows portability work was done?** Binary-mode stdin/stdout; no POSIX headers; MSVC flags; a MinGW toolchain file with a static runtime; PowerShell scripts. Tested via cross-compile plus Wine: 68/68 tests. Not yet run on real Windows.
87. **How is the UI kept honest?** Every value comes from an API response. Each result row says whether it belongs to the current or an earlier text. When the compiler is missing, errors are shown, not samples.
88. **What tests exist?** C++ unit tests (68), backend API tests (32), evaluation and catalog tests (161, including the 88 professor cases), frontend unit tests (26), a Playwright end-to-end test, and `scripts/test_all.sh`.
89. **How was robustness tested?** 88 hand-written professor-style cases, 800 seeded fuzz inputs (generated valid programs, mutants, token soup, random characters) checked against hard invariants, and 7 HTTP sequences (failure then success, concurrency, oversized input).
90. **Security considerations?** Input size limits, timeouts, no shell (arguments passed as a list), static files served only from `dist`, compiler text rendered as text (no HTML injection), and CORS restricted to localhost by default.

## H. Limits, ethics, novelty (91–96)

91. **Biggest limitation?** No real student data: every number is on synthetic mutations.
92. **What is new?** No single technique. The integrated, inspectable pipeline (layout evidence, evidence ranking, AST grouping, abstention on top of LAC-guided local repair) and its honest ablation-based evaluation. **[F]** IntelliFix_Research_Contribution_and_Novelty.md
93. **Is it better than CPCT+?** Better at top-1 recovery of the original program on our benchmark. Not shown to be better at what CPCT+ optimises.
94. **Could IntelliFix harm learners?** A confident wrong fix could mislead. Abstention reduces that to 6.1% of cases, and the UI always shows the evidence and the alternatives.
95. **What would you do next?** A real-error study; learned weights on real data; type-aware evidence; a wider search for distant causes; a usability study with students.
96. **What did you learn?** *(Personal answer. Prepare your own; do not memorise someone else's.)*

## I. Team questions (prepare, do not invent)

- *Who did what?* Answer only with contributions the team has agreed and can show (e.g. commit history, meeting notes). Do not claim a module you cannot explain in depth.
- *How did you split the work?* Describe the real process.
- *What was hardest?* Use a real example. Candidates: Windows build setup, the detection-vs-cause problem, deciding when to abstain.
