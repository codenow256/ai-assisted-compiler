// Builds the three Word deliverables in deliverables/:
//   IntelliFix_Presenter_Script.docx, IntelliFix_Project_Report.docx, IntelliFix_IEEE_Conference_Paper.docx
// Usage (from parallax/): node deliverables/build/make_figures.cjs && node deliverables/build/build_documents.js
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const sharp = require("sharp");
const { d, FONT, pt, runs, makeRenderer, numberingConfig, write } = require("./docx_lib");
const { TEAM, SLIDES } = require("./slides_content");

const ROOT = path.resolve(__dirname, "../..");
const OUTDIR = path.join(ROOT, "deliverables");
const FIG = path.join(__dirname, "figures");
const SHOTS = path.join(ROOT, "docs/images/walkthrough");

// ------------------------------------------------------------------ data
const S = JSON.parse(fs.readFileSync(path.join(ROOT, "evaluation/results/summary.json"), "utf8"));
const T = S.test;
const PROF = JSON.parse(fs.readFileSync(path.join(ROOT, "evaluation/results/professor_results.json"), "utf8")).totals;
const TESTS = JSON.parse(fs.readFileSync(path.join(__dirname, "test_counts.json"), "utf8"));
const RANGES = JSON.parse(fs.readFileSync(path.join(__dirname, "measured_ranges.json"), "utf8"));
const pct = (x) => (100 * x.rate).toFixed(1);
const ci = (x) => `[${(100 * x.ci95[0]).toFixed(1)}, ${(100 * x.ci95[1]).toFixed(1)}]`;
const pts = (v) => (100 * v).toFixed(1);
const cpRange = `${RANGES.cpct_top1_test_min}–${RANGES.cpct_top1_test_max}%`;

const exe = ["parallaxc", "parallaxc.exe"].map((n) => path.join(ROOT, "compiler/build", n)).find(fs.existsSync);
if (!exe) throw new Error("build the compiler first: numbers are taken from a live run");
const RUN = JSON.parse(execFileSync(exe, ["repair", "--tau", String(S.tau_selection.tau)], { input: fs.readFileSync(path.join(ROOT, "examples/02_missing_semicolon.mc")) }).toString());
const valid = RUN.repair.candidates.filter((c) => c.valid).slice(0, 3);
const fmt = (v) => (v === 0 ? "0" : (v > 0 ? "+" : "−") + Math.abs(v).toFixed(2));
const feats = ["edit_cost", "resolves_all_errors", "deleted_content", "line_end_semicolon", "name_warnings"];
const contrib = (c, f) => (c.evidence.find((e) => e.name === f) || { contribution: 0 }).contribution;
const run = {
  state: RUN.parse.diagnostics[0].parser_state,
  expected: RUN.parse.diagnostics[0].expected.length,
  generated: RUN.repair.counts.generated,
  accepted: RUN.repair.counts.accepted,
  cands: valid.map((c) => ({ name: c.summary.replace(/ at \d+:\d+/, "") })),
  evidenceRows: [
    ...feats.map((f) => [f, ...valid.map((c) => fmt(contrib(c, f)))]),
    ["other 8 features", ...valid.map(() => "0")],
    ["**score**", ...valid.map((c) => `**${fmt(c.score)}**`)],
  ],
  excerpt: JSON.stringify({
    parse: { ok: RUN.parse.ok, first_error: { message: RUN.parse.diagnostics[0].message, at: `${RUN.parse.diagnostics[0].start.line}:${RUN.parse.diagnostics[0].start.column}`, parser_state: RUN.parse.diagnostics[0].parser_state } },
    repair: { counts: { generated: RUN.repair.counts.generated, accepted: RUN.repair.counts.accepted, classes: RUN.repair.counts.classes },
      decision: { status: RUN.repair.decision.status, margin: RUN.repair.decision.margin, reasons: RUN.repair.decision.reasons, plan: RUN.repair.decision.plans[0].summary } },
  }, null, 2),
};
for (const [a, b] of [[run.generated, 60], [run.accepted, 3], [run.state, 47], [pct(T.P.top1_ast), "71.5"]]) if (String(a) !== String(b)) throw new Error(`report text assumes ${b}, data says ${a}`);

