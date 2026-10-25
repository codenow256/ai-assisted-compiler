# IntelliFix — mock viva (about 25 minutes)

Practise it in pairs. One person reads **Examiner**; the other answers without looking. Then compare with the model answer. ⚠ marks a trap: a tempting answer that is wrong or overclaims.

---

## Round 1 — opening (5 min)

**Examiner:** In two sentences, what have you built?
**Model:** A compiler front end for MiniC, a C subset, using a Flex lexer and a Bison LALR(1) parser. When the parser finds a syntax error, it generates and checks many repair candidates, ranks them by named evidence, and recommends one only when it is clearly better than every structurally different alternative.
⚠ *Do not say “it automatically fixes errors”.* It recommends in about half of the test cases and abstains otherwise.

**Examiner:** Why is that a problem worth solving? Compilers already report errors.
**Model:** They report where they *detect* the error, which is often not where it was made. A missing `;` is reported on the next line. And when they suggest a fix, they usually commit to one, even when several fixes are equally plausible. IntelliFix addresses both: localisation, and honest uncertainty.

**Examiner:** Show me.
**Do:** Workbench → *Missing semicolon* → **Full analysis**. Point at: the parser row, which says 4:3; the diff, which changes line 3; the margin, 2.00 ≥ 1.50.

---

## Round 2 — technical depth (10 min)

**Examiner:** How does the parser know what tokens it expected?
**Model:** Bison's LAC, lookahead correction. Without LAC, default reductions and LALR state merging can make the expected list wrong. With `parse.lac full`, the list is exact. We query it at any position by forcing a probe error there.
*Follow-up:* **What state is it in here?** → 47, `add_expr: mul_expr .`, shown on the Grammar & parsing page from Bison's own report.

**Examiner:** Many edits make this program parse. Why did you pick `;` at the end of line 3?
**Model:** Three valid candidates. `insert ;` scores 1.75: cost −1, parses fully +2, `;` exactly at a line break +0.75. `replace int with ,` gives `int total = 0, i = 1;`, which is also valid, but it overwrites a keyword (−0.75) and costs 1.5, so it scores −0.25. The margin is 2.00.
⚠ *Do not say “the cheapest edit wins”.* The least-cost baseline is exactly what we beat by 16.3 points.

**Examiner:** Where do those weights come from? Did you tune them on your test data?
**Model:** Hand-set on the development split only (12 programs, 360 cases) and frozen at commit `03331c0` before the test run. The split is by program, so test programs were never seen. We disclose one exception: a 60-case smoke run touched two test families while we debugged the harness, and no weights were changed from it. The audit also checked that later code changes left all 900 results identical.

**Examiner:** (types `int c = a b;`) Fix this.
**Model:** *Multiple plausible*, margin 0.00: all 20 operators score the same. That is the intended behaviour; the text does not say which operator was meant. The alternatives are listed in the Repair lab.

**Examiner:** (types `whlie (i < 3) { i = i + 1; }` inside `main`) And this?
**Model:** It recommends inserting `;`, which makes `whlie(i < 3);` a call to an undeclared function. That is a known confident error, and it is in our limitations. Name warnings are evidence, but not strong enough here. We did not re-tune for it, because re-tuning after seeing an example is tuning on test.
⚠ *Do not defend the output as correct.* Admitting it scores better than arguing.

**Examiner:** What is an AST equivalence class, and why do you need it?
**Model:** Candidates that produce the same canonical syntax tree, for example inserting `)` to give `(a + 2)` or `(a) + 2`. Without grouping, the two would look like competing alternatives with similar scores, and IntelliFix would wrongly abstain. With grouping, the decision is “only one structurally distinct repair”.
*Follow-up:* **Did it help measurably?** → Only a little: coverage 50.7% vs 48.9% at the same wrong-confident rate. We call that weak.

**Examiner:** What happens with two errors?
**Model:** Hypothesis lanes. For each of the top 3 first fixes, we repair the next error, keeping 2 alternatives per step, up to depth 4. The plan is the best complete path. **Do:** sample *Two errors* → Hypothesis explorer.

---

## Round 3 — evaluation and honesty (7 min)

**Examiner:** What is your headline result, and what is its denominator?
**Model:** Top-1 AST match 71.5% of 540 held-out cases, 95% CI 67.5–75.1, against 55.2% for least-cost on the same candidates. With abstention, 6.1% of *all* cases get a wrong recommendation, against 28.5% without abstention, at 50.7% coverage.

**Examiner:** 88% selective accuracy sounds good. What was your target?
**Model:** τ was chosen on dev for at most 10% risk. On test, risk was 12.0%, so the threshold did not fully transfer. We report that.

**Examiner:** Your stability analysis: did it work?
**Model:** No measurable effect: +0.2 points, CI −0.4 to 0.9. We kept it because it explains multi-error behaviour in the UI, but we do not claim an accuracy gain.

**Examiner:** You beat CPCT+ by over 20 points. So you beat the state of the art?
**Model:** No. CPCT+ reports all minimum-cost repairs and breaks ties arbitrarily; it is built for recovery, not for choosing the intended fix. We measured only how often its first repair restores the original program. Its result even varies between runs: 47.4–49.1%.
⚠ *This is the most common overclaim. Do not say “better than CPCT+”.*

**Examiner:** Would this work on real students' code?
**Model:** Unknown. Our errors are synthetic single-token mutations of 30 programs written by one author. Real errors include misunderstood syntax and many interacting errors. A real-error study is the first piece of future work.

---

## Round 4 — curveballs (3 min)

| Examiner | Model answer |
|---|---|
| “Paste 5,000 nested `{`.” | *Unsupported construct*: parser capacity limit, reported in milliseconds without searching. (That case was a bug until our robustness suite caught it.) |
| “Paste a C program with `#include` and `printf("hi")`.” | *Unsupported construct*: preprocessor lines and strings are recognised C features that MiniC omits. |
| “The site says *Compiler not built*. Is your project broken?” | The UI is honest. The native binary has not been built on this machine, so every request returns 503 and nothing is faked. Building it needs a C++ compiler (Installation guide §3). |
| “Is the margin a confidence percentage?” | No: a score difference. No calibration is claimed. |
| “Why not use an LLM?” | Explainability, determinism and evaluability were goals. An LLM could be a candidate generator in future work, but every suggestion would still be parser-validated and ranked. |
| “What did *you* personally build?” | Answer truthfully with what you can explain in depth. Do not claim modules you cannot defend. |

## Scoring yourself

For each answer: **2** = correct, with the number and its denominator; **1** = correct but vague; **0** = wrong or overclaiming. Aim for 36 or more out of 42 across the 21 examiner prompts (rounds 1–4) before the real viva.
