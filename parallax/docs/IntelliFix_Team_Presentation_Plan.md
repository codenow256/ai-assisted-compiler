# IntelliFix — team presentation plan

> **Interface note (v2, 25 Oct 2026):** page names in this document (Code workbench, Repair laboratory, Guided demo, …) refer to the earlier ten-page interface. The app now has three destinations — Workspace, AST Explorer, Research & Method; [`IntelliFix_UX_v2.md`](IntelliFix_UX_v2.md) §4 says where each earlier page now lives.


| Member | Registration no. |
|---|---|
| Goutam Jayasingh | 24BCE2417 |
| S Charumeena | 24BCI0238 |
| Raguraman Govindasamy | 24BDS0409 |

> **Important.** The split below assigns **speaking parts** so that each member presents a coherent third of the talk. It does **not** say who implemented which part. No individual contributions were confirmed when this plan was written. Before the presentation, the team should fill in §4 with the contributions each member actually made and can defend, and swap sections if that fits better. Each speaker must be able to answer questions on their own slides.

## 1. Speaking parts (about 15 minutes of slides plus a 6–8 minute demo)

| Part | Speaker | Slides | Minutes | Content |
|---|---|---|---|---|
| 1 Problem and approach | Goutam Jayasingh (24BCE2417) | 1–4 | 4 | title and team; detection vs mistake; why existing approaches fall short; the pipeline |
| 2 How it works | S Charumeena (24BCI0238) | 5–9 | 5½ | MiniC, Flex and Bison, LAC; candidates and validation; evidence ranking; grouping and lanes; abstention |
| 3 Demo | the member at the keyboard; the other two narrate per IntelliFix_Demo_Script.md | 10 | 6–8 | live run of the samples |
| 4 Evidence and honesty | Raguraman Govindasamy (24BDS0409) | 11–15 | 5½ | evaluation design; results; what did not work; contribution and limits; questions |

**Demo roles** (suggested, swap freely): one *driver* at the keyboard, one *narrator* reading the Say column of the demo script, one *checker* who watches the screen against the Expect column and says so if they differ.

## 2. Hand-overs (say these exactly, so transitions are smooth)

- **1 → 2:** “That is the problem and the plan. Charumeena will show how each stage works.”
- **2 → demo:** “Now let us run it live, on the real compiler.”
- **demo → 3:** “That was individual examples. Raguraman will show how we measured it on 540 cases.”
- **End:** “Thank you. We are happy to take questions, and you are welcome to type your own code into the workbench.”

## 3. Question routing

| Topic | First answer | Back-up |
|---|---|---|
| motivation, related work, CPCT+ | Part 1 speaker | Part 3 speaker |
| lexer, grammar, LR states, repair, evidence, statuses | Part 2 speaker | Part 1 speaker |
| benchmark, metrics, intervals, limitations, novelty | Part 3 speaker | Part 2 speaker |
| “Type this input” | demo driver | Live Evaluation Guide §5 |
| “Who built what?” | each member, from §4 | — |

Rule: if one member is answering, the others do not interrupt unless asked. If nobody knows: “We don't know; here is how we would find out.”

## 4. Confirmed contributions (to be completed by the team)

| Member | Contributions (confirmed by the team) | Evidence (commits, files, notes) |
|---|---|---|
| Goutam Jayasingh | *[to be filled in by the team]* | *[ ]* |
| S Charumeena | *[to be filled in by the team]* | *[ ]* |
| Raguraman Govindasamy | *[to be filled in by the team]* | *[ ]* |

## 5. Rehearsal plan

| Session | Goal |
|---|---|
| 1 | each speaker reads their slides with the presenter script; time each part |
| 2 | full run with the live demo; fix the transitions |
| 3 | mock viva (IntelliFix_Mock_Viva.md): the other two act as examiners |
| 4 | random-input drill: one member types unseen code, and the driver handles it with the decision tree |
| Day before | build check on the presentation laptop (Live Evaluation Guide §1); copy the deck and docs to a USB drive |