const sysName = { P: "IntelliFix (P)", F: "No abstention (F)", E: "No stability (E)", D: "No grouping (D)", L: "No layout (L)", C: "Least-cost (C)" };
const mainRows = ["P", "F", "E", "D", "L", "C"].map((k) => [sysName[k], `${pct(T[k].top1_ast)}%`, `${pct(T[k].top3_ast)}%`, `${pct(T[k].coverage)}%`, `${pct(T[k].selective_accuracy)}%`, `${pct(T[k].false_confident_rate)}%`]);
if (S.cpctplus && S.cpctplus.test) mainRows.push(["CPCT+ (G), runs 1 / 2", S.cpctplus.test.map((r) => (100 * r.top1_ast.rate).toFixed(1)).join(" / ") + "%", S.cpctplus.test.map((r) => (100 * r.top3_ast.rate).toFixed(1)).join(" / ") + "%", "100%", "= top-1", "≈ 1 − top-1"]);
mainRows[0] = mainRows[0].map((c, i) => (i === 1 ? `**${c}** ${ci(T.P.top1_ast)}` : i === 0 ? `**${c}**` : c));
const paperRows = ["P", "F", "L", "C"].map((k) => [sysName[k], `${pct(T[k].top1_ast)}%`, `${pct(T[k].coverage)}%`, `${pct(T[k].selective_accuracy)}%`, `${pct(T[k].false_confident_rate)}%`]);
if (S.cpctplus && S.cpctplus.test) paperRows.push(["CPCT+ (G, run 1)", `${(100 * S.cpctplus.test[0].top1_ast.rate).toFixed(1)}%`, "100%", "= top-1", "≈ 1 − top-1"]);

const fig = (n) => path.join(FIG, n + ".png");
const cropCache = {};
async function prepareShots(list) {
  for (const [name, crop] of list) {
    const out = path.join(FIG, `shot_${name}${crop ? "_c" : ""}.png`);
    let img = sharp(path.join(SHOTS, name + ".png"));
    if (crop) img = img.extract({ left: crop[0], top: crop[1], width: crop[2] - crop[0], height: crop[3] - crop[1] });
    await img.resize({ width: 1600, withoutEnlargement: true }).png().toFile(out);
    cropCache[name + (crop ? "_c" : "")] = out;
  }
}
const shot = (name, crop) => cropCache[name + (crop ? "_c" : "")];
const DATA = { T, S, pct, ci, pts, fig, shot, cpRange, prof: PROF, tests: TESTS, run, mainRows, paperRows };

// ------------------------------------------------------------------ styles
function styles(body, { h1, h2, h3, caption, line, h1Upper }) {
  const heading = (id, name, size, before, after, upper) => ({
    id, name, basedOn: "Normal", next: "Normal", quickFormat: true,
    run: { font: FONT, size: pt(size), bold: true, allCaps: upper || false, color: "000000" },
    paragraph: { spacing: { before, after, line, lineRule: d.LineRuleType.AUTO }, keepNext: true, keepLines: true, outlineLevel: Number(id.slice(-1)) - 1 },
  });
  return {
    default: { document: { run: { font: FONT, size: pt(body) }, paragraph: { spacing: { line, lineRule: d.LineRuleType.AUTO } } } },
    paragraphStyles: [
      heading("Heading1", "Heading 1", h1, 240, 240, h1Upper),
      heading("Heading2", "Heading 2", h2, 200, 120),
      heading("Heading3", "Heading 3", h3, 160, 80),
      { id: "Caption", name: "Caption", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: pt(caption), bold: false, italics: false, color: "000000" }, paragraph: { spacing: { before: 60, after: 200, line: 240, lineRule: d.LineRuleType.AUTO } } },
      { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { font: FONT, size: pt(18), bold: true, allCaps: true }, paragraph: { alignment: d.AlignmentType.CENTER, spacing: { line: 360, lineRule: d.LineRuleType.AUTO } } },
    ],
  };
}
const center = (text, o = {}) => new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { line: o.line ?? 360, before: o.before ?? 0, after: o.after ?? 0, lineRule: d.LineRuleType.AUTO },
  children: runs(text, { size: pt(o.size ?? 12), bold: o.bold, allCaps: o.caps, italics: o.italics }) });
const pageNum = (fmtType) => new d.Footer({ children: [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ children: [d.PageNumber.CURRENT], size: pt(11) })] })] });

