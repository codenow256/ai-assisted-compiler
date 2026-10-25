# IntelliFix interface v2: one connected repair journey

The compiler, grammar, repair engine and research results are unchanged. What changed is how a user meets them. Instead of ten sidebar pages there are **three destinations**, and the six features are connected in one guided flow.

| Destination | What it is for |
|---|---|
| **Workspace** (`/`) | the main journey: write → analyze → diagnosis → fixes → tree → apply & verify |
| **AST Explorer** (`/ast`) | the tree the parser builds, node by node |
| **Research & Method** (`/research`) | the question, the method, the measured result, the trade-off, the ablation, the limitations |

The specialist views still exist. They are opened from where they matter, and a back link leads to the destination they belong to:

- From Workspace › step 2 › *Compiler internals*: the token table, the parser state, every candidate, and the hypothesis lanes.
- From Research & Method: the full evaluation data and the documentation.

## 1. The simplified user flow

A step indicator above the Workspace always shows where you are. Each step is marked done, current, to do, or *not needed* (step 3 for valid code). Each step ends with the most useful next action.

| Step | What the user sees | Real data behind it |
|---|---|---|
| 1 Code | editor, sample menu, one primary **Analyze** button (Ctrl+Enter); a short description of lexer → parser → repair engine | the text in the editor |
| 2 Diagnosis | **input category** and what can be established; plain-language headline; location (click to highlight); expected tokens; a *Lexer → Parser → Meaning* panel; the cascade of error reports with evidence; hints and *Check my fix* | tokens, lexical errors, LAC expected set, diagnostics, rank-1 candidate's residual diagnostics |
| 3 Fixes | recommended fix, or a targeted question when the engine abstains; one card per structurally different repair (line change, parses?, edit cost, score, how it differs, *Why this score*) | `decision.plans`, AST classes, the representative candidate's evidence |
| 4 Tree | how the chosen fix changes the tree: partial tree → complete AST (Error node matched to the new statement), or a node-by-node diff | `/api/repair/compare`, the recovered tree, the repaired program's AST |
| 5 Apply & verify | diff of the change, **Apply to my code**, automatic re-analysis, then which reports *disappeared / remain / are new*; **Undo repair** | a real re-run of the lexer, parser and engine on the new text |

## 2. Features A–F: status

Status is based on the tests in §5 and on the screenshots in [`IntelliFix_Visual_Walkthrough.md`](IntelliFix_Visual_Walkthrough.md).

| Feature | Status | Where | Evidence |
|---|---|---|---|
| **A. Interactive ambiguity resolution** | **verified** | Workspace step 3 | plain-English “what is ambiguous” and a targeted question built from the real plans:<br>• “Is the `+` extra, or is something missing after it?”<br>• “Which operator did you mean between `a` and `b`?”<br>• “What did you mean by `@`?”<br>• “What should the name be?”<br>Options are the real plans, a fill-in (with names declared earlier), or *Something else: write line N yourself*. Every answer is checked by `/api/parse` before **Use this answer** is enabled. *Leave it unresolved* changes nothing. Apply, Undo and re-analysis follow in steps 4–5. Unit tests: `journey.test.ts`, `app.test.tsx`; E2E: two journeys. |
| **B. Explainable repair comparison** | **verified** | Workspace step 3 | one card per plan, showing:<br>• the edit and the changed line (before → after)<br>• whether the real parser accepts it<br>• edit cost and score<br>• how it differs from option 1 (score gap, cost, placeholder, location)<br>• the named evidence contributions<br>The text says the score ranks and is not a probability. |
| **C. Educational AST Explorer** | **verified** | AST Explorer; preview in step 4 | outline with containment guides, category colours and the child's role. Clicking a node highlights its source, and clicking code selects the node. The node card shows:<br>• meaning<br>• parent, children and siblings (clickable)<br>• source and line/column span<br>• **tokens the node absorbs** (`;`, `(`, `)`, operator)<br>• **the grammar rule from `minic.y` that built it**<br>• an **expression diagram** with precedence and associativity notes<br>Also: search, expand/collapse, before & after, raw JSON. Partial trees are labelled and never completed by invention. Tests: `astModel.test.ts` (15), `app.test.tsx`, E2E. |
| **D. Cascade / likely root cause** | **verified** | step 2; step 5 | the first report is labelled reliable. Each later report is labelled *likely a consequence* or *likely independent of the first*, with evidence from the rank-1 candidate's re-parse, always “likely, not proven”. After applying, step 5 shows which reports actually disappeared. |
| **E. Progressive hints and guided repair** | **verified** | step 2 | three staged hints:<br>1. where<br>2. what MiniC expects<br>3. fixes the parser accepted<br>Then *I'll try it in the editor* → *Check my fix*, which runs the real compiler. Feedback covers accepted, progress, not fixed, new earlier error, incomplete, unsupported C, lexical error and empty. No learning benefit is claimed. |
| **F. Research & Method** | **verified** | `/research` | one chart for the key result (71.5% vs 55.2%, paired CI) and one for the trade-off (28.5% → 6.1% wrong-but-confident at 50.7% coverage). Also an ablation table, the clarification *simulation* (153/256, labelled), and limitations. Every number is read from `evaluation/results/*.json` at runtime and checked in `app.test.tsx`. |

## 3. Every input gets a response

The category comes from `classifyInput` / `classifyError` in `frontend/src/lib/journey.ts`. Each has a label, what IntelliFix can establish, and a next action.

