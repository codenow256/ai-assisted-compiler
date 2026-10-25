// Renders the report/paper figures to deliverables/build/figures/*.png.
// Charts are drawn from evaluation/results/summary.json; nothing is typed in.
// Usage (from parallax/): node deliverables/build/make_figures.cjs
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(__dirname, "figures");
fs.mkdirSync(OUT, { recursive: true });
const S = JSON.parse(fs.readFileSync(path.join(ROOT, "evaluation/results/summary.json"), "utf8"));
const T = S.test;
const FONT = "'Liberation Serif', 'Times New Roman', serif";
const INK = "#1E293B", MUTED = "#64748B", GRID = "#E2E8F0", TEAL = "#0F766E", INDIGO = "#4F46E5", RED = "#B91C1C", GREEN = "#15803D", GREY = "#94A3B8";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function page(svg, w, h) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">${svg}</svg></body></html>`;
}

function box(x, y, w, h, title, sub, fill = "#F1F5F9", stroke = "#CBD5E1", tc = INK) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
  <text x="${x + w / 2}" y="${y + h / 2 - (sub ? 8 : -6)}" text-anchor="middle" font-size="19" font-weight="bold" fill="${tc}">${esc(title)}</text>
  ${sub ? sub.map((s, i) => `<text x="${x + w / 2}" y="${y + h / 2 + 16 + i * 19}" text-anchor="middle" font-size="15" fill="${MUTED}">${esc(s)}</text>`).join("") : ""}`;
}
const arrow = (x1, y1, x2, y2, label) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-width="1.8" marker-end="url(#a)"/>` +
  (label ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 8}" text-anchor="middle" font-size="14" fill="${MUTED}">${esc(label)}</text>` : "");
const defs = `<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${INK}"/></marker></defs>`;

function architecture() {
  const w = 1100, h = 330;
  let s = defs;
  s += box(20, 70, 300, 170, "Web interface", ["React + TypeScript", "workbench, stage views,", "evaluation dashboard"]);
  s += box(400, 70, 300, 170, "Backend API", ["FastAPI (Python)", "validation, limits, timeouts,", "LR-state lookup, results"]);
  s += box(780, 70, 300, 170, "parallaxc", ["C++17 native compiler", "Flex lexer · Bison parser", "repair engine → JSON"], "#ECFDF5", "#99F6E4");
  s += arrow(320, 135, 398, 135, "HTTP JSON");
  s += arrow(398, 180, 322, 180, "");
  s += arrow(700, 135, 778, 135, "stdin source");
  s += arrow(778, 180, 702, 180, "");
  s += `<text x="740" y="205" text-anchor="middle" font-size="14" fill="${MUTED}">stdout JSON</text>`;
  s += `<text x="360" y="205" text-anchor="middle" font-size="14" fill="${MUTED}">envelope</text>`;
  s += `<text x="550" y="290" text-anchor="middle" font-size="15" fill="${MUTED}">One subprocess per request (worker thread, bounded concurrency); the backend never computes or simulates a result.</text>`;
  return [page(s, w, h), w, h];
}

function pipeline() {
  const st = [["Lex", "Flex"], ["Parse", "Bison LALR(1)"], ["Localise", "first error, LAC"], ["Generate", "bounded edits"], ["Validate", "parse + round trip"], ["Rank & group", "13 features · classes"], ["Lanes", "later errors"], ["Decide", "7 statuses, τ"]];
  const bw = 150, gap = 20, w = st.length * (bw + gap) + 20, h = 210;
  let s = defs;
  st.forEach(([t, d], i) => {
    const x = 20 + i * (bw + gap);
    const fill = i < 2 ? "#F1F5F9" : i < 7 ? "#ECFDF5" : "#EEF2FF";
    s += `<rect x="${x}" y="40" width="${bw}" height="110" rx="10" fill="${fill}" stroke="#CBD5E1" stroke-width="1.5"/>`;
    s += `<circle cx="${x + bw / 2}" cy="40" r="15" fill="${i < 2 ? MUTED : i < 7 ? TEAL : INDIGO}"/><text x="${x + bw / 2}" y="46" text-anchor="middle" font-size="16" font-weight="bold" fill="#fff">${i + 1}</text>`;
    s += `<text x="${x + bw / 2}" y="90" text-anchor="middle" font-size="18" font-weight="bold" fill="${INK}">${esc(t)}</text>`;
    s += `<text x="${x + bw / 2}" y="118" text-anchor="middle" font-size="14" fill="${MUTED}">${esc(d)}</text>`;
    if (i < st.length - 1) s += arrow(x + bw + 2, 95, x + bw + gap - 2, 95);
  });
  s += `<text x="${w / 2}" y="190" text-anchor="middle" font-size="15" fill="${MUTED}">Stages 1–2: front end · 3–7: repair engine · 8: decision. Every stage is executed by parallaxc and reported with its status and time.</text>`;
  return [page(s, w, h), w, h];
}

