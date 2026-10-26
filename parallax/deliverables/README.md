# IntelliFix deliverables

All files are editable and are generated from repository data, so they can be rebuilt after a change.

| File | What it is |
|---|---|
| **`IntelliFix_Final_Presentation.pptx`** | **final** 15-slide deck (final features, real screenshots, native charts, speaker notes with technical details, transitions and likely questions) |
| **`IntelliFix_Final_Presentation_Script.docx`** | **final** spoken script per slide: what to say, technical details, demo action, transition, likely questions |
| `IntelliFix_Presentation.pptx` | 15-slide deck with speaker notes, native charts and real screenshots |
| `IntelliFix_Presenter_Script.docx` | spoken text per slide (same source as the speaker notes), timing, demo checklist |
| `IntelliFix_Project_Report.docx` | course project report: chapters 1–8, References, Appendix A; TOC, List of Figures and List of Tables as Word fields |
| `IntelliFix_IEEE_Conference_Paper.docx` | IEEE-style two-column conference paper draft |
| `IntelliFix_Report_Compliance_Checklist.md` | which formatting rules are met, which were assumed (the official template was not available), which placeholders the team must fill in |

**Open in Word:** when asked “update the fields that may refer to other files?”, answer **Yes** (or press Ctrl+A, then F9) to fill in the TOC, List of Figures and List of Tables.

**Placeholders** in square brackets (guide, Head of Department, department, university, dates, course title, e-mail addresses) must be completed by the team. Nothing about them was guessed.

## Rebuild

From `parallax/`, with the compiler built (`compiler/build/parallaxc`) and the evaluation results present:

```bash
cd deliverables/build && npm install && cd ../..
node deliverables/build/take_screenshots.cjs     # optional: needs the backend on :8000 (and a compiler-less one on :8001)
node deliverables/build/make_figures.cjs         # charts and diagrams from evaluation/results/summary.json
node deliverables/build/build_final_presentation.js  # → IntelliFix_Final_Presentation.pptx
node deliverables/build/build_final_script.js        # → IntelliFix_Final_Presentation_Script.docx
node deliverables/build/build_presentation.js    # → IntelliFix_Presentation.pptx (earlier version)
node deliverables/build/build_documents.js       # → the three .docx files
```

The builders stop with an error if the text they contain no longer matches the data (for example, if a re-run changed a headline number). `test_counts.json` and `measured_ranges.json` record values that come from runs rather than from stored files; their `_source` fields say which.

## Interface v2 (25 Oct 2026)

`IntelliFix_Final_Presentation.pptx` and `IntelliFix_Final_Presentation_Script.docx` were rebuilt for the simplified interface (Workspace, AST Explorer, Research & Method):

- screenshots `docs/images/walkthrough/v2-el-*.png`
- demo steps and the demo checklist
- test counts from `build/test_counts_final.json` (496 tests)

The earlier deliverables (first presentation, report, paper) are unchanged. Where they name pages of the earlier ten-page interface, see `docs/IntelliFix_UX_v2.md` §4 for the mapping.

## Implementation-focused deck (26 Oct 2026)

`IntelliFix_Final_Presentation.pptx` (15 slides) and its presenter script were regenerated with a different focus:

- **the implementation and the five-step Workspace:** architecture, text → tokens → tree, diagnosis, fixes, one error at a time, asking instead of guessing, safe repairs, tree, honest completion;
- **one brief, conceptual research slide.**

How to rebuild or reuse:

- **Builder:** `build/build_implementation_presentation.js`. Its content, with speaker notes, is in `build/implementation_slides_content.js`.
- **Screenshots:** `docs/images/walkthrough/v3-*.png`, taken by `build/take_screenshots_v3.cjs` from a real run.
- **Earlier deck:** the previous research-heavy version is kept as `IntelliFix_Final_Presentation_previous.pptx`. Its builder, `build/build_final_presentation.js`, still exists, but running it would overwrite `IntelliFix_Final_Presentation.pptx`.
