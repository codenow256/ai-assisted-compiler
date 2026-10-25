# IntelliFix — presentation and live-demo guide

Deck: `deliverables/IntelliFix_Presentation.pptx` (15 slides, with speaker notes in each slide). Full spoken text: `deliverables/IntelliFix_Presenter_Script.docx`. Who presents what: [IntelliFix_Team_Presentation_Plan.md](IntelliFix_Team_Presentation_Plan.md).

**Timing:** about 15 minutes of slides plus a 5–8 minute live demo, then questions. Rehearse with a timer.

## 1. Slide-to-website map

For each slide: its single message, and what to open in the running app if an examiner asks to see it live. Screenshot numbers refer to `docs/images/walkthrough/`.

| # | Slide | One message | Open in the app | Screenshot |
|---|---|---|---|---|
| 1 | Title | IntelliFix: detect, analyse and correct syntax errors, honestly | Overview | 01 |
| 2 | The problem | Compilers report where they *detect* an error, not where it was *made* | Workbench → *Missing semicolon* → Run parser (error at 4:3; mistake on line 3) | 04 |
| 3 | Existing approaches | Panic mode cascades; least-cost guesses; CPCT+ lists all minimum-cost fixes but picks arbitrarily | Evaluation → *Diagnostics-only baselines* (3.85 diagnostics per case) | 11b |
| 4 | The IntelliFix pipeline | Lex → Parse → Localise → Generate & validate → Rank & group → Lanes → Decide | Overview → *The processing pipeline* | 01 |
| 5 | MiniC and the front end | A real Flex lexer and Bison LALR(1) parser: 97 rules, 168 states, exact expected tokens (LAC) | Lexical analysis; Grammar & parsing (state 47) | 06, 07 |
| 6 | Candidates and validation | Bounded edits near the error, each checked by the real parser and a source round trip | Repair laboratory → Rejected tab; counts 60 / 3 / 57 | 09 |
| 7 | Evidence ranking | 13 named features, weights frozen on dev; the winner scores 1.75 against −0.25 | Repair laboratory → Evidence breakdown | 09b |
| 8 | Grouping and lanes | Equivalent fixes form one AST class; lanes repair later errors under each first fix | Hypothesis explorer (*Two errors* sample) | 10, 15 |
| 9 | Confidence-aware abstention | Seven statuses; recommend only if the margin is at least τ = 1.5 | *Ambiguous operator*, *Missing variable name*, *Unsupported C construct* | 12, 13, 14 |
| 10 | Live demo | (switch to the browser) | follow IntelliFix_Demo_Script.md | 05 |
| 11 | Evaluation design | 900 synthetic cases, split by program; 8 systems + CPCT+; intervals | Evaluation → Provenance | 11 |
| 12 | Results | 71.5% vs 55.2%; wrong-but-confident 6.1% vs 28.5% | Evaluation → headline cards and charts | 11, 11b |
| 13 | What did not work, and limits | Stability +0.2 (no effect); risk 12% > 10%; synthetic data; `whlie` example | Evaluation → *caveat* rows; Workbench with the `whlie` input | — |
| 14 | Contribution | An integrated, inspectable, honestly evaluated pipeline; no single technique claimed as new | Documentation → Research positioning | — |
| 15 | Questions | — | Workbench, cleared, ready for the examiner's input | 02 |

## 2. Switching between slides and the app

- Keep the browser in a second window, already on the **Code workbench**, with the compiler badge green. Switch with Alt+Tab (Windows) or Cmd+Tab (macOS). Do not open new tabs during the talk.
- Before slide 10, press **Clear**, so the examiner sees an empty run state. Then load samples from the dropdown, not by typing.
- After the demo, come back to slide 11. If time is short, skip from 10 to 12.
- Zoom the browser to 125–150% for a projector (Ctrl/Cmd and +). The layout adapts.

## 3. If the examiner interrupts with “show me”

| They ask | Show |
|---|---|
| “Is this real or a mock-up?” | Overview → “Every result below comes from the compiler; nothing is simulated”. Then stop the backend and show “Backend not reachable”. |
| “Show me the grammar” | Grammar & parsing → *Grammar* tab, or `compiler/grammar/minic.y` |
| “Show me the score calculation” | Repair laboratory → Evidence breakdown, then Compare two candidates |
| “What about this input?” (types code) | Workbench → Full analysis; if it is surprising, use the decision tree in the Live Evaluation Guide §5 |
| “Where are the numbers from?” | Evaluation → **summary.json** download; `evaluation/results/report.md` |

## 4. Rules for every speaker

1. Read numbers with their denominators: “71.5% of 540 synthetic test cases”.
2. Never say *better than CPCT+*, *always*, *novel algorithm* or *student code*.
3. If the app shows something unexpected, describe what it shows. Never what the slide says it should show.
4. If you don't know, say “I don't know; here is how we would find out” and point to the file or test.
