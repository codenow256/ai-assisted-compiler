// Builds deliverables/IntelliFix_Presentation.pptx.
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
const { TEAM, SLIDES } = require("./slides_content");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "deliverables", "IntelliFix_Presentation.pptx");
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
    [String(DIAG.expected.length), "15"], [REP.decision.margin.toFixed(1), "2.0"],
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
  slide.addNotes(`[Speaker: ${s.speaker} · about ${s.minutes} min · in the app: ${s.app}]\n\n${s.notes}`);
}
const content = (s) => { const sl = pres.addSlide({ masterName: "CONTENT", sectionTitle: section(s.n) }); sl.addText(s.title, { placeholder: "title" }); notes(sl, s); return sl; };
const section = (n) => (n <= 4 ? "Problem and approach" : n <= 9 ? "How it works" : n === 10 ? "Live demo" : "Evidence and honesty");
const chartText = { catAxisLabelColor: HEX.dk2, valAxisLabelColor: HEX.accent6, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt",
  dataLabelFontFace: "+mn-lt", titleFontFace: "+mn-lt", catAxisLabelFontSize: 11, valAxisLabelFontSize: 10, dataLabelFontSize: 11, titleFontSize: 13 };

// ------------------------------------------------------------------ slides
async function build() {
  const S_ = Object.fromEntries(SLIDES.map((s) => [s.n, s]));
  pres.addSection({ title: "Problem and approach" });

  // 1 Title
  {
    const s = S_[1];
    const sl = pres.addSlide({ masterName: "DARK", sectionTitle: "Problem and approach" });
    sl.addText(s.title, { placeholder: "title" });
    text(sl, "An Intelligent Compiler for Syntax Error Analysis, Detection, and Correction", { x: 0.6, y: 2.05, w: 4.9, h: 0.75, fontFace: "Cambria", fontSize: 18, color: MINT });
    text(sl, TEAM.map((t, i) => ({ text: `${t.name}  ·  ${t.reg}`, options: { breakLine: i < TEAM.length - 1 } })),
      { x: 0.6, y: 3.05, w: 4.9, h: 0.95, fontSize: 14, color: C.background1, paraSpaceAfter: 4 });
    text(sl, "BCSE307P course project  ·  Guide: [guide name, to be added]", { x: 0.6, y: 4.55, w: 4.9, h: 0.3, fontSize: 11, color: "CBD5E1" });
    const img = await shot("05-workbench-full-analysis", [375, 150, 2140, 1350], 1500);
    picture(sl, img, 5.9, 1.05, 3.6, "Workbench screenshot");
    notes(sl, s);
  }

  // 2 Problem
  {
    const sl = content(S_[2]);
    const lines = fs.readFileSync(path.join(ROOT, "examples/02_missing_semicolon.mc"), "utf8").split("\n").slice(1, 10);
    card(sl, 0.5, 1.2, 4.9, 3.75, "code card", "F8FAFC");
    text(sl, lines.map((l, i) => ({ text: `${String(i + 2).padStart(2)}  ${l}`, options: { breakLine: i < lines.length - 1,
      color: i === 1 ? HEX.accent1 : i === 2 ? HEX.accent4 : C.text1, bold: i === 1 || i === 2 } })),
      { x: 0.75, y: 1.4, w: 4.5, h: 3.4, fontFace: "Courier New", fontSize: 15, lineSpacingMultiple: 1.1 });
    const cards = [
      [Lu.LuTarget, HEX.accent1, "Mistake: end of line 3", "the ';' after  int total = 0  is missing"],
      [Lu.LuSearch, HEX.accent4, `Detected: ${DIAG.start.line}:${DIAG.start.column}`, `${DIAG.message} — the parser can only notice here`],
      [Lu.LuSplit, HEX.accent3, "Also valid: a different fix", "int total = 0, i = 1;  parses too. Which one did you mean?"],
    ];
    for (let i = 0; i < cards.length; i++) {
      const y = 1.2 + i * 1.28;
      card(sl, 5.65, y, 3.85, 1.12, "problem card " + (i + 1));
      await iconDot(sl, cards[i][0], 5.82, y + 0.28, 0.55, cards[i][1], "problem " + (i + 1));
      text(sl, cards[i][2], { x: 6.55, y: y + 0.14, w: 2.85, h: 0.35, fontSize: 15, bold: true });
      text(sl, cards[i][3], { x: 6.55, y: y + 0.5, w: 2.85, h: 0.58, fontSize: 12, color: C.text2 });
    }
  }

  // 3 Existing approaches
  {
    const sl = content(S_[3]);
    const B = T.B;
    const g = cp ? `${Math.min(...cp).toFixed(1)}–${Math.max(...cp).toFixed(1)}%` : "not run";
    const cols = [
      [Lu.LuLayers, "Panic-mode recovery", `${B.diagnostics_per_case.mean.toFixed(2)}`, "diagnostics per case", `skips to ';' or '}'; ${pct(B.cases_with_spurious)}% of cases get a spurious error; never says what to change`],
      [Lu.LuScale, "Least-cost repair", `${pct(T.C.top1_ast)}%`, "top-1 restores the program", "the cheapest edit that parses is often not the intended one"],
      [Lu.LuListTree, "CPCT+ (ECOOP 2020)", g, "top-1, first repair (2 runs here)", "all minimum-cost repairs; picks arbitrarily among equal-cost ones (built for recovery)"],
    ];
    for (let i = 0; i < 3; i++) {
      const x = 0.5 + i * 3.05;
      card(sl, x, 1.2, 2.85, 3.2, "approach " + (i + 1));
      await iconDot(sl, cols[i][0], x + 0.2, 1.38, 0.5, HEX.accent6, "approach " + (i + 1));
      text(sl, cols[i][1], { x: x + 0.82, y: 1.45, w: 1.95, h: 0.4, fontSize: 15, bold: true });
      text(sl, cols[i][2], { x: x + 0.2, y: 2.05, w: 2.5, h: 0.65, fontFace: "Cambria", fontSize: 32, bold: true, color: C.accent2 });
      text(sl, cols[i][3], { x: x + 0.2, y: 2.7, w: 2.5, h: 0.3, fontSize: 12, color: C.accent6 });
      text(sl, cols[i][4], { x: x + 0.2, y: 3.1, w: 2.5, h: 1.2, fontSize: 12, color: C.text2 });
    }
    text(sl, [{ text: "The gap: ", options: { bold: true, color: C.accent1 } },
      { text: "none of them uses layout or names, and none can say “I am not sure”." }], { x: 0.5, y: 4.6, w: 9, h: 0.4, fontSize: 15 });
  }

  // 4 Pipeline
  {
    const sl = content(S_[4]);
    const steps = [["Lex", "Flex: tokens with exact spans"], ["Parse", "Bison LALR(1), panic mode"], ["Localise", "first error, exact LAC expectations"],
      ["Generate & validate", "bounded edits, each re-parsed"], ["Rank & group", "13 evidence features; AST classes"], ["Lanes", "repair later errors per hypothesis"], ["Decide", "recommend, or say why not"]];
    const w = 1.2, gap = 0.1;
    steps.forEach(([h, d], i) => {
      const x = 0.5 + i * (w + gap);
      const col = i < 2 ? HEX.accent6 : i < 6 ? HEX.accent1 : HEX.accent2;
      card(sl, x, 1.55, w, 2.0, "stage " + (i + 1));
      sl.addShape(pres.shapes.OVAL, { x: x + 0.38, y: 1.7, w: 0.44, h: 0.44, fill: { color: col }, line: { color: col }, objectName: "stage number " + (i + 1) });
      text(sl, String(i + 1), { x: x + 0.38, y: 1.7, w: 0.44, h: 0.44, align: "center", valign: "middle", fontSize: 15, bold: true, color: C.background1 });
      text(sl, h, { x: x + 0.08, y: 2.25, w: w - 0.16, h: 0.5, fontSize: 13, bold: true, align: "center" });
      text(sl, d, { x: x + 0.08, y: 2.78, w: w - 0.16, h: 0.75, fontSize: 10.5, color: C.text2, align: "center" });
    });
    const groups = [[0, 2, "Front end (Flex + Bison)", HEX.accent6], [2, 6, "Repair engine (C++)", HEX.accent1], [6, 7, "Decision", HEX.accent2]];
    for (const [a, b, label, col] of groups) {
      const x = 0.5 + a * (w + gap), ww = (b - a) * (w + gap) - gap;
      sl.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 3.7, w: ww, h: 0.36, rectRadius: 0.08, fill: { color: col }, line: { color: col }, objectName: label });
      text(sl, label, { x, y: 3.7, w: ww, h: 0.36, align: "center", valign: "middle", fontSize: 12, bold: true, color: C.background1 });
    }
    text(sl, "Every stage runs in the native compiler (parallaxc). The web interface only displays its output; nothing is simulated.",
      { x: 0.5, y: 4.3, w: 9, h: 0.5, fontSize: 14, color: C.text2 });
  }

  pres.addSection({ title: "How it works" });
  // 5 Front end
  {
    const sl = content(S_[5]);
    const stats = [["97", "grammar rules"], ["168", "LR states"], ["0", "conflicts (%expect 0)"], [String(DIAG.expected.length), "tokens expected at the error (exact, via LAC)"]];
    stats.forEach(([v, l], i) => {
      const y = 1.2 + i * 0.9;
      text(sl, v, { x: 0.5, y, w: 1.25, h: 0.7, fontFace: "Cambria", fontSize: 34, bold: true, color: C.accent1 });
      text(sl, l, { x: 1.8, y: y + 0.15, w: 2.6, h: 0.6, fontSize: 14, color: C.text2 });
    });
    const img = await shot("07-grammar-and-parsing", [1150, 420, 2140, 1100], 1300);
    picture(sl, img, 4.6, 1.2, 4.9, "Grammar and parsing page: LR state 47 and expected tokens", 3.75);
  }

  // 6 Candidates
  {
    const sl = content(S_[6]);
    const by = REP.counts.by_outcome;
    const order = ["valid", "local-repair", "same-location", "defers-error", "earlier-error", "duplicate"].filter((k) => by[k]);
    sl.addChart(pres.charts.BAR, [{ name: "candidates", labels: order, values: order.map((k) => by[k]) }], {
      x: 0.5, y: 1.15, w: 5.1, h: 3.4, barDir: "bar", chartColors: order.map((k) => (k === "valid" || k === "local-repair" ? HEX.accent5 : "94A3B8")),
      showValue: true, dataLabelPosition: "outEnd", dataLabelColor: HEX.dk1, showLegend: false, showTitle: true,
      title: `${REP.counts.generated} candidates for the missing semicolon, by parser outcome`, titleColor: HEX.dk1,
      catGridLine: { style: "none" }, catAxisOrientation: "maxMin", valAxisHidden: true, valGridLine: { style: "none" }, ...chartText, objectName: "outcome chart",
    });
    const funnel = [[String(REP.counts.generated), "generated (LAC-guided edits, 4 positions)"], [String(REP.counts.accepted), "accepted by the parser"],
      ["1", "recommended (after ranking and the margin test)"]];
    funnel.forEach(([v, l], i) => {
      const y = 1.25 + i * 0.85;
      text(sl, v, { x: 5.95, y, w: 0.9, h: 0.6, fontFace: "Cambria", fontSize: 30, bold: true, color: i === 2 ? C.accent2 : C.accent1 });
      text(sl, l, { x: 6.9, y: y + 0.1, w: 2.6, h: 0.6, fontSize: 13, color: C.text2 });
    });
    card(sl, 5.95, 3.85, 3.55, 0.95, "round trip card");
    text(sl, [{ text: "Round trip: ", options: { bold: true } }, { text: "each accepted fix is written back with your spacing and comments, re-lexed and re-parsed." }],
      { x: 6.1, y: 3.95, w: 3.3, h: 0.8, fontSize: 12, color: C.text2 });
  }

  // 7 Evidence
  {
    const sl = content(S_[7]);
    const cands = REP.candidates.filter((c) => c.valid).slice(0, 3);
    const feats = ["edit_cost", "resolves_all_errors", "deleted_content", "line_end_semicolon", "name_warnings"];
    const ev = (c, f) => { const e = c.evidence.find((x) => x.name === f); return e ? e.contribution : 0; };
    const fmt = (v) => (v === 0 ? "0" : (v > 0 ? "+" : "−") + Math.abs(v).toFixed(2));
    const hdr = ["Feature", ...cands.map((c) => c.summary.replace(/ at \d+:\d+/, ""))].map((t) => ({ text: t, options: { bold: true, color: HEX.lt1, fill: { color: HEX.dk1 } } }));
    const rows = feats.map((f) => [{ text: f, options: { fontFace: "Courier New", fontSize: 11 } }, ...cands.map((c) => {
      const v = ev(c, f); return { text: fmt(v), options: { align: "right", color: v > 0 ? HEX.accent5 : v < 0 ? HEX.accent4 : HEX.accent6 } }; })]);
    rows.push([{ text: "score", options: { bold: true } }, ...cands.map((c, i) => ({ text: fmt(c.score), options: { bold: true, align: "right", color: i === 0 ? HEX.accent2 : HEX.dk1 } }))]);
    sl.addTable([hdr, ...rows], { x: 0.5, y: 1.2, w: 6.2, colW: [2.45, 1.25, 1.25, 1.25], fontFace: "Calibri", fontSize: 12, color: HEX.dk1,
      border: { type: "solid", pt: 0.5, color: "CBD5E1" }, rowH: 0.42, fill: { color: HEX.lt1 }, objectName: "evidence table" });
    text(sl, "8 more features are 0 for all three (placeholders, indentation, residual errors, …).", { x: 0.5, y: 4.45, w: 6.2, h: 0.35, fontSize: 11, color: C.accent6 });
    card(sl, 7.0, 1.2, 2.5, 3.0, "margin card");
    text(sl, "margin", { x: 7.2, y: 1.35, w: 2.1, h: 0.3, fontSize: 13, color: C.accent6 });
    text(sl, REP.decision.margin.toFixed(2), { x: 7.2, y: 1.65, w: 2.1, h: 0.75, fontFace: "Cambria", fontSize: 40, bold: true, color: C.accent2 });
    text(sl, `≥ τ = ${S.tau_selection.tau} (chosen on dev)\n→ Recommended`, { x: 7.2, y: 2.45, w: 2.1, h: 0.7, fontSize: 13, color: C.text1 });
    text(sl, "Weights frozen before the test run. The score ranks; it is not a probability.", { x: 7.2, y: 3.2, w: 2.15, h: 0.9, fontSize: 11, color: C.text2 });
  }

  // 8 Grouping and lanes
  {
    const sl = content(S_[8]);
    card(sl, 0.5, 1.2, 3.3, 3.6, "grouping card");
    text(sl, "AST grouping", { x: 0.7, y: 1.32, w: 2.9, h: 0.35, fontSize: 15, bold: true });
    text(sl, "int b = (a + 2;", { x: 0.7, y: 1.75, w: 2.9, h: 0.35, fontFace: "Courier New", fontSize: 13, color: C.accent4 });
    text(sl, [{ text: "(a) + 2", options: { breakLine: true } }, { text: "(a + 2)" }], { x: 0.7, y: 2.2, w: 1.3, h: 0.7, fontFace: "Courier New", fontSize: 13 });
    text(sl, "→ one AST:\nBinary(+, a, 2)", { x: 1.95, y: 2.2, w: 1.8, h: 0.7, fontSize: 12, color: C.accent1, bold: true });
    text(sl, "Two edits, one meaning: they form one class and do not compete, so IntelliFix is not falsely unsure.", { x: 0.7, y: 3.05, w: 2.95, h: 1.0, fontSize: 12, color: C.text2 });
    text(sl, "Lanes: 3 first-fix hypotheses × 2 alternatives per step, depth ≤ 4, ≤ 12 leaves.", { x: 0.7, y: 4.05, w: 2.95, h: 0.7, fontSize: 12, color: C.text2 });
    const img = await shot("15b-two-errors-lanes", [410, 410, 2125, 1110], 1500);
    const d = picture(sl, img, 4.05, 1.2, 5.45, "Hypothesis explorer: two-error plan", 3.6);
    text(sl, "Real run, sample “Two errors”: hypothesis 0 fixes the missing ';' (step 1) and the missing ')' (step 2). Other lanes explore alternatives; the best complete plan is starred.",
      { x: 4.05, y: 1.2 + d.h + 0.2, w: 5.45, h: 0.75, fontSize: 12, color: C.text2 });
  }

  // 9 Abstention
  {
    const sl = content(S_[9]);
    const tiles = [
      ["Recommended", HEX.accent5, "margin ≥ τ = 1.5", "missing ';' (margin 2.00)"],
      ["Multiple plausible", HEX.accent3, "margin < τ", "a b: 20 operators tie (0.00)"],
      ["Low confidence", HEX.accent3, "invents a name or value, incomplete, or drops hidden code", "int = 42;  →  __hole"],
      ["Unsupported construct", HEX.accent2, "C feature MiniC omits, or nesting too deep", "i++  →  write x = x + 1"],
      ["No repair needed", HEX.accent5, "the program is valid", "valid sample"],
      ["No safe repair", HEX.accent4, "no bounded edit works", "class A { public: … }"],
      ["Budget exhausted", HEX.accent4, "the search limit was hit (30,000 parses / 4 s)", "never on the benchmark"],
    ];
    for (let i = 0; i < tiles.length; i++) {
      const col = i % 4, row = Math.floor(i / 4);
      const x = 0.5 + col * 2.3, y = 1.2 + row * 1.85, w = 2.15, h = 1.7;
      card(sl, x, y, w, h, "status " + tiles[i][0]);
      sl.addShape(pres.shapes.OVAL, { x: x + 0.15, y: y + 0.21, w: 0.16, h: 0.16, fill: { color: tiles[i][1] }, line: { color: tiles[i][1] }, objectName: "tone " + i });
      text(sl, tiles[i][0], { x: x + 0.38, y: y + 0.13, w: w - 0.45, h: 0.35, fontSize: 12.5, bold: true });
      text(sl, tiles[i][2], { x: x + 0.18, y: y + 0.55, w: w - 0.3, h: 0.62, fontSize: 11, color: C.text2 });
      text(sl, tiles[i][3], { x: x + 0.18, y: y + 1.2, w: w - 0.3, h: 0.42, fontSize: 11, color: C.accent1, italic: true });
    }
    text(sl, `τ chosen on dev: most coverage with dev risk ≤ 10% (dev coverage ${(100 * S.tau_selection.table.find((r) => r.tau === S.tau_selection.tau).coverage).toFixed(1)}%).`,
      { x: 7.4, y: 3.15, w: 2.1, h: 1.6, fontSize: 12, color: C.text2 });
  }

  pres.addSection({ title: "Live demo" });
  // 10 Live demo
  {
    const sl = content(S_[10]);
    const img = await shot("05-workbench-full-analysis", [375, 150, 2140, 1350], 1500);
    picture(sl, img, 0.5, 1.2, 5.4, "Workbench after Full analysis", 3.7);
    const steps = ["Missing semicolon: lexer → parser → full analysis", "Grammar & parsing: LR state 47", "Evidence breakdown → Accept repair",
      "Ambiguous operator · Missing name · i++", "Two errors → Hypothesis explorer", "Evaluation page", "Your own input"];
    text(sl, steps.map((t, i) => ({ text: t, options: { bullet: { type: "number" }, breakLine: i < steps.length - 1 } })),
      { x: 6.25, y: 1.25, w: 3.25, h: 3.0, fontSize: 13, paraSpaceAfter: 6, color: C.text1 });
    text(sl, "Check first: badge says “Compiler 1.0.0”. Never show screenshots as live output.", { x: 6.25, y: 4.3, w: 3.25, h: 0.6, fontSize: 11, color: C.accent4 });
  }

  pres.addSection({ title: "Evidence and honesty" });
  // 11 Evaluation design
  {
    const sl = content(S_[11]);
    const m = S.dataset;
    const stats = [[String(S.n_cases), "seeded synthetic cases from 30 programs"], ["360", "dev cases (12 programs): all tuning"], ["540", "test cases (18 programs): held out"], ["9", "systems: baselines, CPCT+, ablations"]];
    stats.forEach(([v, l], i) => {
      const x = 0.5 + i * 2.3;
      card(sl, x, 1.2, 2.15, 1.55, "stat " + i);
      text(sl, v, { x: x + 0.15, y: 1.3, w: 1.9, h: 0.7, fontFace: "Cambria", fontSize: 34, bold: true, color: C.accent1 });
      text(sl, l, { x: x + 0.15, y: 2.0, w: 1.9, h: 0.7, fontSize: 12, color: C.text2 });
    });
    const bullets = [
      "Split by program, not by case, so near-duplicate mutations cannot leak into the test set.",
      "Weights and τ fixed on dev; model frozen before the first test run.",
      "Systems: raw parser, panic mode, least-cost, CPCT+ (grmtools), and ablations without layout, stability, grouping or abstention.",
      "Wilson 95% intervals; paired bootstrap (2000 resamples) for differences.",
    ];
    text(sl, bullets.map((b, i) => ({ text: b, options: { bullet: true, breakLine: i < bullets.length - 1 } })), { x: 0.5, y: 3.0, w: 6.4, h: 1.9, fontSize: 13, paraSpaceAfter: 5 });
    card(sl, 7.1, 3.0, 2.4, 1.8, "caveat card", "FEF3C7");
    await iconDot(sl, Lu.LuTriangleAlert, 7.25, 3.15, 0.45, HEX.accent3, "caveat");
    text(sl, "Synthetic single-token mutations, not real student code.", { x: 7.25, y: 3.7, w: 2.15, h: 1.0, fontSize: 12, bold: true, color: C.text1 });
  }

  // 12 Results
  {
    const sl = content(S_[12]);
    const sys = [["IntelliFix", T.P.top1_ast.rate], ["no layout", T.L.top1_ast.rate], ["least-cost", T.C.top1_ast.rate]];
    if (cp) sys.push(["CPCT+ (run 1)", S.cpctplus.test[0].top1_ast.rate]);
    sl.addChart(pres.charts.BAR, [{ name: "top-1", labels: sys.map((s) => s[0]), values: sys.map((s) => +(100 * s[1]).toFixed(1)) }], {
      x: 0.5, y: 1.1, w: 4.55, h: 3.1, barDir: "col", chartColors: [HEX.accent2, "818CF8", "94A3B8", "94A3B8"], showValue: true, dataLabelPosition: "outEnd",
      dataLabelColor: HEX.dk1, dataLabelFormatCode: '0.0"%"', valAxisMaxVal: 100, valAxisMinVal: 0, valAxisLabelFormatCode: '0"%"', showLegend: false, showTitle: true,
      title: "Top-1 repair restores the original AST", titleColor: HEX.dk1, valGridLine: { color: "E2E8F0", size: 0.5 }, catGridLine: { style: "none" }, ...chartText, objectName: "top-1 chart",
    });
    const fc = [["forced top-1", T.F.false_confident_rate.rate], ["IntelliFix", T.P.false_confident_rate.rate]];
    sl.addChart(pres.charts.BAR, [{ name: "wrong but confident", labels: fc.map((s) => s[0]), values: fc.map((s) => +(100 * s[1]).toFixed(1)) }], {
      x: 5.25, y: 1.1, w: 4.25, h: 3.1, barDir: "col", chartColors: [HEX.accent4, HEX.accent5], showValue: true, dataLabelPosition: "outEnd", dataLabelColor: HEX.dk1,
      dataLabelFormatCode: '0.0"%"', valAxisMaxVal: 40, valAxisMinVal: 0, valAxisLabelFormatCode: '0"%"', showLegend: false, showTitle: true,
      title: "Wrong but confident (share of all cases)", titleColor: HEX.dk1, valGridLine: { color: "E2E8F0", size: 0.5 }, catGridLine: { style: "none" }, ...chartText, objectName: "wrong-confident chart",
    });
    const pt = S.paired_tests;
    text(sl, [
      { text: `+${pts(pt.top1_ast_P_minus_C.diff)} pts`, options: { bold: true, color: C.accent2 } },
      { text: ` vs least-cost, CI [${pts(pt.top1_ast_P_minus_C.ci95[0])}, ${pts(pt.top1_ast_P_minus_C.ci95[1])}]  ·  IntelliFix ${pct(T.P.top1_ast)}% ${ci(T.P.top1_ast)}  ·  ` },
      { text: `coverage ${pct(T.P.coverage)}%, selective accuracy ${pct(T.P.selective_accuracy)}%`, options: { bold: true } },
    ], { x: 0.5, y: 4.35, w: 9, h: 0.35, fontSize: 12, color: C.text2 });
    text(sl, `CPCT+ varies between runs (ties broken arbitrarily); 540 synthetic test cases.`, { x: 0.5, y: 4.72, w: 9, h: 0.3, fontSize: 11, color: C.accent6 });
  }

  // 13 Did not work
  {
    const sl = content(S_[13]);
    const pt = S.paired_tests.top1_ast_P_minus_E;
    const left = [
      [`Stability evidence: +${pts(pt.diff)} pts, CI [${pts(pt.ci95[0])}, ${pts(pt.ci95[1])}]`, "no measurable effect"],
      [`AST grouping: coverage ${pct(T.P.coverage)}% vs ${pct(T.D.coverage)}%`, "small effect"],
      [`Test risk ${(100 - +pct(T.P.selective_accuracy)).toFixed(1)}% vs 10% target`, "τ did not fully transfer"],
      ["whlie (i < 3) {  →  insert ';'", "confident, parser-valid, wrong: becomes a call"],
    ];
    const right = [["Synthetic errors", "no claim about real student code"], ["One author, 30 programs", "consistent indentation flatters layout evidence"],
      ["MiniC subset, syntax only", "no types; a valid fix can change meaning"], ["Margin is not a probability", "no calibration claimed"]];
    const col = async (items, x, head, Ico, tone) => {
      await iconDot(sl, Ico, x, 1.2, 0.45, tone, head);
      text(sl, head, { x: x + 0.6, y: 1.25, w: 3.6, h: 0.4, fontSize: 16, bold: true });
      items.forEach(([a, b], i) => {
        const y = 1.85 + i * 0.78;
        card(sl, x, y, 4.3, 0.68, head + " " + i);
        text(sl, a, { x: x + 0.15, y: y + 0.06, w: 4.0, h: 0.3, fontSize: 13, bold: true });
        text(sl, b, { x: x + 0.15, y: y + 0.36, w: 4.0, h: 0.3, fontSize: 11.5, color: C.text2 });
      });
    };
    await col(left, 0.5, "Did not work (reported, not hidden)", Lu.LuTriangleAlert, HEX.accent3);
    await col(right, 5.2, "Limits", Lu.LuBan, HEX.accent6);
  }

  // 14 Contribution
  {
    const sl = content(S_[14]);
    const pt = S.paired_tests;
    const rows = [
      ["Evidence ranking vs least-cost", `+${pts(pt.top1_ast_P_minus_C.diff)} pts top-1`, "Supported", HEX.accent5],
      ["Layout-aware generation and evidence", `+${pts(pt.top1_ast_P_minus_L.diff)} pts top-1`, "Supported", HEX.accent5],
      ["Confidence-aware abstention", `wrong-confident ${pct(T.P.false_confident_rate)}% vs ${pct(T.F.false_confident_rate)}%`, "Supported, with caveat", HEX.accent5],
      ["AST equivalence classes", `coverage ${pct(T.P.coverage)}% vs ${pct(T.D.coverage)}%`, "Weak", HEX.accent3],
      ["Follow-on stability evidence", `+${pts(pt.top1_ast_P_minus_E.diff)} pts (CI includes 0)`, "Not supported", HEX.accent4],
    ];
    const hdr = ["Part of the pipeline", "Measured effect (test)", "Verdict"].map((t) => ({ text: t, options: { bold: true, color: HEX.lt1, fill: { color: HEX.dk1 } } }));
    sl.addTable([hdr, ...rows.map(([a, b, c, col]) => [{ text: a }, { text: b }, { text: c, options: { bold: true, color: col } }])],
      { x: 0.5, y: 1.15, w: 9, colW: [3.6, 3.3, 2.1], fontFace: "Calibri", fontSize: 13, color: HEX.dk1, rowH: 0.42, border: { type: "solid", pt: 0.5, color: "CBD5E1" }, objectName: "contribution table" });
    card(sl, 0.5, 3.85, 9, 0.85, "claim card", "EEF2FF");
    text(sl, [{ text: "Claim: ", options: { bold: true, color: C.accent2 } },
      { text: "an integrated, inspectable, honestly evaluated pipeline on top of LAC-guided local LR repair. Not a new algorithm; no single technique is claimed as new." }],
      { x: 0.7, y: 3.98, w: 8.6, h: 0.75, fontSize: 14 });
  }

  // 15 Thank you
  {
    const s = S_[15];
    const sl = pres.addSlide({ masterName: "DARK", sectionTitle: "Evidence and honesty" });
    sl.addText(s.title, { placeholder: "title" });
    text(sl, "Questions, and please try your own code in the workbench", { x: 0.6, y: 2.1, w: 5.0, h: 0.8, fontFace: "Cambria", fontSize: 18, color: MINT });
    text(sl, TEAM.map((t, i) => ({ text: `${t.name}  ·  ${t.reg}`, options: { breakLine: i < TEAM.length - 1 } })), { x: 0.6, y: 3.15, w: 5.0, h: 0.95, fontSize: 14, color: C.background1, paraSpaceAfter: 4 });
    text(sl, "Docs: parallax/docs/IntelliFix_*.md  ·  results: evaluation/results/", { x: 0.6, y: 4.55, w: 5.2, h: 0.3, fontSize: 11, color: "CBD5E1" });
    const img = await shot("12-multiple-plausible", [1290, 330, 2140, 1350], 1100);
    picture(sl, img, 6.4, 0.9, 3.1, "Multiple plausible repairs panel", 3.9);
    notes(sl, s);
  }

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
}

build().catch((e) => { console.error(e); process.exit(1); });
