// Builds deliverables/IntelliFix_Final_Presentation.pptx: the implementation-focused
// version (26 Oct 2026). The five-step Workspace and the correction workflow are the
// focus; research is one brief, conceptual slide. The previous research-heavy deck is
// kept as deliverables/IntelliFix_Final_Presentation_previous.pptx.
// Screenshots: docs/images/walkthrough (take_screenshots_v2.cjs / _v3.cjs, real app).
// The few numbers quoted are checked against evaluation/results/summary.json.
// Usage (from parallax/): node deliverables/build/build_implementation_presentation.js
"use strict";
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const sharp = require("sharp");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const Lu = require("react-icons/lu");
const { TEAM, SLIDES } = require("./implementation_slides_content");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "deliverables", "IntelliFix_Final_Presentation.pptx");
const SHOTS = path.join(ROOT, "docs", "images", "walkthrough");
const S = JSON.parse(fs.readFileSync(path.join(ROOT, "evaluation/results/summary.json"), "utf8"));
const T = S.test;
const pct = (x) => (100 * x.rate).toFixed(1);
{
  const need = [[pct(T.P.top1_ast), "71.5"], [pct(T.C.top1_ast), "55.2"], [pct(T.F.false_confident_rate), "28.5"], [pct(T.P.false_confident_rate), "6.1"]];
  const bad = need.filter(([x, y]) => x !== y);
  if (bad.length) throw new Error("research slide numbers are out of date: " + JSON.stringify(bad));
}

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
const section = (n) => (n <= 5 ? "Idea and architecture" : n <= 13 ? "The correction workflow" : "Evidence and limits");
const chartText = { catAxisLabelColor: HEX.dk2, valAxisLabelColor: HEX.accent6, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt",
  dataLabelFontFace: "+mn-lt", titleFontFace: "+mn-lt", catAxisLabelFontSize: 11, valAxisLabelFontSize: 10, dataLabelFontSize: 11, titleFontSize: 13 };

