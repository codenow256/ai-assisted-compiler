// Builds deliverables/IntelliFix_Final_Presentation_Script.docx from final_slides_content.js
// (the same text as the deck's speaker notes). Usage (from parallax/):
//   node deliverables/build/build_final_script.js
"use strict";
const path = require("path");
const { d, FONT, pt, runs, makeRenderer, numberingConfig, write } = require("./docx_lib");
const { SLIDES, TEAM } = require("./final_slides_content");

const OUT = path.join(__dirname, "..", "IntelliFix_Final_Presentation_Script.docx");
const W = 11906 - 2 * 1300;

async function main() {
  const opt = { contentWidthDxa: W, line: 276, tableSize: 10.5, numberRefs: [], after: 100 };
  const R = makeRenderer(opt);
  const center = (t, size, extra = {}) => new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { after: 120, line: 276, lineRule: d.LineRuleType.AUTO }, children: runs(t, { size: pt(size), ...extra }) });
  const label = (k, v) => new d.Paragraph({ spacing: { after: 80, line: 276, lineRule: d.LineRuleType.AUTO }, children: [new d.TextRun({ text: k + " ", bold: true }), ...runs(v)] });
  const total = SLIDES.reduce((a, s) => a + s.minutes, 0);
  const blocks = [
    { raw: center("IntelliFix — Final Presentation Script", 22, { bold: true }) },
    { raw: center("An Intelligent Compiler for Syntax Error Analysis, Detection, and Correction", 13, { italics: true }) },
    { raw: center(TEAM.map((t) => `${t.name} (${t.reg})`).join("  ·  "), 11) },
    "This script goes with **IntelliFix_Final_Presentation.pptx**; its spoken text is the same as the slides' speaker notes (both are generated from `deliverables/build/final_slides_content.js`). Speaking parts are a suggested split by section; they do **not** say who implemented what (see `docs/IntelliFix_Team_Presentation_Plan.md` §4).",
    { table: { caption: "Running order", widths: [0.07, 0.43, 0.35, 0.15], align: [null, null, null, "r"], head: ["#", "Slide", "Speaker", "Minutes"],
      rows: [...SLIDES.map((s) => [String(s.n), s.title, s.speaker, String(s.minutes)]), ["", "**Total (with a 6-minute demo)**", "", `**${total}**`]] } },
    { h1: "Before you start", newPage: false },
    { bullets: [
      "Start the backend; the sidebar badge must say **Compiler 1.0.0**. If it says “Compiler missing”, the native compiler is not built on this laptop: do not present screenshots as live output.",
      "Open the Workspace (first item in the sidebar), press Clear, zoom the browser to 125–150% for the projector.",
      "Have this script printed or on a second screen; the deck in presenter view.",
    ] },
  ];
  for (const s of SLIDES) {
    blocks.push({ h2: `Slide ${s.n} — ${s.title}` });
    blocks.push({ raw: label("Speaker:", `${s.speaker}  ·  about ${s.minutes} min`) });
    blocks.push({ raw: label("Say:", s.say) });
    blocks.push({ raw: label("Technical details for the professor:", s.tech) });
    if (s.demo && s.demo !== "—") blocks.push({ raw: label("Live-demo action:", s.demo) });
    blocks.push({ raw: label("Transition:", s.next) });
    if (s.questions.length) {
      blocks.push({ raw: new d.Paragraph({ spacing: { before: 60, after: 40 }, children: [new d.TextRun({ text: "Likely questions", bold: true })] }) });
      blocks.push({ bullets: s.questions.map(([q, a]) => `**${q}** ${a}`) });
    }
  }
  blocks.push({ h1: "Live demo checklist (slide 14)", newPage: false });
  blocks.push({ table: { caption: "Demo steps with the expected screen (observed on the final build, τ = 1.5)", widths: [0.38, 0.62], head: ["Do", "Expect"], rows: [
    ["Sample Missing semicolon → Analyze", "Step 2 Diagnosis: Missing delimiter; the parser stopped at line 4 (int); line 3 is probably missing its ;. Compare fixes → Recommended: insert ; at 3:16, score gap 2.00 → Use this fix → Apply & verify → Apply: “Verified”"],
    ["Load sample “Missing expression after +” → Analyze → step 3 Fixes", "“Is the + extra, or is something missing after it?”: delete +, replace + with ;, fill in (suggests price), or write the line yourself"],
    ["Fill in price → Check with the parser → Use this answer → (step 4) → Apply & verify → Apply", "“Valid MiniC”; step 4 shows the Error node replaced by DeclStmt; step 5 “Verified”, 1 report disappeared; Undo repair restores the original"],
    ["AST Explorer → click a node, or click in the code", "meaning, role in the parent, tokens it absorbs, grammar rule, expression diagram; search marks matching nodes"],
    ["Sample Ambiguous operator → Analyze → AST Explorer → Before & after", "Option 1 (+) vs option 2 (−): 1 structural change, the Binary operator"],
    ["Code with an error → Show a hint ×3 → I'll try it → fix → Check my fix", "“Your fix works: the program now parses.”"],
    ["Research & Method", "71.5% vs 55.2%; 28.5% → 6.1% wrong-but-confident at 50.7% coverage; limitations"],
  ] } });
  blocks.push({ h1: "Rules for answering", newPage: false });
  blocks.push({ bullets: [
    "Give every number with its denominator: “71.5% of 540 synthetic test cases”.",
    "Do not say “better than CPCT+”, “always correct”, “novel algorithm”, “works on student code”, “AI-generated explanations” or “works on Windows”.",
    "Usability and learning benefits are **not measured**; the 153/256 figure is a simulation with an idealised user.",
    "If the screen differs from this script, describe the screen. If you don't know: “we don't know; here is how we would find out”.",
  ] });
  const children = R.render(blocks);
  const doc = new d.Document({
    creator: TEAM.map((t) => t.name).join(", "), title: "IntelliFix — Final Presentation Script",
    styles: {
      default: { document: { run: { font: FONT, size: pt(11) }, paragraph: { spacing: { line: 276, lineRule: d.LineRuleType.AUTO } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: pt(15), bold: true }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: pt(13), bold: true, color: "1F3864" }, paragraph: { spacing: { before: 280, after: 80 }, keepNext: true, outlineLevel: 1 } },
        { id: "Caption", name: "Caption", basedOn: "Normal", next: "Normal", run: { font: FONT, size: pt(10) }, paragraph: { spacing: { before: 60, after: 120 } } },
      ],
    },
    numbering: numberingConfig(opt.numberRefs),
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1200, bottom: 1200, left: 1300, right: 1300 } } },
      footers: { default: new d.Footer({ children: [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ children: [d.PageNumber.CURRENT], size: pt(10) })] })] }) }, children }],
  });
  await write(doc, OUT);
}
main().catch((e) => { console.error(e); process.exit(1); });