function barChart(title, rows, max, fmt, colors, w = 900, h = 430) {
  const L = 70, R = 20, Tp = 60, B = 70, ch = h - Tp - B, cw = w - L - R, bw = Math.min(80, cw / rows.length * 0.55);
  let s = `<text x="${w / 2}" y="30" text-anchor="middle" font-size="21" font-weight="bold" fill="${INK}">${esc(title)}</text>`;
  for (let v = 0; v <= max; v += max / 5) {
    const y = Tp + ch - (v / max) * ch;
    s += `<line x1="${L}" x2="${w - R}" y1="${y}" y2="${y}" stroke="${GRID}"/><text x="${L - 8}" y="${y + 5}" text-anchor="end" font-size="14" fill="${MUTED}">${v.toFixed(0)}%</text>`;
  }
  rows.forEach((r, i) => {
    const cx = L + (i + 0.5) * (cw / rows.length), v = 100 * r.v, y = Tp + ch - (v / max) * ch;
    s += `<rect x="${cx - bw / 2}" y="${y}" width="${bw}" height="${Tp + ch - y}" fill="${colors[i]}"/>`;
    if (r.ci) {
      const y0 = Tp + ch - (100 * r.ci[0] / max) * ch, y1 = Tp + ch - (100 * r.ci[1] / max) * ch;
      s += `<line x1="${cx}" x2="${cx}" y1="${y0}" y2="${y1}" stroke="${INK}" stroke-width="1.5"/><line x1="${cx - 8}" x2="${cx + 8}" y1="${y0}" y2="${y0}" stroke="${INK}" stroke-width="1.5"/><line x1="${cx - 8}" x2="${cx + 8}" y1="${y1}" y2="${y1}" stroke="${INK}" stroke-width="1.5"/>`;
    }
    s += `<text x="${cx + (r.ci ? 14 : 0)}" y="${(r.ci ? Tp + ch - (100 * r.ci[1] / max) * ch : y) - 8}" text-anchor="${r.ci ? "start" : "middle"}" font-size="15" font-weight="bold" fill="${INK}">${fmt(v)}</text>`;
    r.label.split("\n").forEach((ln, j) => { s += `<text x="${cx}" y="${Tp + ch + 22 + j * 18}" text-anchor="middle" font-size="15" fill="${INK}">${esc(ln)}</text>`; });
  });
  s += `<line x1="${L}" x2="${w - R}" y1="${Tp + ch}" y2="${Tp + ch}" stroke="${INK}"/>`;
  return [page(s, w, h), w, h];
}