// ------------------------------------------------------------------ 1. presenter script
async function presenterScript() {
  const W = 11906 - 2 * 1300;
  const opt = { contentWidthDxa: W, line: 276, tableSize: 10.5, numberRefs: [], after: 120 };
  const R = makeRenderer(opt);
  const blocks = [
    { raw: center("IntelliFix — Presenter Script", { size: 22, bold: true, after: 120 }) },
    { raw: center("An Intelligent Compiler for Syntax Error Analysis, Detection, and Correction", { size: 13, italics: true, after: 120 }) },
    { raw: center(TEAM.map((t) => `${t.name} (${t.reg})`).join("  ·  "), { size: 11, after: 240 }) },
    "This script matches the speaker notes in **IntelliFix_Presentation.pptx** slide for slide; both are generated from one source (`deliverables/build/slides_content.js`). Speaking parts are a suggested split by section and do **not** state who implemented what; see `docs/IntelliFix_Team_Presentation_Plan.md` §4.",
    { table: { caption: "Running order and timing", widths: [0.07, 0.43, 0.32, 0.18], align: [null, null, null, "r"], head: ["#", "Slide", "Speaker", "Minutes"],
      rows: [...SLIDES.map((s) => [String(s.n), s.title, s.speaker, String(s.minutes)]), ["", "**Total**", "", `**${SLIDES.reduce((a, s) => a + s.minutes, 0)}**`]] } },
    { h1: "Before you start", newPage: false },
    { bullets: ["Backend running; the sidebar badge says **Compiler 1.0.0** (not “Compiler missing”).", "Browser on the Code workbench, Clear pressed, zoom 125–150% for a projector.",
      "Deck in presenter view; this script printed or on a second screen.", "If the compiler is missing: never present screenshots as live output; explain and build it (Installation guide §3)."] },
  ];
  for (const s of SLIDES) {
    blocks.push({ h2: `Slide ${s.n} — ${s.title}` });
    blocks.push(`**Speaker:** ${s.speaker}   ·   **Time:** about ${s.minutes} min   ·   **In the app:** ${s.app}`);
    blocks.push(s.notes);
  }
  blocks.push({ h1: "Live demo checklist (slide 10)", newPage: false });
  blocks.push({ table: { caption: "Demo steps with the expected screen (observed 25 Oct 2026, τ = 1.5)", widths: [0.32, 0.68], head: ["Do", "Expect"],
    rows: [
      ["Missing semicolon → Run lexer", "38 tokens, 0 lexical errors, 1 comment"], ["Run parser", "rejected: unexpected type-keyword 'int' at 4:3"],
      ["Full analysis", "Recommended; 60 candidates, 3 parser-validated; margin 2.00 ≥ 1.50"], ["Grammar & parsing", "LR state 47; 15 expected tokens"],
      ["Repair laboratory → Evidence", "scores 1.75 / −0.25 / −4.00"], ["Accept repair → Full analysis", "No repair needed"],
      ["Ambiguous operator", "Multiple plausible; margin 0.00"], ["Missing variable name", "Low confidence; placeholder __hole"],
      ["Unsupported C construct", "Unsupported construct; “write x = x + 1”"], ["Two errors → Hypothesis explorer", "Recommended; 2-step plan; margin 3.50"],
      ["Evaluation & impact", "71.5% · 6.1% · 50.7%; caveat rows"],
    ] } });
  blocks.push({ h1: "Answering questions", newPage: false });
  blocks.push({ bullets: ["Give the number with its denominator: “71.5% of 540 synthetic test cases”.", "Never say “better than CPCT+”, “always”, “novel algorithm” or “student code”.",
    "If the screen differs from this script, describe the screen.", "Prepared answers: docs/IntelliFix_Viva_Question_Bank.md and IntelliFix_Mock_Viva.md."] });
  const children = R.render(blocks);
  const doc = new d.Document({
    creator: TEAM.map((t) => t.name).join(", "), title: "IntelliFix — Presenter Script",
    styles: styles(11, { h1: 15, h2: 13, h3: 12, caption: 10, line: 276 }), numbering: numberingConfig(opt.numberRefs),
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1200, bottom: 1200, left: 1300, right: 1300 } } }, footers: { default: pageNum() }, children }],
  });
  await write(doc, path.join(OUTDIR, "IntelliFix_Presenter_Script.docx"));
}