// ------------------------------------------------------------------ slides
async function build() {
  const S_ = Object.fromEntries(SLIDES.map((s) => [s.n, s]));
  const caption = (sl, t, x, y, w) => text(sl, t, { x, y, w, h: 0.3, fontSize: 10.5, color: C.accent6, italic: true });
  const bullets = (sl, items, x, y, w, h, size = 13) => text(sl, items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < items.length - 1 } })), { x, y, w, h, fontSize: size, paraSpaceAfter: 6 });
  const box = (sl, x, y, w, h, title, body, color, name) => {
    sl.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.08, fill: { color: HEX.lt2 }, line: { color, width: 1.25 }, objectName: name });
    text(sl, [{ text: title, options: { bold: true, color, fontSize: 13, breakLine: true } }, { text: body, options: { fontSize: 10.5, color: HEX.dk2 } }], { x: x + 0.1, y: y + 0.08, w: w - 0.2, h: h - 0.12, valign: "top" });
  };
  const arrow = (sl, x1, y1, x2, y2, name, color = HEX.accent6) => sl.addShape(pres.shapes.LINE, { x: x1, y: y1, w: x2 - x1, h: y2 - y1, line: { color, width: 1.5, endArrowType: "triangle" }, objectName: name });
  const flow = (sl, items, y, h, name) => {
    const n = items.length, gap = 0.28, w = (9.0 - gap * (n - 1)) / n;
    items.forEach(([t, b, col], i) => {
      const x = 0.5 + i * (w + gap);
      box(sl, x, y, w, h, t, b, col, `${name} ${i + 1}`);
      if (i < n - 1) arrow(sl, x + w + 0.03, y + h / 2, x + w + gap - 0.03, y + h / 2, `${name} arrow ${i + 1}`);
    });
  };
  const content = (n) => { const s = S_[n]; const sl = pres.addSlide({ masterName: "CONTENT", sectionTitle: section(n) }); sl.addText(s.title, { placeholder: "title" }); notes(sl, s); return sl; };

  pres.addSection({ title: "Idea and architecture" });
  // 1 Title (dark)
  {
    const s = S_[1];
    const sl = pres.addSlide({ masterName: "DARK", sectionTitle: section(1) });
    sl.addText(s.title, { placeholder: "title" });
    text(sl, "An Intelligent Compiler for Syntax Error Analysis, Detection, and Correction", { x: 0.6, y: 2.05, w: 4.9, h: 0.75, fontFace: "Cambria", fontSize: 18, color: MINT });
    text(sl, TEAM.map((t, i) => ({ text: `${t.name}  ·  ${t.reg}`, options: { breakLine: i < TEAM.length - 1 } })), { x: 0.6, y: 3.05, w: 4.9, h: 0.95, fontSize: 14, color: C.background1, paraSpaceAfter: 4 });
    text(sl, "BCSE307P course project  ·  Guide: [guide name, to be added]", { x: 0.6, y: 4.55, w: 4.9, h: 0.3, fontSize: 11, color: "CBD5E1" });
    picture(sl, await shot("v3-workspace", [0, 0, 1716, 1180], 1500), 5.9, 1.0, 3.6, "Workspace screenshot (real run)", 3.9);
    notes(sl, s);
  }
  // 2 Why hard
  {
    const sl = content(2);
    const items = [
      [Lu.LuTarget, HEX.accent4, "Noticed late", "The parser reports where it got stuck, often one line after the real mistake."],
      [Lu.LuLayers, HEX.accent3, "Errors hide errors", "After the first error the parser has to guess how to continue; later reports may be side effects."],
      [Lu.LuSplit, HEX.accent2, "Many fixes parse", "Different edits make the code valid again, and they can mean very different programs."],
    ];
    for (const [i, [Ic, col, h, b]] of items.entries()) {
      const x = 0.6 + i * 3.0;
      card(sl, x, 1.35, 2.75, 3.2, `problem card ${i + 1}`);
      await iconDot(sl, Ic, x + 0.25, 1.6, 0.6, col, `problem ${i + 1}`);
      text(sl, h, { x: x + 0.25, y: 2.35, w: 2.3, h: 0.45, fontFace: "Cambria", fontSize: 17, bold: true });
      text(sl, b, { x: x + 0.25, y: 2.85, w: 2.3, h: 1.5, fontSize: 13, color: C.text2 });
    }
    text(sl, "A good tool must explain the first, handle the second, and not guess on the third.", { x: 0.6, y: 4.7, w: 8.8, h: 0.35, fontSize: 13, italic: true, color: C.accent1, align: "center" });
  }
  // 3 Idea
  {
    const sl = content(3);
    flow(sl, [
      ["Lexer", "characters → tokens", HEX.accent1],
      ["Parser", "tokens → tree, or the first error", HEX.accent1],
      ["Repair engine", "small edits, each re-checked by the parser", HEX.accent2],
      ["You decide", "accept, answer a question, or write it yourself", HEX.accent3],
      ["Re-check", "the whole program is analysed again", HEX.accent5],
    ], 1.6, 1.05, "pipeline");
    sl.addShape(pres.shapes.LINE, { x: 8.75, y: 2.65, w: 0, h: 0.85, line: { color: HEX.accent6, width: 1.5 }, objectName: "loop down" });
    sl.addShape(pres.shapes.LINE, { x: 2.35, y: 3.5, w: 6.4, h: 0, line: { color: HEX.accent6, width: 1.5 }, objectName: "loop back" });
    arrow(sl, 2.35, 3.5, 2.35, 2.68, "loop up");
    text(sl, "until every check passes", { x: 3.5, y: 3.55, w: 4.0, h: 0.3, fontSize: 11, italic: true, color: C.accent6, align: "center" });
    text(sl, [{ text: "Real, not simulated: ", options: { bold: true } }, { text: "every result is a fresh compiler run, and every proposal is checked by the real parser before it can be applied." }], { x: 0.8, y: 4.2, w: 8.4, h: 0.6, fontSize: 13, align: "center" });
  }
  // 4 Architecture
  {
    const sl = content(4);
    const cols = [
      [Lu.LuMonitor, HEX.accent2, "Browser", "React interface", ["Workspace: the five-step journey", "AST Explorer", "Research & Method"]],
      [Lu.LuServer, HEX.accent1, "Backend", "Python, FastAPI", ["Runs the compiler safely: no shell, timeout, size limit", "Compares two trees", "Typed errors, never fake output"]],
      [Lu.LuCpu, HEX.accent3, "Compiler", "C++, Flex + Bison", ["Lexer, LALR(1) parser, AST", "Name check", "Repair engine → JSON"]],
    ];
    for (const [i, [Ic, col, h, sub, pts]] of cols.entries()) {
      const x = 0.55 + i * 3.05;
      card(sl, x, 1.3, 2.7, 3.35, `layer ${h}`);
      await iconDot(sl, Ic, x + 0.2, 1.45, 0.55, col, `layer ${i + 1}`);
      text(sl, h, { x: x + 0.9, y: 1.47, w: 1.7, h: 0.32, fontFace: "Cambria", fontSize: 17, bold: true });
      text(sl, sub, { x: x + 0.9, y: 1.78, w: 1.75, h: 0.28, fontSize: 11, color: C.accent6 });
      bullets(sl, pts, x + 0.2, 2.25, 2.35, 2.2, 12);
      if (i < 2) arrow(sl, x + 2.73, 2.95, x + 3.02, 2.95, `layer arrow ${i + 1}`);
    }
    text(sl, "Every answer remembers the exact text it was computed for, so the screen never mixes an old result with new code.", { x: 0.6, y: 4.78, w: 8.8, h: 0.35, fontSize: 12, italic: true, color: C.accent6, align: "center" });
  }
  // 5 Text → tokens → tree
  {
    const sl = content(5);
    text(sl, "int x = 1 + 2 * 3;", { x: 0.6, y: 1.25, w: 4.0, h: 0.4, fontFace: "Courier New", fontSize: 18, bold: true });
    text(sl, "Lexer: spelling", { x: 0.6, y: 1.8, w: 4, h: 0.3, fontSize: 12, bold: true, color: C.accent1 });
    const toks = ["int", "x", "=", "1", "+", "2", "*", "3", ";"];
    toks.forEach((t, i) => {
      const x = 0.6 + i * 0.47;
      sl.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 2.15, w: 0.4, h: 0.4, rectRadius: 0.06, fill: { color: HEX.lt2 }, line: { color: HEX.accent1, width: 1 }, objectName: `token ${i + 1}` });
      text(sl, t, { x, y: 2.15, w: 0.4, h: 0.4, fontFace: "Courier New", fontSize: 13, bold: true, align: "center", valign: "middle" });
    });
    text(sl, "Parser: order and structure", { x: 0.6, y: 2.8, w: 4, h: 0.3, fontSize: 12, bold: true, color: C.accent2 });
    bullets(sl, ["Checks the token order against the grammar", "Builds the tree; punctuation disappears", "Not checked here: types and behaviour"], 0.6, 3.15, 4.2, 1.5, 12.5);
    // tree
    const node = (t, x, y, col, name) => { sl.addShape(pres.shapes.OVAL, { x: x - 0.28, y: y - 0.2, w: 0.56, h: 0.4, fill: { color: HEX.lt1 }, line: { color: col, width: 1.5 }, objectName: name }); text(sl, t, { x: x - 0.4, y: y - 0.2, w: 0.8, h: 0.4, fontFace: "Courier New", fontSize: 12, bold: true, align: "center", valign: "middle" }); };
    const edge = (x1, y1, x2, y2, n) => sl.addShape(pres.shapes.LINE, { x: x1, y: y1 + 0.2, w: x2 - x1, h: y2 - y1 - 0.4, line: { color: "94A3B8", width: 1 }, flipH: x2 < x1, objectName: n });
    const P = { decl: [7.0, 1.45], x: [7.0, 2.15], plus: [7.0, 2.85], one: [6.2, 3.55], times: [7.8, 3.55], two: [7.3, 4.25], three: [8.3, 4.25] };
    const lines = [["decl", "x"], ["x", "plus"], ["plus", "one"], ["plus", "times"], ["times", "two"], ["times", "three"]];
    lines.forEach(([a, b], i) => { const [x1, y1] = P[a], [x2, y2] = P[b]; if (x2 >= x1) edge(x1, y1, x2, y2, `edge ${i}`); else sl.addShape(pres.shapes.LINE, { x: x2, y: y1 + 0.2, w: x1 - x2, h: y2 - y1 - 0.4, line: { color: "94A3B8", width: 1 }, flipH: true, objectName: `edge ${i}` }); });
    node("int", ...P.decl, HEX.accent2, "DeclStmt"); node("x", ...P.x, HEX.accent2, "VarDecl"); node("+", ...P.plus, HEX.accent3, "Binary plus");
    node("1", ...P.one, HEX.accent5, "IntLit 1"); node("*", ...P.times, HEX.accent3, "Binary times"); node("2", ...P.two, HEX.accent5, "IntLit 2"); node("3", ...P.three, HEX.accent5, "IntLit 3");
    caption(sl, "The tree's shape says 2 * 3 happens first", 5.6, 4.7, 3.6);
  }

  pres.addSection({ title: "The correction workflow" });
  // 6 Five steps
  {
    const sl = content(6);
    picture(sl, await shot("v3-stepper-done", null, 1700), 0.5, 1.2, 9.0, "Step indicator (real run)");
    const steps = [["Code", "write or load MiniC, press Analyze"], ["Diagnosis", "what was found, where, and why"], ["Fixes", "checked options, or a question"], ["Tree", "what the fix changes in the structure"], ["Apply & verify", "re-analyse everything; next error or done"]];
    steps.forEach(([h, b], i) => {
      const x = 0.5 + i * 1.84;
      box(sl, x, 2.1, 1.72, 1.15, `${i + 1}  ${h}`, b, [HEX.accent1, HEX.accent2, HEX.accent2, HEX.accent3, HEX.accent5][i], `step card ${i + 1}`);
    });
    text(sl, "One page, one journey: the indicator always shows where you are, what is done and what is not needed.", { x: 0.6, y: 3.6, w: 8.8, h: 0.6, fontSize: 14, align: "center", color: C.text2 });
  }
  // 7 Diagnosis
  {
    const sl = content(7);
    picture(sl, await shot("v3-reports", null, 1100), 0.5, 1.15, 4.6, "Error reports with roles (real run)", 3.85);
    bullets(sl, [
      "All errors the parser can report for this version",
      "The first is reliable: everything before it parsed",
      "Later ones: likely a consequence, or likely independent — with the evidence",
      "Honest: more errors may appear once earlier ones are fixed",
      "Lexer, parser and meaning kept apart",
    ], 5.45, 1.25, 4.05, 3.6, 14);
  }
  // 8 Fixes concept
  {
    const sl = content(8);
    const stages = [[Lu.LuWrench, HEX.accent2, "Generate", "small edits near the error, guided by the grammar and the layout"], [Lu.LuShieldCheck, HEX.accent1, "Check", "the real parser re-runs on every candidate"], [Lu.LuListChecks, HEX.accent3, "Rank", "same program → one option; named, readable evidence"], [Lu.LuCircleHelp, HEX.accent5, "Decide", "recommend only a clear winner; otherwise ask"]];
    for (const [i, [Ic, col, h, b]] of stages.entries()) {
      const x = 0.55 + i * 2.3;
      card(sl, x, 1.3, 2.05, 2.55, `stage ${h}`);
      await iconDot(sl, Ic, x + 0.72, 1.45, 0.6, col, `stage ${i + 1}`);
      text(sl, h, { x: x + 0.1, y: 2.15, w: 1.85, h: 0.4, fontFace: "Cambria", fontSize: 17, bold: true, align: "center" });
      text(sl, b, { x: x + 0.12, y: 2.6, w: 1.8, h: 1.2, fontSize: 12, color: C.text2, align: "center" });
      if (i < 3) arrow(sl, x + 2.07, 2.55, x + 2.28, 2.55, `stage arrow ${i + 1}`);
    }
    text(sl, [{ text: "The score ranks options; it is not a probability. ", options: { bold: true } }, { text: "A fix is recommended only if it clearly leads every different alternative." }], { x: 0.6, y: 4.15, w: 8.8, h: 0.6, fontSize: 13, align: "center" });
  }
  // 9 One error at a time
  {
    const sl = content(9);
    const loop = [["Analyse", HEX.accent1], ["Explain", HEX.accent1], ["Propose", HEX.accent2], ["You confirm", HEX.accent3], ["Apply", HEX.accent3], ["Re-analyse all", HEX.accent5], ["Next error", HEX.accent2]];
    const cx = 2.6, cy = 3.05, rx = 1.75, ry = 1.45;
    loop.forEach(([t, col], i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / loop.length;
      const x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a);
      sl.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x - 0.62, y: y - 0.2, w: 1.24, h: 0.4, rectRadius: 0.08, fill: { color: col }, line: { color: col }, objectName: `loop step ${i + 1}` });
      text(sl, t, { x: x - 0.62, y: y - 0.2, w: 1.24, h: 0.4, fontSize: 11, bold: true, color: C.background1, align: "center", valign: "middle" });
    });
    text(sl, "until every check passes", { x: cx - 0.9, y: cy - 0.18, w: 1.8, h: 0.36, fontSize: 11, italic: true, color: C.accent6, align: "center", valign: "middle" });
    picture(sl, await shot("v3-next-error", null, 1100), 5.0, 1.2, 4.5, "After one fix: what changed and the next error (real run)", 3.7);
  }
  // 10 Ask
  {
    const sl = content(10);
    picture(sl, await shot("v3-question-answered", [0, 0, 839, 1000], 1100), 0.5, 1.15, 3.9, "The clarification question (real run)", 3.95);
    bullets(sl, [
      "The code alone cannot say what was meant",
      "A short question in plain words",
      "Real alternatives — or type your own value or line",
      "Every answer is checked by the real parser first",
      "Missing values are never invented",
    ], 4.8, 1.3, 4.7, 3.5, 15);
  }
  // 11 Safety
  {
    const sl = content(11);
    text(sl, "Parses, but changes the program", { x: 0.5, y: 1.15, w: 4.4, h: 0.3, fontSize: 13, bold: true, color: C.accent4 });
    picture(sl, await shot("v3-full-plan-warning", null, 1000), 0.5, 1.5, 4.4, "Warning on a destructive plan (real run)", 1.6);
    text(sl, "Unsupported C: explain and rewrite", { x: 5.1, y: 1.15, w: 4.4, h: 0.3, fontSize: 13, bold: true, color: C.accent1 });
    picture(sl, await shot("v3-rewrite", null, 1000), 5.1, 1.5, 4.4, "Rewrite for ++ (real run)", 1.9);
    bullets(sl, ["Removing an operator, name or value is flagged and never recommended", "Punctuation-only fixes (a missing ;) stay recommended", "“The parser accepts it” is kept apart from “it is what you meant”"], 0.6, 3.85, 8.8, 1.2, 13);
  }
  // 12 Tree
  {
    const sl = content(12);
    picture(sl, await shot("v2-el-ast-grid", [560, 0, 1665, 1060], 1400), 0.5, 1.15, 5.6, "AST Explorer: tree and node card (real run)", 3.9);
    bullets(sl, ["Errors → a partial tree, labelled; nothing invented", "After a fix: the complete tree and what changed", "Click a node ↔ its code", "Each node: its role, its grammar rule, an expression diagram"], 6.1, 1.3, 3.4, 3.6, 13.5);
  }
  // 13 Verify
  {
    const sl = content(13);
    picture(sl, await shot("v3-completion", [0, 0, 839, 640], 1100), 0.5, 1.15, 4.6, "Completion summary (real run)", 3.55);
    bullets(sl, ["“Done” only when the latest code passes every check IntelliFix really performs", "Lists the corrections made", "States what is not checked: types, run-time, code generation", "A wrong variable name blocks completion", "Undo restores any earlier version"], 5.45, 1.25, 4.05, 3.6, 14);
  }

  pres.addSection({ title: "Evidence and limits" });
  // 14 Research brief
  {
    const sl = content(14);
    text(sl, "Does ranking by evidence, and asking when unsure, beat simply taking the cheapest edit?", { x: 0.8, y: 1.2, w: 8.4, h: 0.65, fontFace: "Cambria", fontSize: 18, italic: true, align: "center", color: C.text2 });
    const take = [[Lu.LuBadgeCheck, HEX.accent1, "Better first suggestions", "The top fix matched the intended program clearly more often than the cheapest-edit baseline."], [Lu.LuShieldCheck, HEX.accent5, "Fewer confident mistakes", "Asking instead of guessing sharply reduced wrong fixes presented as certain."]];
    for (const [i, [Ic, col, h, b]] of take.entries()) {
      const x = 0.8 + i * 4.3;
      card(sl, x, 2.1, 4.0, 1.85, `takeaway ${i + 1}`);
      await iconDot(sl, Ic, x + 0.2, 2.3, 0.55, col, `takeaway ${i + 1}`);
      text(sl, h, { x: x + 0.9, y: 2.3, w: 3.0, h: 0.45, fontFace: "Cambria", fontSize: 16, bold: true });
      text(sl, b, { x: x + 0.9, y: 2.78, w: 3.0, h: 1.1, fontSize: 12.5, color: C.text2 });
    }
    text(sl, `Synthetic benchmark, no user study yet: supporting evidence, not proof. (Top-1 ${pct(T.P.top1_ast)}% vs ${pct(T.C.top1_ast)}%; confident mistakes ${pct(T.F.false_confident_rate)}% → ${pct(T.P.false_confident_rate)}%.)`, { x: 0.8, y: 4.2, w: 8.4, h: 0.6, fontSize: 11.5, italic: true, color: C.accent6, align: "center" });
  }
  // 15 Limits + thanks (dark)
  {
    const s = S_[15];
    const sl = pres.addSlide({ masterName: "DARK", sectionTitle: section(15) });
    text(sl, "Limits and next steps", { x: 0.6, y: 0.5, w: 8.8, h: 0.7, fontFace: "Cambria", fontSize: 30, bold: true, color: C.background1 });
    text(sl, "Honest limits", { x: 0.6, y: 1.45, w: 4.2, h: 0.35, fontSize: 15, bold: true, color: MINT });
    text(sl, ["MiniC is a teaching subset of C", "Syntax and names are checked; types and behaviour are not", "Evaluation is synthetic; no user study yet"].map((t, i, a) => ({ text: t, options: { bullet: true, breakLine: i < a.length - 1 } })), { x: 0.6, y: 1.85, w: 4.2, h: 2.0, fontSize: 14, color: C.background1, paraSpaceAfter: 6 });
    text(sl, "Next", { x: 5.2, y: 1.45, w: 4.2, h: 0.35, fontSize: 15, bold: true, color: MINT });
    text(sl, ["Real student errors", "A user study of the question flow", "Type checking"].map((t, i, a) => ({ text: t, options: { bullet: true, breakLine: i < a.length - 1 } })), { x: 5.2, y: 1.85, w: 4.2, h: 2.0, fontSize: 14, color: C.background1, paraSpaceAfter: 6 });
    text(sl, "Thank you — questions? Try your own code.", { x: 0.6, y: 4.3, w: 8.8, h: 0.5, fontFace: "Cambria", fontSize: 20, color: MINT, align: "center" });
    notes(sl, s);
  }

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
}
build().catch((e) => { console.error(e); process.exit(1); });
