# IntelliFix — from zero to advanced (five levels, with exercises)

Every answer below was produced by the real compiler (`parallaxc`, at the UI's threshold τ = 1.5) on 25 Oct 2026. Check them yourself: paste the input into the **Code workbench** and press the button named in the exercise. Or run `./compiler/build/parallaxc repair --tau 1.5 < file.mc`. If your result differs, the code has changed since; trust the tool, not this page.

How to use it: try each exercise before opening its answer. A level is done when you can explain the answers aloud without notes.

---

## Level 1 — Text to tokens (lexical analysis)

**Learn.** A lexer reads characters and groups them into **tokens**: keywords (`int`), identifiers (`total`), literals (`10`), operators (`<=`), punctuation (`;`). Spaces and comments separate tokens but are not tokens. The lexer knows how words are *spelled*, not whether a sentence is grammatical. Flex picks the **longest match** at every point (“maximal munch”), so `<=` is one token, not `<` then `=`.

**Read:** Complete Learning Guide B1–B2; LEXER_DESIGN.md. **Page:** Lexical analysis.

| # | Exercise (button: **Run lexer**) |
|---|---|
| 1.1 | How many tokens does `int x = 10;` have, and what kinds are they? |
| 1.2 | Do `x=y+1` and `x = y + 1` give different tokens? |
| 1.3 | What happens with `int x = 12abc;`? |
| 1.4 | What happens with `float f = .5;`? |
| 1.5 | Compare `a <= b` with `a < = b`. |
| 1.6 | What does the lexer say about `i++`? |

<details><summary>Answers</summary>

1.1 Five: `INT IDENT ASSIGN INT_LIT SEMI`.
1.2 No: both are `IDENT ASSIGN IDENT PLUS INT_LIT`. Whitespace only separates tokens.
1.3 `INT IDENT ASSIGN ERROR SEMI`, with “malformed numeric literal: digits immediately followed by letters”. The lexer reports the error as a token and keeps going; it does not crash.
1.4 An `ERROR` token: “MiniC requires a digit before the decimal point”.
1.5 `a <= b` → `IDENT LE IDENT`; `a < = b` → `IDENT LT ASSIGN IDENT`. The space splits the operator, and the *parser* will then reject `< =`.
1.6 `IDENT UNSUPPORTED`: “increment/decrement operator '++' is not part of MiniC; write x = x + 1”. C features are recognised on purpose, so IntelliFix can say “this is C, not MiniC”.
</details>

---

## Level 2 — Tokens to structure (parsing)

**Learn.** The parser checks the token order against the **grammar** (97 rules) using an LR automaton (168 states). It stops at the first token that cannot continue any valid program, and LAC gives the exact list of tokens it would have accepted there. That is where the error is **detected**, which is not always where it was **made**. **Panic mode** then skips ahead to report more errors, sometimes including spurious ones.

**Read:** Learning Guide B3–B4; GRAMMAR_AND_PARSER.md. **Pages:** Grammar & parsing, AST explorer.

| # | Exercise (button: **Run parser**) |
|---|---|
| 2.1 | Where is the error reported in `if (x > 0 {` (line 3 of a small `main`), and what was expected? |
| 2.2 | Is `x = y = 1;` valid MiniC? Where does the parser stop? |
| 2.3 | In the missing-semicolon sample, on which line is the error *detected* and on which line was it *made*? |
| 2.4 | The `if (x > 0 {` program has one mistake. How many diagnostics does panic mode report? Why? |
| 2.5 | Open the AST explorer for `int x = (1 + 2) * 3;`. Where did the parentheses go? |

<details><summary>Answers</summary>

2.1 `unexpected punctuation '{'` at 3:13. Expected: an operator (`+ - * / % == != < <= > >= && ||`) or `)`.
2.2 No. Assignment is a statement in MiniC. The parser stops at the second `=` (`unexpected operator '='` at 4:9).
2.3 Detected at 4:3 (`int`); made at the end of line 3.
2.4 Three. After the real error, recovery resynchronises at the wrong place and reports follow-on errors that the programmer did not make.
2.5 They are not in the AST: the tree shape `Binary(*, Binary(+, 1, 2), 3)` already encodes the grouping.
</details>

---

## Level 3 — Many fixes, checked by the parser (candidates and validation)

**Learn.** IntelliFix proposes **insert / delete / replace** edits near the error (the error token and 3 before it), plus **layout** edits (a `;` at a line end, a brace at an indentation change), plus 2-edit combinations if no single edit works. Each candidate is parsed. It is **accepted** only if the whole program parses (`valid`) or the parser gets at least 3 tokens further (`local-repair`). Accepted candidates are turned back into text, re-lexed and re-parsed (**round trip**).

**Read:** Learning Guide B5–B6; REPAIR_ALGORITHM.md §2–4. **Page:** Repair laboratory → *Rejected* tab.

| # | Exercise (button: **Repair suggestions**, then open the Repair laboratory) |
|---|---|
| 3.1 | For `int c = a b;`, how many candidates were generated and how many accepted? |
| 3.2 | For the missing-semicolon sample, why is `delete 'int' at 4:3` rejected? |
| 3.3 | For `int b = (a + 2;`, two accepted candidates exist. What are they, and why is there only one class? |
| 3.4 | Why does IntelliFix not just try every possible edit anywhere in the file? |

<details><summary>Answers</summary>

3.1 66 generated, 20 accepted: `+ - * / % == …` between `a` and `b` all parse.
3.2 Outcome `defers-error`: it moves the error 0 tokens past the edit, and 3 are needed. Deleting `int` just makes `i` the unexpected token.
3.3 `insert ')' at 2:17`, giving `(a + 2)`, and `insert ')' at 2:13`, giving `(a) + 2`. Both give the same AST, so they form one class. The decision says “only one structurally distinct repair was found”.
3.4 Cost and false alarms. Each candidate needs a parse; the search is bounded (at most 30,000 parses or 4 s). Locality matches how most slips happen. The price: causes far from the detection point are not found (KNOWN_LIMITATIONS.md).
</details>

---

## Level 4 — Choosing, and knowing when not to (evidence, grouping, lanes, decision)

**Learn.** Every accepted candidate gets `score = Σ value × weight` over 13 features. Candidates with equal ASTs form a **class**. The **margin** is the score of the best class minus the second-best. The decision rules, in order: unsupported construct → no candidate → incomplete plan or placeholder or discarded code (low confidence) → margin < τ = 1.5 (multiple plausible) → recommended. For several errors, **lanes** repair the later errors under each of the top 3 first-fix hypotheses.

**Read:** Learning Guide B7–B10; End-to-End Trace §3. **Pages:** Repair laboratory → Evidence breakdown; Hypothesis explorer.

| # | Exercise (button: **Full analysis**) |
|---|---|
| 4.1 | Missing-semicolon sample: write down the score of `insert ';' at 3:16` from its evidence rows. |
| 4.2 | Same sample: why is `replace 'int' with ';'` scored −4.00? |
| 4.3 | `int c = a b;`: what is the margin, and the status? |
| 4.4 | `int = 4;`: the margin is 1.45. Why is the status *Low confidence* and not *Multiple plausible*? |
| 4.5 | The two-error function (`int s = a + b` with no `;`, then `if (s > 10 {`): what is the plan, and what is the margin? |
| 4.6 | An extra `}` at the end of a file: the right fix (`delete '}' at 4:1`) is ranked first. Why is it not recommended? |

<details><summary>Answers</summary>

4.1 `edit_cost` 1 × −1.0 = −1.00, plus `resolves_all_errors` +2.00, plus `line_end_semicolon` +0.75, giving **1.75**.
4.2 Cost −1.50, plus resolves +2.00, plus deleted keyword −0.75, plus 5 name warnings × −0.75 = −3.75 (`i` is no longer declared). Total **−4.00**.
4.3 Margin **0.00**: all 20 operators score 1.00. Status **Multiple plausible**. Correct behaviour: nothing in the text says which operator was meant.
4.4 The rule for placeholders comes before the margin rule. The best plan inserts `__hole` because the variable's name is unknown, so the status is *Low confidence* whatever the margin.
4.5 Plan `insert ';' at 2:16 + insert ')' at 3:13`, margin **3.50**, status **Recommended**.
4.6 Margin **1.20** < τ = 1.5. The alternative `insert '{' at 2:12` (score 0.30) is close enough, so the status is *Multiple plausible*, and the first fix is shown as “not recommended”.
</details>

---

## Level 5 — Is it any good? (evaluation and research)

**Learn.** 900 synthetic cases from 30 programs, split **by program** into dev (360) and test (540). All tuning happened on dev; the model was frozen before the test run. Metrics have exact denominators. Differences are reported with 95% intervals (Wilson for proportions, paired bootstrap for differences). Ablations switch off one idea at a time.

**Read:** EVALUATION_PROTOCOL.md; IntelliFix_Evaluation_and_Reproducibility.md; RESULTS_AND_IMPACT.md. **Page:** Evaluation & impact.

| # | Exercise |
|---|---|
| 5.1 | 274 recommendations, 241 correct, 540 test cases. Compute coverage, selective accuracy, selective risk and the wrong-but-confident rate. |
| 5.2 | Why is wrong-but-confident divided by *all* cases, not by recommendations? |
| 5.3 | Why split by program, not by case? |
| 5.4 | Forced top-1 (no abstention) has the same top-1 accuracy as IntelliFix (71.5%). So what does abstention buy? |
| 5.5 | The stability ablation changed top-1 by +0.2 points, CI [−0.4, 0.9]. What may you claim? |
| 5.6 | CPCT+ scored 47.4–49.1% top-1 over three runs. Is IntelliFix a better error-recovery algorithm than CPCT+? |
| 5.7 | Design an experiment that would test IntelliFix on real errors. |

<details><summary>Answers</summary>

5.1 Coverage 274/540 = 50.7%. Selective accuracy 241/274 = 88.0%. Selective risk 33/274 = 12.0%. Wrong-but-confident 33/540 = 6.1%.
5.2 Otherwise a system could look safe by recommending almost nothing. Over all cases, refusing never makes a number look better by itself, and coverage is reported next to it.
5.3 Mutations of one program are near-duplicates. With a case-level split, the test set would contain near-copies of tuning cases (leakage).
5.4 It changes which answers are presented as confident: wrong-but-confident falls from 28.5% to 6.1% (difference −22.4 points, CI [−25.9, −18.9]). Accuracy of the top choice is unchanged by design, because abstention does not change the ranking.
5.5 Only that no benefit was shown. The interval includes 0. Say “not supported”, not “slightly better”.
5.6 No. CPCT+ is built to report all minimum-cost repairs and to reduce cascading errors. We measured only how often its first repair restores the original program, on one grammar with synthetic errors.
5.7 For example: collect anonymised syntax-error snapshots from a programming course, with consent and ethics approval; label the intended fix from the student's next compiling version; freeze IntelliFix; report the same metrics with intervals; compare with least-cost and CPCT+; analyse error types that the synthetic benchmark misses.
</details>

---

## Self-check before the viva

- [ ] I can give the one-, three- and five-minute explanations (Complete Learning Guide, Part A).
- [ ] I can explain *detected* vs *made* on the missing-semicolon example.
- [ ] I can read an evidence breakdown and recompute a score.
- [ ] I can say why each of the seven statuses exists, with an example.
- [ ] I can state every headline number with its denominator and interval.
- [ ] I can name three limitations and the two known confident-but-unintended repairs.
- [ ] I can handle an examiner's random input using the decision tree in the Live Evaluation Guide.