// ------------------------------------------------------------------ 2. project report
async function projectReport() {
  const C = require("./report_content")(DATA);
  const W = 11906 - 2 * 1440;
  const opt = { contentWidthDxa: W, line: 276, tableSize: 11, numberRefs: [], justify: true, chapterPageBreak: true, after: 120, codeSize: 9.5 };
  const R = makeRenderer(opt);
  const PH = (t) => `[${t}]`;
  const sign = (role) => new d.Table({
    width: { size: W, type: d.WidthType.DXA }, columnWidths: [W / 2, W / 2],
    borders: { top: { style: d.BorderStyle.NONE }, bottom: { style: d.BorderStyle.NONE }, left: { style: d.BorderStyle.NONE }, right: { style: d.BorderStyle.NONE }, insideHorizontal: { style: d.BorderStyle.NONE }, insideVertical: { style: d.BorderStyle.NONE } },
    rows: [new d.TableRow({ children: role.map((r) => new d.TableCell({ width: { size: W / 2, type: d.WidthType.DXA }, borders: { top: { style: d.BorderStyle.NONE }, bottom: { style: d.BorderStyle.NONE }, left: { style: d.BorderStyle.NONE }, right: { style: d.BorderStyle.NONE } },
      children: [new d.Paragraph({ spacing: { before: 720 }, children: [new d.TextRun("______________________________")] }), ...r.map((l) => new d.Paragraph({ spacing: { line: 276, lineRule: d.LineRuleType.AUTO }, children: [new d.TextRun(l)] }))] })) })],
  });
  const front = [
    // Title page
    center("A PROJECT REPORT ON", { size: 14, bold: true, before: 600, after: 240 }),
    new d.Paragraph({ style: "Title", spacing: { line: 360, after: 360, lineRule: d.LineRuleType.AUTO }, children: [new d.TextRun("IntelliFix: An Intelligent Compiler for Syntax Error Analysis, Detection, and Correction")] }),
    center("Submitted in partial fulfilment of the requirements of the course", { size: 12, line: 360 }),
    center(`BCSE307P — ${PH("course title as given in the official template")}`, { size: 12, bold: true, after: 360 }),
    center("by", { size: 12, after: 120 }),
    ...TEAM.map((t) => center(`${t.name.toUpperCase()}   (${t.reg})`, { size: 12, bold: true, line: 360 })),
    center("Under the guidance of", { size: 12, before: 360, after: 120 }),
    center(PH("Guide's name"), { size: 12, bold: true }),
    center(PH("Guide's designation"), { size: 12, after: 360 }),
    center(PH("School / Department name"), { size: 12, bold: true }),
    center(PH("University name and location, as in the official template"), { size: 12 }),
    center(PH("Month and year of submission"), { size: 12, after: 0 }),
    new d.Paragraph({ children: [new d.PageBreak()] }),
    // Certificate
    center("BONAFIDE CERTIFICATE", { size: 16, bold: true, after: 360 }),
    R.bodyPara(`This is to certify that the project report entitled **“IntelliFix: An Intelligent Compiler for Syntax Error Analysis, Detection, and Correction”** submitted by ${TEAM.map((t) => `**${t.name} (${t.reg})**`).join(", ")} for the course BCSE307P is a record of work carried out by them under my supervision. ${PH("Replace this paragraph with the certificate wording of the official template.")}`, { spacing: { line: 360, after: 240, lineRule: d.LineRuleType.AUTO } }),
    sign([[PH("Guide's name"), PH("Guide's designation"), "Guide"], [PH("Head of Department's name"), PH("Designation"), "Head of the Department"]]),
    new d.Paragraph({ spacing: { before: 480 }, children: runs(`Date: ${PH("date")}          Place: ${PH("place")}`) }),
    new d.Paragraph({ children: [new d.PageBreak()] }),
    // Acknowledgement
    center("ACKNOWLEDGEMENT", { size: 16, bold: true, after: 360 }),
    R.bodyPara(`We thank our guide, ${PH("Guide's name and designation")}, for guidance throughout this project, and ${PH("names and roles of others the team wishes to thank, e.g. the Head of the Department")}. ${PH("The team should write this section in its own words.")}`),
    new d.Paragraph({ spacing: { before: 480 }, alignment: d.AlignmentType.RIGHT, children: runs(TEAM.map((t) => t.name).join(", ")) }),
    new d.Paragraph({ children: [new d.PageBreak()] }),
    // Abstract (16pt bold uppercase, 1.5; body 12pt, 1.15)
    new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { line: 360, after: 240, lineRule: d.LineRuleType.AUTO }, children: [new d.TextRun({ text: "ABSTRACT", bold: true, allCaps: true, size: pt(16) })] }),
    ...C.abstract.map((p) => R.bodyPara(p, { spacing: { line: 276, after: 120, lineRule: d.LineRuleType.AUTO } })),
    new d.Paragraph({ spacing: { line: 276, before: 120, lineRule: d.LineRuleType.AUTO }, children: runs(`**Keywords:** ${C.keywords}`) }),
    new d.Paragraph({ children: [new d.PageBreak()] }),
    // TOC, LOF, LOT as Word fields
    center("TABLE OF CONTENTS", { size: 16, bold: true, after: 240 }),
    new d.TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" }),
    new d.Paragraph({ children: [new d.PageBreak()] }),
    center("LIST OF FIGURES", { size: 16, bold: true, after: 240 }),
    new d.TableOfContents("List of Figures", { captionLabelIncludingNumbers: "Figure", hyperlink: true }),
    new d.Paragraph({ children: [new d.PageBreak()] }),
    center("LIST OF TABLES", { size: 16, bold: true, after: 240 }),
    new d.TableOfContents("List of Tables", { captionLabelIncludingNumbers: "Table", hyperlink: true }),
  ];
  const abstractWords = C.abstract.join(" ").split(/\s+/).length;
  if (abstractWords < 300 || abstractWords > 500) throw new Error(`abstract has ${abstractWords} words (needs 300–500)`);
  console.log("abstract words:", abstractWords);

  const body = R.render(C.chapters);
  const refs = [
    new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new d.TextRun("REFERENCES")] }),
    ...C.references.map((r, i) => new d.Paragraph({ spacing: { line: 276, after: 100, lineRule: d.LineRuleType.AUTO }, indent: { left: 567, hanging: 567 }, children: [new d.TextRun(`[${i + 1}]\t`), ...runs(r)],
      tabStops: [{ type: d.TabStopType.LEFT, position: 567 }] })),
  ];
  const appx = R.render(C.appendix);
  const doc = new d.Document({
    creator: TEAM.map((t) => t.name).join(", "), title: "IntelliFix: An Intelligent Compiler for Syntax Error Analysis, Detection, and Correction",
    description: "BCSE307P course project report", features: { updateFields: true },
    styles: styles(12, { h1: 16, h2: 14, h3: 12, caption: 10, line: 276, h1Upper: true }), numbering: numberingConfig(opt.numberRefs),
    sections: [
      { properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }, pageNumbers: { start: 1, formatType: d.NumberFormat.LOWER_ROMAN } } },
        footers: { default: pageNum() }, children: front },
      { properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }, pageNumbers: { start: 1, formatType: d.NumberFormat.DECIMAL } } },
        footers: { default: pageNum() }, children: [...body, ...refs, ...appx] },
    ],
  });
  await write(doc, path.join(OUTDIR, "IntelliFix_Project_Report.docx"));
}