| Input | Category shown | What happens |
|---|---|---|
| valid MiniC | Valid MiniC | program summary from the AST; “valid syntax ≠ correct behaviour”; step 3 *not needed*; tree in step 4 |
| `int x = 1` + newline | Missing delimiter | recommended `;` on the previous line, alternatives compared |
| `int total = price + ;`, `int = 42;` | Missing expression or name | question + fill-in; IntelliFix never invents the value |
| `a b`, `1 @ 2` | Ambiguous repair / Invalid characters | question with the operator options |
| two errors | Several syntax errors | cascade roles with evidence; plan fixes both; step 5 shows 3 reports disappeared |
| `@`, `$` | Invalid characters | lexical vs syntax error explained |
| empty / whitespace / comments only | Empty input / Only whitespace / Only comments | “there is no program to analyze” + *Load a sample program* |
| unfinished function or block | Incomplete code | the file ends early; recommended `}` |
| `/* …` without `*/` | Unterminated comment | why the code after it is invisible; no fix that deletes hidden code; *write the line yourself* |
| `i++`, `#include`, … | Unsupported C construct | explains the MiniC rewrite; no automatic repair |
| 6000 nested parentheses | Too deeply nested | parser stack limit (5000), not called a mistake |
| `hello world …` | No safe repair | why no small fix exists; hints; write the line yourself |
| > 64 KB | Input too large | refused by the backend; nothing analyzed |
| compiler missing / failing / timeout | Compiler unavailable or failed | real error, build hint, Retry; code unchanged |
| backend not running | Backend offline | code kept in the browser |

## 4. Old pages → where they are now

| Before | Now |
|---|---|
| Overview | Research & Method §2 (how it works) |
| Code workbench | Workspace |
| Lexical analysis, Grammar & parsing | Workspace › step 2 › Compiler internals (same pages, `/lexer`, `/parser`) |
| Repair laboratory, Hypothesis explorer | Workspace › step 3 cards; full pages under Compiler internals (`/repair`, `/hypotheses`) |
| AST explorer | AST Explorer (rebuilt) |
| Evaluation & impact | Research & Method; full data via *All results* (`/evaluation`) |
| Learning center, Documentation | linked from Research & Method (`/learn`, `/docs`) |
| Guided demo (16-step tour) | removed: the Workspace steps are the guided path |
| “Accept repair” | step 3 *Use this fix* → step 5 *Apply to my code* |

## 5. Tested professor demo (about 6 minutes)

Before starting, check that the sidebar badge says **Compiler 1.0.0**.

1. **Workspace.** Sample menu → *Missing semicolon* → **Analyze**.
   - Step 2 says *Missing delimiter*: “Line 4: the parser did not expect the type keyword `int` here”, line 3 is probably missing its `;`, and the Lexer → Parser panel.
2. **Compare fixes →.** The card says *Recommended*, insert `;` at 3:16, score gap 2.00 ≥ τ 1.5, with the alternatives below. Open *Why this score* on one of them.
3. **Use this fix.** Step 4 shows the *Partial tree → complete tree* change.
   - Then **Apply & verify → Apply to my code**: “Verified”, 1 report disappeared. **Undo repair** restores the original.
4. Sample menu → *Missing expression after +* → **Analyze** → step **Fixes**.
   - The question is “Is the `+` extra, or is something missing after it?”.
   - Choose *Fill in…*, click `price`, then **Check with the parser** (“Valid MiniC”) and **Use this answer**.
   - Step 4 shows the Error node replaced by `DeclStmt int`. Then **Apply & verify → Apply** gives “Verified”.
5. **AST Explorer.** Click the `Binary +` row: the rule `add_expr → add_expr '+' mul_expr`, the tokens it absorbs, the expression diagram and the precedence note.
   - Click a `;` in the code: the `Return` (or declaration) node is selected.
6. Sample *Ambiguous operator* → **Analyze** → **AST Explorer → Before & after**: option 1 (`+`) vs option 2 (`−`) has 1 changed node.
7. Sample *Two errors* (or the 06 sample) → **Analyze**: the 3 reports with their roles. **Compare fixes → Use this fix → Apply & verify → Apply**: “Disappeared (3)”.
8. Type `int main() {\n  int x = 1\n  return x;\n}` → **Analyze** → **Show a hint ×3** → *I'll try it in the editor*.
   - Add the `;` → **Check my fix**: “Your fix works”.
9. **Research & Method**: the two charts, the ablation table and the limitations.

Steps 1–9 are covered by `frontend/tests/e2e/run-e2e.mjs` (15 journeys, all passing on the real compiler).

## 6. Known limitations and unverified behaviour

- The cascade roles use the rank-1 candidate's re-parse. They are labelled *likely*, and a later report can be both independent of the first error and a side effect of a second one.
- Step 5 matches before/after reports by message text, because positions shift after an edit. Identical messages at different places are matched in order.
- The partial → complete tree match in step 4 is line-based. That is exact for single-line repairs, and labelled as a line-based match.
- The read-only source pane in the AST Explorer selects nodes with the mouse. Keyboard users navigate the tree with the arrow keys instead.
- The interface was tested in Chromium (desktop and 390 px width) on Linux only. Other browsers, real Windows and macOS have not been verified.
- Hints, questions and explanations have not been evaluated with users; no learning benefit is claimed.
