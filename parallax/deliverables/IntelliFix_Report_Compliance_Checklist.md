# IntelliFix project report — template compliance checklist

**The official template `BCSE307P - Course Project Report - Template1.docx` was not available in this environment.** The report `IntelliFix_Project_Report.docx` therefore follows the formatting rules stated in the request. Every rule that the template itself would settle is marked **Assumed**: check it against the template, or send the template so the report can be rebuilt from it (`node deliverables/build/build_documents.js`).

Status key: **Done**: implemented as requested and checked in the rendered file. **Assumed**: a reasonable choice that the template may override. **Team**: information only the team or the institution can supply.

## Formatting rules from the request

| # | Rule | Status | How it was met / what to check |
|---|---|---|---|
| 1 | Font Times New Roman throughout | Done | document default and every style; code samples use Courier New (monospace is needed for code) |
| 2 | Title 18 pt, bold, uppercase, 1.5 line spacing | Done | “Title” style on the title page |
| 3 | “ABSTRACT” heading 16 pt, bold, uppercase, 1.5 line spacing | Done | — |
| 4 | Abstract body 12 pt, 1.15 spacing, 300–500 words, one page | Done | the build fails outside 300–500 words; current count is printed by the build (see §3); fits one page in the render |
| 5 | Body text 12 pt, 1.15 spacing | Done | justified |
| 6 | Figure captions below figures | Done | `Figure n.` with a SEQ field |
| 7 | Table captions above tables | Done | `Table n.` with a SEQ field, kept with the table |
| 8 | Captions 10 pt | Done | “Caption” style |
| 9 | Chapter headings uppercase | Done | Heading 1, all caps, 16 pt bold (the size is **Assumed**) |
| 10 | Chapters 1–8, References, Appendix A | Done | 1 Introduction · 2 Literature survey · 3 Requirements and analysis · 4 Design · 5 Implementation · 6 Testing · 7 Results and discussion · 8 Conclusion and future work |
| 11 | Table of Contents, List of Figures, List of Tables as Word fields | Done | real `TOC` fields (`\c "Figure"`, `\c "Table"`). Word asks to update fields on opening: answer **Yes**, or press Ctrl+A then F9. The lists are empty until then; LibreOffice previews also show them empty |
| 12 | Team names and registration numbers exact, sorted by registration number | Done | 24BCE2417 Goutam Jayasingh · 24BCI0238 S Charumeena · 24BDS0409 Raguraman Govindasamy |
| 13 | No invented guide or HoD names, designations, signatures or affiliations | Done | labelled placeholders in square brackets |
| 14 | Editable | Done | plain .docx with styles, fields, real tables, PNG figures |

## Template details that could not be verified (all **Assumed**)

| Item | Choice made | Check against the template |
|---|---|---|
| Page size and margins | A4, 1 inch (2.54 cm) on every side | binding margin? |
| Heading sizes | H1 16 pt, H2 14 pt, H3 12 pt, all bold | sizes, numbering style (“1.” or “CHAPTER 1”) |
| Front-matter order | title page → bonafide certificate → acknowledgement → abstract → TOC → list of figures → list of tables | a declaration page, or a different order? |
| Certificate wording | placeholder paragraph | replace with the template's exact wording |
| Page numbers | roman numerals (i, ii, …) in the front matter; Arabic from Chapter 1; centred footer | position and format |
| Chapter start | each chapter on a new page | — |
| Table body text | 11 pt | the template may require 12 pt |
| Reference style | IEEE, numbered in order of first citation | the template may require another style |
| Course title | `[course title as given in the official template]` | fill in |

## Information the team must supply (**Team**)

| Placeholder in the report | Where |
|---|---|
| `[Guide's name]`, `[Guide's designation]` | title page, certificate, acknowledgement |
| `[Head of Department's name]`, `[Designation]` | certificate |
| `[School / Department name]`, `[University name and location…]` | title page |
| `[Month and year of submission]`, `[date]`, `[place]` | title page, certificate |
| Signatures | certificate (sign the printed copy) |
| Acknowledgement text | write it in your own words |

In the IEEE paper, `[Department]`, `[University, City, Country]` and `[e-mail address]` are placeholders for each author.

## Content integrity

- Every number in the report and the paper is read from `evaluation/results/summary.json`, `evaluation/results/professor_results.json`, `deliverables/build/test_counts.json` or a live compiler run when the document is built. The build stops if the text no longer matches the data.
- The CPCT+ range (47.4–49.1%) spans three runs; see `docs/IntelliFix_Evaluation_and_Reproducibility.md` §4 and `deliverables/build/measured_ranges.json`.
- All screenshots come from the running application (`docs/images/walkthrough/`); all charts are drawn from the stored results (`deliverables/build/make_figures.cjs`).
- References were checked against publisher or official pages (see `docs/RESEARCH_POSITIONING.md`). Background textbook items [1], [12] and [14] are standard and were not re-verified; check page numbers and editions against your library copy.
- No guarantee about plagiarism-checker similarity scores can be given. The text is original to this project, but it quotes standard terminology and reference titles.