// ------------------------------------------------------------------ 3. IEEE paper
async function ieeePaper() {
  const C = require("./paper_content")(DATA);
  const PAGE_W = 12240, M = 1037; // US Letter; 0.72 in side margins
  const COLW = Math.floor((PAGE_W - 2 * M - 360) / 2);
  const opt = { contentWidthDxa: COLW, line: 240, tableSize: 8, numberRefs: [], justify: true, after: 60, codeSize: 8 };
  const R = makeRenderer(opt);
  const top = [
    new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { after: 200, line: 240, lineRule: d.LineRuleType.AUTO }, children: [new d.TextRun({ text: "IntelliFix: An Intelligent Compiler for Syntax Error Analysis, Detection, and Correction", size: pt(24) })] }),
    new d.Table({
      width: { size: PAGE_W - 2 * M, type: d.WidthType.DXA }, columnWidths: TEAM.map(() => Math.floor((PAGE_W - 2 * M) / 3)),
      borders: Object.fromEntries(["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"].map((k) => [k, { style: d.BorderStyle.NONE }])),
      rows: [new d.TableRow({ children: TEAM.map((t) => new d.TableCell({ width: { size: Math.floor((PAGE_W - 2 * M) / 3), type: d.WidthType.DXA },
        borders: { top: { style: d.BorderStyle.NONE }, bottom: { style: d.BorderStyle.NONE }, left: { style: d.BorderStyle.NONE }, right: { style: d.BorderStyle.NONE } },
        children: [t.name, `Reg. No. ${t.reg}`, "[Department]", "[University, City, Country]", "[e-mail address]"].map((l, i) => new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { line: 240, lineRule: d.LineRuleType.AUTO },
          children: [new d.TextRun({ text: l, size: pt(i === 0 ? 11 : 10), italics: i === 2 || i === 3 })] })) })) })],
    }),
    new d.Paragraph({ spacing: { after: 120 }, children: [] }),
  ];
  const absP = new d.Paragraph({ alignment: d.AlignmentType.JUSTIFIED, spacing: { line: 240, after: 80, lineRule: d.LineRuleType.AUTO }, children: [new d.TextRun({ text: "Abstract—", bold: true, italics: true, size: pt(9) }), ...runs(C.abstract, { bold: true, size: pt(9) })] });
  const itP = new d.Paragraph({ alignment: d.AlignmentType.JUSTIFIED, spacing: { line: 240, after: 160, lineRule: d.LineRuleType.AUTO }, children: [new d.TextRun({ text: "Index Terms—", bold: true, italics: true, size: pt(9) }), new d.TextRun({ text: C.indexTerms, bold: true, italics: true, size: pt(9) })] });
  // IEEE: figure/table captions; tables are captioned above ("TABLE I"), figures below ("Fig. 1")
  const body = [];
  let tabN = 0, figN = 0;
  const roman = (n) => ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"][n - 1];
  for (const b of C.body) {
    if (b.table) {
      tabN++;
      const t = R.table({ ...b.table, caption: "x" });
      body.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { before: 120, after: 0, line: 240, lineRule: d.LineRuleType.AUTO }, keepNext: true, children: [new d.TextRun({ text: `TABLE ${roman(tabN)}`, size: pt(8) })] }),
        new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { after: 60, line: 240, lineRule: d.LineRuleType.AUTO }, keepNext: true, children: [new d.TextRun({ text: b.table.caption.toUpperCase(), size: pt(8) })] }), t[1], t[2]);
    } else if (b.fig) {
      figN++;
      const f = R.figure(b);
      body.push(f[0], new d.Paragraph({ alignment: d.AlignmentType.JUSTIFIED, spacing: { after: 120, line: 240, lineRule: d.LineRuleType.AUTO }, children: [new d.TextRun({ text: `Fig. ${figN}. `, size: pt(8) }), new d.TextRun({ text: b.caption, size: pt(8) })] }));
    } else body.push(...R.render([b]));
  }
  const refs = [
    new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, children: [new d.TextRun("References")] }),
    ...C.references.map((r, i) => new d.Paragraph({ alignment: d.AlignmentType.JUSTIFIED, spacing: { line: 240, after: 40, lineRule: d.LineRuleType.AUTO }, indent: { left: 360, hanging: 360 },
      children: [new d.TextRun({ text: `[${i + 1}]\t`, size: pt(8) }), ...runs(r, { size: pt(8) })], tabStops: [{ type: d.TabStopType.LEFT, position: 360 }] })),
  ];
  const ieeeStyles = {
    default: { document: { run: { font: FONT, size: pt(10) }, paragraph: { spacing: { line: 240, lineRule: d.LineRuleType.AUTO } } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: pt(10), smallCaps: true },
        paragraph: { alignment: d.AlignmentType.CENTER, spacing: { before: 160, after: 80 }, keepNext: true, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: pt(10), italics: true },
        paragraph: { spacing: { before: 100, after: 40 }, keepNext: true, outlineLevel: 1 } },
      { id: "Caption", name: "Caption", basedOn: "Normal", run: { font: FONT, size: pt(8) }, paragraph: { alignment: d.AlignmentType.CENTER, spacing: { after: 60 } } },
    ],
  };
  const pg = { size: { width: PAGE_W, height: 15840 }, margin: { top: 1080, bottom: 1440, left: M, right: M } };
  const doc = new d.Document({
    creator: TEAM.map((t) => t.name).join(", "), title: "IntelliFix (IEEE conference paper draft)", styles: ieeeStyles, numbering: numberingConfig(opt.numberRefs),
    sections: [
      { properties: { page: pg }, children: top },
      { properties: { type: d.SectionType.CONTINUOUS, page: pg, column: { count: 2, space: 360, equalWidth: true } }, children: [absP, itP, ...body, ...refs] },
    ],
  });
  await write(doc, path.join(OUTDIR, "IntelliFix_IEEE_Conference_Paper.docx"));
}

(async () => {
  await prepareShots([["05-workbench-full-analysis", null], ["07-grammar-and-parsing", null], ["15b-two-errors-lanes", [380, 260, 2140, 1110]], ["09b-repair-laboratory-evidence", null]]);
  await presenterScript();
  await projectReport();
  await ieeePaper();
})().catch((e) => { console.error(e); process.exit(1); });