function top1() {
  const rows = [["P", "IntelliFix\n(full)"], ["E", "no stability\n(E)"], ["D", "no grouping\n(D)"], ["L", "no layout\n(L)"], ["C", "least-cost\n(C)"]]
    .map(([k, l]) => ({ v: T[k].top1_ast.rate, ci: T[k].top1_ast.ci95, label: l }));
  if (S.cpctplus && S.cpctplus.test) rows.push({ v: S.cpctplus.test[0].top1_ast.rate, ci: S.cpctplus.test[0].top1_ast.ci95, label: "CPCT+\n(G, run 1)" });
  return barChart("Top-1 AST match on the test split (n = 540, 95% Wilson CI)", rows, 100, (v) => v.toFixed(1) + "%", [INDIGO, "#818CF8", "#818CF8", "#A5B4FC", GREY, GREY]);
}
function wrongConfident() {
  const rows = [["F", "forced top-1\n(F)"], ["C", "least-cost\n(C)"], ["L", "no layout\n(L)"], ["P", "IntelliFix\n(full)"]].map(([k, l]) => ({ v: T[k].false_confident_rate.rate, ci: T[k].false_confident_rate.ci95, label: l }));
  return barChart("Wrong-but-confident rate (share of all 540 test cases)", rows, 50, (v) => v.toFixed(1) + "%", [RED, GREY, "#A5B4FC", GREEN]);
}
function riskCoverage() {
  const w = 900, h = 460, L = 70, R = 170, Tp = 55, B = 60, cw = w - L - R, ch = h - Tp - B, max = 0.5;
  let s = `<text x="${(w - R + L) / 2}" y="30" text-anchor="middle" font-size="21" font-weight="bold" fill="${INK}">Risk–coverage on the test split</text>`;
  for (let v = 0; v <= max + 1e-9; v += 0.1) { const y = Tp + ch - (v / max) * ch; s += `<line x1="${L}" x2="${L + cw}" y1="${y}" y2="${y}" stroke="${GRID}"/><text x="${L - 8}" y="${y + 5}" text-anchor="end" font-size="14" fill="${MUTED}">${(100 * v).toFixed(0)}%</text>`; }
  for (let c = 0; c <= 1.0001; c += 0.25) { const x = L + c * cw; s += `<text x="${x}" y="${Tp + ch + 22}" text-anchor="middle" font-size="14" fill="${MUTED}">${(100 * c).toFixed(0)}%</text>`; }
  s += `<text x="${L + cw / 2}" y="${h - 12}" text-anchor="middle" font-size="15" fill="${INK}">coverage (cases accepted, most confident first)</text>`;
  s += `<text transform="translate(18 ${Tp + ch / 2}) rotate(-90)" text-anchor="middle" font-size="15" fill="${INK}">risk (errors among accepted)</text>`;
  const series = [["P", INDIGO, "IntelliFix (P)"], ["L", "#A5B4FC", "no layout (L)"], ["C", GREY, "least-cost (C)"]];
  series.forEach(([k, col, name], i) => {
    const pts = T[k].risk_coverage.map((p) => `${(L + p.coverage * cw).toFixed(1)},${(Tp + ch - Math.min(p.risk, max) / max * ch).toFixed(1)}`).join(" ");
    s += `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="3"/>`;
    s += `<line x1="${L + cw + 20}" x2="${L + cw + 48}" y1="${Tp + 20 + i * 28}" y2="${Tp + 20 + i * 28}" stroke="${col}" stroke-width="3"/><text x="${L + cw + 54}" y="${Tp + 25 + i * 28}" font-size="15" fill="${INK}">${esc(name)}</text>`;
    s += `<text x="${L + cw + 54}" y="${Tp + 140 + i * 22}" font-size="14" fill="${MUTED}">AURC ${k}: ${T[k].aurc.toFixed(3)}</text>`;
  });
  const cov = T.P.coverage.rate;
  s += `<line x1="${L + cov * cw}" x2="${L + cov * cw}" y1="${Tp}" y2="${Tp + ch}" stroke="${INDIGO}" stroke-dasharray="5 4"/><text x="${L + cov * cw + 6}" y="${Tp + 16}" font-size="14" fill="${INDIGO}">τ = ${S.tau_selection.tau}: coverage ${(100 * cov).toFixed(1)}%</text>`;
  s += `<line x1="${L}" x2="${L + cw}" y1="${Tp + ch}" y2="${Tp + ch}" stroke="${INK}"/>`;
  return [page(s, w, h), w, h];
}

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ deviceScaleFactor: 2 });
  for (const [name, f] of [["fig_architecture", architecture], ["fig_pipeline", pipeline], ["fig_top1", top1], ["fig_wrong_confident", wrongConfident], ["fig_risk_coverage", riskCoverage]]) {
    const [html, w, h] = f();
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(html);
    await p.screenshot({ path: path.join(OUT, name + ".png"), clip: { x: 0, y: 0, width: w, height: h } });
    console.log("figure", name, w, h);
  }
  await b.close();
})();
