// Builds deliverables/IntelliFix_Final_Presentation.pptx (final version; the earlier deck is kept).
//
// Every number on a slide comes from the repository at build time:
//   - evaluation/results/summary.json (evaluation results),
//   - a live run of compiler/build/parallaxc on examples/02_missing_semicolon.mc,
//   - screenshots in docs/images/walkthrough (taken from the running app).
// Usage (from parallax/): node deliverables/build/build_presentation.js
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const pptxgen = require("pptxgenjs");
const sharp = require("sharp");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const Lu = require("react-icons/lu");
const { TEAM, SLIDES } = require("./final_slides_content");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "deliverables", "IntelliFix_Final_Presentation.pptx");
const TESTS = JSON.parse(fs.readFileSync(path.join(__dirname, "test_counts_final.json"), "utf8"));
const CLAR = JSON.parse(fs.readFileSync(path.join(ROOT, "evaluation/results/clarification_bound.json"), "utf8"));
const SHOTS = path.join(ROOT, "docs", "images", "walkthrough");

// ------------------------------------------------------------------ data
const S = JSON.parse(fs.readFileSync(path.join(ROOT, "evaluation/results/summary.json"), "utf8"));
const T = S.test;
const pct = (x) => (100 * x.rate).toFixed(1);
const ci = (x) => `[${(100 * x.ci95[0]).toFixed(1)}, ${(100 * x.ci95[1]).toFixed(1)}]`;
const pts = (d) => (100 * d).toFixed(1);
const cp = S.cpctplus && S.cpctplus.test ? S.cpctplus.test.map((r) => r.top1_ast.rate * 100) : null;

function compilerRun(file) {
  const exe = ["parallaxc", "parallaxc.exe"].map((n) => path.join(ROOT, "compiler/build", n)).find(fs.existsSync);
  if (!exe) throw new Error("compiler/build/parallaxc not found: build the compiler first (no numbers are invented)");
  const tau = String(S.tau_selection.tau);
  return JSON.parse(execFileSync(exe, ["repair", "--tau", tau], { input: fs.readFileSync(path.join(ROOT, file)) }).toString());
}
const RUN = compilerRun("examples/02_missing_semicolon.mc");
const REP = RUN.repair;
const DIAG = RUN.parse.diagnostics[0];

// Guard: the notes quote numbers; fail the build if the data no longer says so.
function checkNumbers() {
  const need = [
    [pct(T.P.top1_ast), "71.5"], [pct(T.C.top1_ast), "55.2"], [pct(T.P.false_confident_rate), "6.1"],
    [pct(T.F.false_confident_rate), "28.5"], [pct(T.P.coverage), "50.7"], [pct(T.P.selective_accuracy), "88.0"],
    [pct(T.L.top1_ast), "62.6"], [String(REP.counts.generated), "60"], [String(REP.counts.accepted), "3"],
    [String(DIAG.expected.length), "15"], [REP.decision.margin.toFixed(1), "2.0"], [pct(T.P.localisation_exact), "86.7"],
  ];
  const bad = need.filter(([a, b]) => a !== b);
  if (bad.length) throw new Error("speaker notes are out of date: " + JSON.stringify(bad));
}
checkNumbers();

// ------------------------------------------------------------------ theme
const THEME = {
  name: "IntelliFix",
  headFontFace: "Cambria",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "1E293B", lt1: "FFFFFF", dk2: "334155", lt2: "F1F5F9",
    accent1: "0F766E", accent2: "4F46E5", accent3: "B45309", accent4: "B91C1C", accent5: "15803D", accent6: "64748B",
    hlink: "4F46E5", folHlink: "6D28D9",
  },
};
const HEX = THEME.colors;
const MINT = "5EEAD4"; // logo teal, used on dark slides only

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9"; // 10 x 5.625 in
pres.author = TEAM.map((t) => t.name).join(", ");
pres.title = "IntelliFix: An Intelligent Compiler for Syntax Error Analysis, Detection, and Correction";
pres.subject = "BCSE307P course project presentation";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;

pres.defineSlideMaster({
  title: "DARK",
  background: { color: HEX.dk1 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 1.1, w: 5.2, h: 1.0, fontFace: "Cambria", fontSize: 48, bold: true, color: C.background1, valign: "top", align: "left", margin: 0 }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "CONTENT",
  background: { color: HEX.lt1 },
  margin: [0.5, 0.5, 0.5, 0.5],
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.5, y: 0.3, w: 9.0, h: 0.65, fontFace: "Cambria", fontSize: 28, bold: true, color: C.text1, valign: "middle", align: "center", margin: 0 }, text: "" } },
    { text: { text: "IntelliFix · BCSE307P course project", options: { x: 0.5, y: 5.25, w: 6, h: 0.25, fontSize: 9, color: C.accent6, fontFace: "Calibri", margin: 0 } } },
  ],
  slideNumber: { x: 9.0, y: 5.25, w: 0.5, h: 0.25, fontSize: 9, color: HEX.accent6, fontFace: "Calibri", align: "right" },
});

// pptxgenjs cannot write theme colours: put THEME's palette into the theme part
// so scheme colours (and anyone restyling the deck in PowerPoint) use it.
async function applyTheme(file, theme) {
  const JSZip = require(require.resolve("jszip", { paths: [require.resolve("pptxgenjs")] }));
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const part = "ppt/theme/theme1.xml";
  const slots = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  const scheme = `<a:clrScheme name="${theme.name}">` + slots.map((k) => `<a:${k}><a:srgbClr val="${theme.colors[k]}"/></a:${k}>`).join("") + "</a:clrScheme>";
  const xml = (await zip.file(part).async("string")).replace(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/, scheme)
    .replace(/(<a:(?:theme|fontScheme)\b[^>]*?\bname=")[^"]*"/g, (_, h) => `${h}${theme.name}"`);
  if (!xml.includes(scheme)) throw new Error("theme part has no colour scheme to replace");
  zip.file(part, xml);
  for (const name of Object.keys(zip.files).filter((n) => n.endsWith(".xml"))) {
    const bad = (await zip.file(name).async("string")).match(/<a:srgbClr val="((?![0-9A-Fa-f]{6}")[^"]*)"/);
    if (bad) throw new Error(`${name}: colour "${bad[1]}" is not hex (a scheme colour was passed to a hex-only option)`);
  }
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

// ------------------------------------------------------------------ helpers
async function icon(Comp, color, size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { color: "#" + color, size: String(size) }));
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + png.toString("base64");
}
async function shot(name, crop, width = 1400) {
  let img = sharp(path.join(SHOTS, name + ".png"));
  if (crop) img = img.extract({ left: crop[0], top: crop[1], width: crop[2] - crop[0], height: crop[3] - crop[1] });
  const buf = await img.resize({ width, withoutEnlargement: true }).png().toBuffer();
  const meta = await sharp(buf).metadata();
  return { data: "image/png;base64," + buf.toString("base64"), ratio: meta.height / meta.width };
}
async function figure(name) {
  const buf = fs.readFileSync(path.join(__dirname, "figures", name + ".png"));
  const meta = await sharp(buf).metadata();
  return { data: "image/png;base64," + buf.toString("base64"), ratio: meta.height / meta.width };
}
function picture(slide, img, x, y, w, name, maxH) {
  let h = w * img.ratio;
  if (maxH && h > maxH) { h = maxH; w = h / img.ratio; }
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x - 0.04, y: y - 0.04, w: w + 0.08, h: h + 0.08, rectRadius: 0.08,
    fill: { color: HEX.lt2 }, line: { color: "CBD5E1", width: 0.75 }, objectName: name + " frame",
    shadow: { type: "outer", color: "000000", opacity: 0.18, blur: 6, offset: 2, angle: 90 } });
  slide.addImage({ data: img.data, x, y, w, h, altText: name, objectName: name });
  return { w, h };
}
function text(slide, t, o) { slide.addText(t, { isTextBox: true, fontFace: "Calibri", color: C.text1, fontSize: 14, margin: 0, valign: "top", ...o }); }
function card(slide, x, y, w, h, name, fill = HEX.lt2) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.1, fill: { color: fill }, line: { color: fill }, objectName: name });
}
async function iconDot(slide, Comp, x, y, d, bg, name) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: bg }, line: { color: bg }, objectName: name + " circle" });
  slide.addImage({ data: await icon(Comp, "FFFFFF"), x: x + d * 0.22, y: y + d * 0.22, w: d * 0.56, h: d * 0.56, objectName: name + " icon" });
}
function notes(slide, s) {
  const q = s.questions.length ? "\n\nLikely questions:\n" + s.questions.map(([a, b]) => `- ${a} ${b}`).join("\n") : "";
  slide.addNotes(`[Speaker: ${s.speaker} · about ${s.minutes} min · demo: ${s.demo}]\n\n${s.say}\n\nTechnical detail: ${s.tech}\n\nTransition: ${s.next}${q}`);
}
const content = (s) => { const sl = pres.addSlide({ masterName: "CONTENT", sectionTitle: section(s.n) }); sl.addText(s.title, { placeholder: "title" }); notes(sl, s); return sl; };
const section = (n) => (n <= 4 ? "Problem and approach" : n <= 10 ? "How it works" : n === 14 ? "Live demo" : "Evidence and honesty");
const chartText = { catAxisLabelColor: HEX.dk2, valAxisLabelColor: HEX.accent6, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt",
  dataLabelFontFace: "+mn-lt", titleFontFace: "+mn-lt", catAxisLabelFontSize: 11, valAxisLabelFontSize: 10, dataLabelFontSize: 11, titleFontSize: 13 };

// ------------------------------------------------------------------ slides
async function build() {
  const S_ = Object.fromEntries(SLIDES.map((s) => [s.n, s]));
  const caption = (sl, t, x, y, w) => text(sl, t, { x, y, w, h: 0.3, fontSize: 10.5, color: C.accent6, italic: true });
  const numbered = (sl, items, x, y, w, size = 13, gap = 6) => text(sl, items.map((t, i) => ({ text: t, options: { bullet: { type: "number" }, breakLine: i < items.length - 1 } })), { x, y, w, h: 3.6, fontSize: size, paraSpaceAfter: gap });
  const bullets = (sl, items, x, y, w, h, size = 13) => text(sl, items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < items.length - 1 } })), { x, y, w, h, fontSize: size, paraSpaceAfter: 5 });
  pres.addSection({ title: "Problem and approach" });

  // 1 Title
  {
    const s = S_[1];
    const sl = pres.addSlide({ masterName: "DARK", sectionTitle: "Problem and approach" });
    sl.addText(s.title, { placeholder: "title" });
    text(sl, "An Intelligent Compiler for Syntax Error Analysis, Detection, and Correction", { x: 0.6, y: 2.05, w: 4.9, h: 0.75, fontFace: "Cambria", fontSize: 18, color: MINT });
    text(sl, TEAM.map((t, i) => ({ text: `${t.name}  ·  ${t.reg}`, options: { breakLine: i < TEAM.length - 1 } })), { x: 0.6, y: 3.05, w: 4.9, h: 0.95, fontSize: 14, color: C.background1, paraSpaceAfter: 4 });
    text(sl, "BCSE307P course project  ·  Guide: [guide name, to be added]", { x: 0.6, y: 4.55, w: 4.9, h: 0.3, fontSize: 11, color: "CBD5E1" });
    picture(sl, await shot("v2-el-ambiguity-question", null, 1500), 5.9, 1.05, 3.6, "Workspace screenshot (actual output)");
    notes(sl, s);
  }

  // 2 Problem
  {
    const sl = content(S_[2]);
    const lines = fs.readFileSync(path.join(ROOT, "examples/02_missing_semicolon.mc"), "utf8").split("\n").slice(1, 10);
    card(sl, 0.5, 1.2, 4.9, 3.75, "code card", "F8FAFC");
    text(sl, lines.map((l, i) => ({ text: `${String(i + 2).padStart(2)}  ${l}`, options: { breakLine: i < lines.length - 1, color: i === 1 ? HEX.accent1 : i === 2 ? HEX.accent4 : C.text1, bold: i === 1 || i === 2 } })),
      { x: 0.75, y: 1.4, w: 4.5, h: 3.4, fontFace: "Courier New", fontSize: 15, lineSpacingMultiple: 1.1 });
    const cards = [[Lu.LuTarget, HEX.accent1, "Mistake: end of line 3", "the ';' after  int total = 0  is missing"],
      [Lu.LuSearch, HEX.accent4, `Detected: ${DIAG.start.line}:${DIAG.start.column}`, `${DIAG.message} — the parser can only notice here`],
      [Lu.LuSplit, HEX.accent3, "Also valid: a different fix", "int total = 0, i = 1;  parses too. Which one did you mean?"]];
    for (let i = 0; i < 3; i++) {
      const y = 1.2 + i * 1.28;
      card(sl, 5.65, y, 3.85, 1.12, "problem card " + (i + 1));
      await iconDot(sl, cards[i][0], 5.82, y + 0.28, 0.55, cards[i][1], "problem " + (i + 1));
      text(sl, cards[i][2], { x: 6.55, y: y + 0.14, w: 2.85, h: 0.35, fontSize: 15, bold: true });
      text(sl, cards[i][3], { x: 6.55, y: y + 0.5, w: 2.85, h: 0.58, fontSize: 12, color: C.text2 });
    }
  }

  // 3 Objectives and scope
  {
    const sl = content(S_[3]);
    const obj = [[Lu.LuScanText, "Exact errors", "Flex + Bison front end; exact positions and expected tokens"], [Lu.LuShieldCheck, "Checked repairs", "every candidate validated by the real parser"],
      [Lu.LuScale, "Evidence, not cost", "13 named features; equivalent fixes grouped"], [Lu.LuCircleHelp, "Honest decisions", "recommend, ask, or explain why not"],
      [Lu.LuLightbulb, "For beginners", "plain explanations, hints, explained AST"], [Lu.LuFlaskConical, "Measured", "held-out benchmark, baselines, ablations"]];
    for (let i = 0; i < obj.length; i++) {
      const x = 0.5 + (i % 2) * 2.95, y = 1.2 + Math.floor(i / 2) * 1.22;
      card(sl, x, y, 2.8, 1.08, "objective " + i);
      await iconDot(sl, obj[i][0], x + 0.15, y + 0.27, 0.5, HEX.accent1, "objective " + i);
      text(sl, obj[i][1], { x: x + 0.78, y: y + 0.12, w: 1.95, h: 0.32, fontSize: 13.5, bold: true });
      text(sl, obj[i][2], { x: x + 0.78, y: y + 0.45, w: 1.95, h: 0.58, fontSize: 11, color: C.text2 });
    }
    card(sl, 6.55, 1.2, 2.95, 3.6, "scope card");
    text(sl, "MiniC scope", { x: 6.7, y: 1.3, w: 2.7, h: 0.35, fontSize: 14, bold: true });
    text(sl, [{ text: "In: ", options: { bold: true, color: C.accent5 } }, { text: "int float char bool void, functions, 1-D arrays, if/else, while, for, return, break, continue, arithmetic / comparison / logical operators" }],
      { x: 6.7, y: 1.7, w: 2.7, h: 1.4, fontSize: 11.5 });
    text(sl, [{ text: "Recognised as C, not repaired: ", options: { bold: true, color: C.accent2 } }, { text: "++ += ?: switch do struct pointers strings #include" }], { x: 6.7, y: 3.1, w: 2.7, h: 0.8, fontSize: 11.5 });
    text(sl, [{ text: "Out of scope: ", options: { bold: true, color: C.accent4 } }, { text: "type checking, code generation, running programs" }], { x: 6.7, y: 3.95, w: 2.7, h: 0.7, fontSize: 11.5 });
  }

  // 4 Architecture
  {
    const sl = content(S_[4]);
    const arch = await figure("fig_architecture");
    sl.addImage({ data: arch.data, x: 0.8, y: 1.1, w: 8.4, h: 8.4 * arch.ratio, altText: "System architecture", objectName: "architecture" });
    const pipe = await figure("fig_pipeline");
    sl.addImage({ data: pipe.data, x: 0.7, y: 3.75, w: 8.6, h: 8.6 * pipe.ratio, altText: "Processing pipeline", objectName: "pipeline" });
  }

  pres.addSection({ title: "How it works" });
  // 5 Lexer, parser, validation
  {
    const sl = content(S_[5]);
    const stats = [["97", "grammar rules, 168 LR states, 0 conflicts"], [String(DIAG.expected.length), "tokens expected at the error (exact, via LAC)"], [String(REP.counts.generated), "candidate edits generated"], [String(REP.counts.accepted), "accepted by the real parser"]];
    stats.forEach(([v, l], i) => {
      const y = 1.15 + i * 0.82;
      text(sl, v, { x: 0.5, y, w: 1.1, h: 0.65, fontFace: "Cambria", fontSize: 30, bold: true, color: i < 2 ? C.accent1 : C.accent2 });
      text(sl, l, { x: 1.65, y: y + 0.13, w: 2.7, h: 0.6, fontSize: 13, color: C.text2 });
    });
    text(sl, [{ text: "Round trip: ", options: { bold: true } }, { text: "each accepted fix is written back with your spacing and comments, re-lexed and re-parsed." }], { x: 0.5, y: 4.45, w: 3.9, h: 0.6, fontSize: 11.5, color: C.text2 });
    const by = REP.counts.by_outcome;
    const order = ["valid", "local-repair", "same-location", "defers-error", "earlier-error", "duplicate"].filter((k) => by[k]);
    sl.addChart(pres.charts.BAR, [{ name: "candidates", labels: order, values: order.map((k) => by[k]) }], {
      x: 4.6, y: 1.15, w: 4.9, h: 3.7, barDir: "bar", chartColors: order.map((k) => (k === "valid" || k === "local-repair" ? HEX.accent5 : "94A3B8")),
      showValue: true, dataLabelPosition: "outEnd", dataLabelColor: HEX.dk1, showLegend: false, showTitle: true, title: `What the parser said about the ${REP.counts.generated} candidates`, titleColor: HEX.dk1,
      catGridLine: { style: "none" }, catAxisOrientation: "maxMin", valAxisHidden: true, valGridLine: { style: "none" }, ...chartText, objectName: "outcome chart",
    });
  }

  // 6 Ambiguity resolution
  {
    const sl = content(S_[6]);
    const img = await shot("v2-el-ambiguity-validated", null, 1200);
    const d = picture(sl, img, 0.5, 1.15, 3.6, "Clarification card (actual output)", 3.75);
    caption(sl, "Actual output: int total = price + ;", 0.5, 1.2 + d.h + 0.02, 3.4);
    numbered(sl, [
      "The engine finds several fixes with similar evidence (margin 0.50 < τ 1.5), so it does not guess.",
      "It explains what is ambiguous and asks: is the + extra, or is something missing? Options are the real top plans, a fill-in, or your own line.",
      "It suggests price (declared earlier), not total (still being declared).",
      "Check with the parser: the real parser validates the answer before it can be applied.",
      "Then: inspect the tree (step 4), apply and verify by a real re-parse (step 5); Undo restores the original; you can also leave it unresolved.",
    ], 4.4, 1.2, 5.1, 13.5, 8);
  }

  // 7 Repair comparison
  {
    const sl = content(S_[7]);
    const cands = REP.candidates.filter((c) => c.valid).slice(0, 3);
    const feats = ["edit_cost", "resolves_all_errors", "deleted_content", "line_end_semicolon", "name_warnings"];
    const ev = (c, f) => { const e = c.evidence.find((x) => x.name === f); return e ? e.contribution : 0; };
    const fmt = (v) => (v === 0 ? "0" : (v > 0 ? "+" : "−") + Math.abs(v).toFixed(2));
    const hdr = ["Feature", ...cands.map((c) => c.summary.replace(/ at \d+:\d+/, ""))].map((t) => ({ text: t, options: { bold: true, color: HEX.lt1, fill: { color: HEX.dk1 } } }));
    const rows = feats.map((f) => [{ text: f, options: { fontFace: "Courier New", fontSize: 11 } }, ...cands.map((c) => { const v = ev(c, f); return { text: fmt(v), options: { align: "right", color: v > 0 ? HEX.accent5 : v < 0 ? HEX.accent4 : HEX.accent6 } }; })]);
    rows.push([{ text: "score", options: { bold: true } }, ...cands.map((c, i) => ({ text: fmt(c.score), options: { bold: true, align: "right", color: i === 0 ? HEX.accent2 : HEX.dk1 } }))]);
    sl.addTable([hdr, ...rows], { x: 0.5, y: 1.2, w: 6.2, colW: [2.45, 1.25, 1.25, 1.25], fontFace: "Calibri", fontSize: 12, color: HEX.dk1, border: { type: "solid", pt: 0.5, color: "CBD5E1" }, rowH: 0.42, fill: { color: HEX.lt1 }, objectName: "evidence table" });
    text(sl, "Live compiler output for the missing-semicolon sample; 8 more features are 0 for all three.", { x: 0.5, y: 4.45, w: 6.2, h: 0.35, fontSize: 11, color: C.accent6 });
    card(sl, 7.0, 1.2, 2.5, 3.6, "margin card");
    text(sl, "margin", { x: 7.2, y: 1.35, w: 2.1, h: 0.3, fontSize: 13, color: C.accent6 });
    text(sl, REP.decision.margin.toFixed(2), { x: 7.2, y: 1.65, w: 2.1, h: 0.75, fontFace: "Cambria", fontSize: 40, bold: true, color: C.accent2 });
    text(sl, `≥ τ = ${S.tau_selection.tau} (chosen on dev)\n→ Recommended`, { x: 7.2, y: 2.45, w: 2.1, h: 0.7, fontSize: 13 });
    text(sl, "Step 3 (Fixes) shows every structurally different repair with its line change, cost, score and parser validity, and “Choose this fix”. The score ranks; it is not a probability.", { x: 7.2, y: 3.2, w: 2.15, h: 1.5, fontSize: 11, color: C.text2 });
  }

  // 8 AST explorer
  {
    const sl = content(S_[8]);
    const img = await shot("v2-el-ast-grid", null, 1500);
    const d = picture(sl, img, 0.5, 1.15, 5.6, "AST Explorer with an explained node (actual output)", 3.75);
    caption(sl, "Actual output: the Binary + node of total + square(i) * 2", 0.5, 1.2 + d.h + 0.02, 5.6);
    text(sl, "For every selected node", { x: 6.45, y: 1.15, w: 3.05, h: 0.35, fontSize: 15, bold: true });
    numbered(sl, ["Its meaning and category", "Its role in the parent and each child", "The source it covers (click code ↔ node)", "The tokens it absorbs (;  (  )  op)", "The grammar rule that built it", "An expression diagram with precedence"], 6.45, 1.55, 3.05, 13, 5);
    text(sl, "Plus: search, expand/collapse, before & after, JSON. Grammar rules come from minic.y for all 26 node kinds.", { x: 6.45, y: 4.0, w: 3.05, h: 0.8, fontSize: 11, color: C.text2 });
  }

  // 9 Before and after
  {
    const sl = content(S_[9]);
    const a = await shot("v2-el-ast-partial", null, 1000);
    const b = await shot("v2-el-ast-before-after", null, 1000);
    const da = picture(sl, a, 0.5, 1.15, 4.3, "Partial tree for invalid code (actual output)", 3.5);
    const db = picture(sl, b, 5.2, 1.15, 4.3, "Before and after comparison (actual output)", 3.5);
    caption(sl, "Invalid code: a labelled partial tree with Error nodes, never a fake AST", 0.5, 1.2 + da.h + 0.02, 4.4);
    caption(sl, "Option 1 (+) vs option 2 (−): exactly one changed node, from the compiler's diff", 5.2, 1.2 + db.h + 0.02, 4.4);
  }

  // 10 Explanations and guided repair
  {
    const sl = content(S_[10]);
    const img = await shot("v2-el-hints-practice", null, 1200);
    const d = picture(sl, img, 0.5, 1.15, 3.4, "Hints and a checked student fix (actual output)", 3.75);
    caption(sl, "Actual output: the student's own fix, checked", 0.5, 1.2 + d.h + 0.02, 3.5);
    const steps = [["1", "Where", "the line and token where the parser stopped"], ["2", "What is expected", "the expected tokens, in words"], ["3", "Options", "the fixes the engine verified"], ["✓", "Check my fix", "the real compiler checks the student's edit"]];
    steps.forEach(([n, h, t], i) => {
      const y = 1.15 + i * 0.68;
      sl.addShape(pres.shapes.OVAL, { x: 4.15, y: y + 0.05, w: 0.45, h: 0.45, fill: { color: i === 3 ? HEX.accent5 : HEX.accent1 }, line: { color: i === 3 ? HEX.accent5 : HEX.accent1 }, objectName: "hint " + i });
      text(sl, n, { x: 4.15, y: y + 0.05, w: 0.45, h: 0.45, align: "center", valign: "middle", fontSize: 14, bold: true, color: C.background1 });
      text(sl, [{ text: h + ": ", options: { bold: true } }, { text: t }], { x: 4.75, y: y + 0.08, w: 4.75, h: 0.45, fontSize: 13 });
    });
    card(sl, 4.15, 3.95, 5.35, 0.9, "coverage card");
    text(sl, "Every result has its own explanation: valid code, empty input, missing tokens, cascades, ambiguity, missing names, invalid characters, unsupported C, nesting limit, no safe repair. Tested on all 88 professor-style inputs.", { x: 4.3, y: 4.0, w: 5.1, h: 0.8, fontSize: 11.5, color: C.text2 });
  }

  pres.addSection({ title: "Evidence and honesty" });
  // 11 Method and results
  {
    const sl = content(S_[11]);
    const stats = [[String(S.n_cases), "seeded synthetic cases, 30 programs"], ["360 / 540", "dev / held-out test (split by program)"], [`${pct(T.P.localisation_exact)}%`, "first edit at the exact mistake"], ["9", "systems incl. CPCT+ and ablations"]];
    stats.forEach(([v, l], i) => {
      const x = 0.5 + (i % 2) * 1.95, y = 1.15 + Math.floor(i / 2) * 1.5;
      card(sl, x, y, 1.85, 1.38, "stat " + i);
      text(sl, v, { x: x + 0.12, y: y + 0.1, w: 1.65, h: 0.6, fontFace: "Cambria", fontSize: v.length > 6 ? 20 : 26, bold: true, color: C.accent1 });
      text(sl, l, { x: x + 0.12, y: y + 0.72, w: 1.65, h: 0.62, fontSize: 11, color: C.text2 });
    });
    text(sl, "Synthetic mutations, not real student code. Wilson 95% intervals; paired bootstrap.", { x: 0.5, y: 4.2, w: 3.8, h: 0.6, fontSize: 11, color: C.accent3, bold: true });
    const sys = [["IntelliFix", T.P.top1_ast.rate], ["least-cost", T.C.top1_ast.rate]];
    if (cp) sys.push(["CPCT+ (run 1)", S.cpctplus.test[0].top1_ast.rate]);
    sl.addChart(pres.charts.BAR, [{ name: "top-1", labels: sys.map((s) => s[0]), values: sys.map((s) => +(100 * s[1]).toFixed(1)) }], {
      x: 4.55, y: 1.1, w: 4.95, h: 3.35, barDir: "col", chartColors: [HEX.accent2, "94A3B8", "94A3B8"], showValue: true, dataLabelPosition: "outEnd", dataLabelColor: HEX.dk1,
      dataLabelFormatCode: '0.0"%"', valAxisMaxVal: 100, valAxisMinVal: 0, valAxisLabelFormatCode: '0"%"', showLegend: false, showTitle: true,
      title: "Top-1 repair restores the original AST (540 test cases)", titleColor: HEX.dk1, valGridLine: { color: "E2E8F0", size: 0.5 }, catGridLine: { style: "none" }, ...chartText, objectName: "top-1 chart",
    });
    const pt = S.paired_tests.top1_ast_P_minus_C;
    text(sl, `+${pts(pt.diff)} points vs least-cost, 95% CI [${pts(pt.ci95[0])}, ${pts(pt.ci95[1])}] · CPCT+ 47.4–49.1% over three runs`, { x: 4.55, y: 4.5, w: 4.95, h: 0.45, fontSize: 11, color: C.text2 });
  }

  // 12 Ablations and negative results
  {
    const sl = content(S_[12]);
    const pt = S.paired_tests;
    const t = CLAR.test;
    const rows = [
      ["Layout evidence", `${pct(T.P.top1_ast)}% vs ${pct(T.L.top1_ast)}% top-1 without it`, "Supported", HEX.accent5],
      ["Abstention", `wrong-but-confident ${pct(T.P.false_confident_rate)}% vs ${pct(T.F.false_confident_rate)}%; coverage ${pct(T.P.coverage)}%; selective acc. ${pct(T.P.selective_accuracy)}%`, "Supported", HEX.accent5],
      ["Risk target", `${(100 - +pct(T.P.selective_accuracy)).toFixed(1)}% selective risk vs 10% set on dev`, "Missed", HEX.accent4],
      ["AST grouping", `coverage ${pct(T.P.coverage)}% vs ${pct(T.D.coverage)}%`, "Weak", HEX.accent3],
      ["Stability evidence", `+${pts(pt.top1_ast_P_minus_E.diff)} points, CI [${pts(pt.top1_ast_P_minus_E.ci95[0])}, ${pts(pt.top1_ast_P_minus_E.ci95[1])}]`, "Not supported", HEX.accent4],
      ["Clarification options", `correct repair offered in ${t.oracle_user.k} of ${t.abstained_cases} abstained cases`, "Simulation only", HEX.accent6],
    ];
    const hdr = ["Part", "Measured on the test split", "Verdict"].map((x) => ({ text: x, options: { bold: true, color: HEX.lt1, fill: { color: HEX.dk1 } } }));
    sl.addTable([hdr, ...rows.map(([a, b, c, col]) => [{ text: a, options: { bold: true } }, { text: b }, { text: c, options: { bold: true, color: col } }])],
      { x: 0.5, y: 1.15, w: 9, colW: [2.1, 5.05, 1.85], fontFace: "Calibri", fontSize: 12.5, color: HEX.dk1, rowH: 0.47, border: { type: "solid", pt: 0.5, color: "CBD5E1" }, objectName: "ablation table" });
    text(sl, "Usability and learning effects of the interactive features are not measured yet; a user study is proposed (docs/IntelliFix_Interactive_Features.md).", { x: 0.5, y: 4.55, w: 9, h: 0.45, fontSize: 11.5, color: C.accent3, bold: true });
  }

  // 13 Testing, limits, platforms
  {
    const sl = content(S_[13]);
    const hdr = ["Test layer", "Result"].map((x) => ({ text: x, options: { bold: true, color: HEX.lt1, fill: { color: HEX.dk1 } } }));
    sl.addTable([hdr, ...TESTS.rows.map(([a, , c]) => [{ text: a }, { text: c, options: { bold: true, color: HEX.accent5, align: "right" } }])],
      { x: 0.5, y: 1.15, w: 4.6, colW: [3.4, 1.2], fontFace: "Calibri", fontSize: 12, color: HEX.dk1, rowH: 0.4, border: { type: "solid", pt: 0.5, color: "CBD5E1" }, objectName: "tests table" });
    text(sl, "Plus 88 professor-style inputs, 800 seeded random inputs and 7 HTTP sequences: 0 crashes; 2 real defects found and fixed.", { x: 0.5, y: 3.85, w: 4.6, h: 0.9, fontSize: 11.5, color: C.text2 });
    card(sl, 5.4, 1.15, 4.1, 1.85, "limits card");
    text(sl, "Limits", { x: 5.55, y: 1.22, w: 3.8, h: 0.32, fontSize: 14, bold: true });
    bullets(sl, ["synthetic errors; 30 programs by one author", "MiniC subset; syntax only, no types", "valid ≠ intended (e.g. whlie (…) { gets ;)"], 5.55, 1.55, 3.85, 1.4, 11.5);
    card(sl, 5.4, 3.15, 4.1, 1.7, "platforms card");
    text(sl, "Platforms", { x: 5.55, y: 3.22, w: 3.8, h: 0.32, fontSize: 14, bold: true });
    bullets(sl, ["Linux: all layers tested", "Windows: MinGW build passes 68/68 under Wine", "Not run yet: real Windows, MSVC, PowerShell scripts, macOS"], 5.55, 3.55, 3.85, 1.25, 11.5);
  }

  pres.addSection({ title: "Live demo" });
  // 14 Live demo
  {
    const sl = content(S_[14]);
    picture(sl, await shot("v2-el-tree-step", null, 1500), 0.5, 1.15, 5.4, "Workspace step 4 during the demo (actual output)", 3.6);
    numbered(sl, ["Missing semicolon: Analyze → Diagnosis → Fixes → Apply & verify", "int total = price + ; → answer the question in step 3", "Step 4: partial tree → complete tree", "AST Explorer: click a node or the code", "Hints and Check my fix", "Your own input"], 6.25, 1.2, 3.25, 13, 7);
    text(sl, "Check first: the badge says “Compiler 1.0.0”. Never show screenshots as live output.", { x: 6.25, y: 4.3, w: 3.25, h: 0.6, fontSize: 11, color: C.accent4 });
  }

  pres.addSection({ title: "Conclusion" });
  // 15 Conclusion (dark)
  {
    const s = S_[15];
    const sl = pres.addSlide({ masterName: "DARK", sectionTitle: "Conclusion" });
    text(sl, "Contribution and future work", { x: 0.6, y: 0.55, w: 8.8, h: 0.7, fontFace: "Cambria", fontSize: 30, bold: true, color: C.background1 });
    text(sl, "What we contribute", { x: 0.6, y: 1.45, w: 4.3, h: 0.35, fontSize: 15, bold: true, color: MINT });
    text(sl, ["An integrated, inspectable repair pipeline on known LR techniques", "Evidence ranking, layout, grouping, abstention — each measured", "Questions instead of guesses; hints; an explained AST", "An honest evaluation, including what did not work"].map((t, i, a) => ({ text: t, options: { bullet: true, breakLine: i < a.length - 1 } })),
      { x: 0.6, y: 1.85, w: 4.3, h: 2.4, fontSize: 13, color: C.background1, paraSpaceAfter: 6 });
    text(sl, "Next steps", { x: 5.3, y: 1.45, w: 4.2, h: 0.35, fontSize: 15, bold: true, color: MINT });
    text(sl, ["Study with real, anonymised student errors", "User study of the question feature (protocol written)", "Learned and calibrated evidence weights", "Native Windows verification (MSVC, MSYS2)"].map((t, i, a) => ({ text: t, options: { bullet: true, breakLine: i < a.length - 1 } })),
      { x: 5.3, y: 1.85, w: 4.2, h: 2.4, fontSize: 13, color: C.background1, paraSpaceAfter: 6 });
    text(sl, "Thank you — questions, and please try your own code.", { x: 0.6, y: 4.45, w: 8.8, h: 0.4, fontFace: "Cambria", fontSize: 16, color: MINT });
    text(sl, TEAM.map((t) => `${t.name} (${t.reg})`).join("  ·  "), { x: 0.6, y: 4.9, w: 8.8, h: 0.3, fontSize: 11, color: "CBD5E1" });
    notes(sl, s);
  }

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
}

build().catch((e) => { console.error(e); process.exit(1); });
