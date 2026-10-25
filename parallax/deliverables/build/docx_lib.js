// Shared helpers for the Word deliverables: a tiny block markup rendered with docx-js.
//
// Block forms accepted by render():
//   "text with **bold** and `code`"      body paragraph
//   { h1 | h2 | h3: "title" }            headings (built-in Heading styles, so the TOC field finds them)
//   { bullets: [..] } / { numbered: [..] }
//   { code: "multi\nline" }
//   { fig: "path.png", caption, width }  figure, caption BELOW (SEQ Figure field)
//   { table: { caption, head: [..], rows: [[..]], widths: [..] } }  caption ABOVE (SEQ Table field)
//   { pagebreak: true }, { raw: Paragraph|Table }
"use strict";
const fs = require("fs");
const d = require("docx");

const FONT = "Times New Roman";
const pt = (n) => Math.round(n * 2); // docx half-points

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// "**bold**", "`code`" and "*italic*" inline
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new d.TextRun({ text: text.slice(last, m.index), ...base }));
    const t = m[0];
    if (t.startsWith("**")) out.push(new d.TextRun({ text: t.slice(2, -2), bold: true, ...base }));
    else if (t.startsWith("`")) out.push(new d.TextRun({ text: t.slice(1, -1), font: "Courier New", size: base.size ? base.size - 2 : undefined, ...(base.color ? { color: base.color } : {}) }));
    else out.push(new d.TextRun({ text: t.slice(1, -1), italics: true, ...base }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new d.TextRun({ text: text.slice(last), ...base }));
  return out;
}

function makeRenderer(opt) {
  // opt: { contentWidthDxa, bodySize, line, tableSize, captionSize, numbering refs, justify }
  const W = opt.contentWidthDxa;
  const bodyPara = (text, extra = {}) => new d.Paragraph({
    children: runs(text), alignment: opt.justify ? d.AlignmentType.JUSTIFIED : d.AlignmentType.LEFT,
    spacing: { line: opt.line, lineRule: d.LineRuleType.AUTO, after: opt.after ?? 120 }, ...extra,
  });
  const caption = (label, text) => new d.Paragraph({
    style: "Caption", keepNext: label === "Table",
    alignment: d.AlignmentType.CENTER,
    children: [new d.TextRun(label + " "), new d.SequentialIdentifier(label), new d.TextRun(". " + text)],
  });
  function cell(text, w, head, align) {
    return new d.TableCell({
      width: { size: w, type: d.WidthType.DXA },
      shading: head ? { type: d.ShadingType.CLEAR, color: "auto", fill: "D9E2F3" } : undefined,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      children: [new d.Paragraph({ alignment: align || d.AlignmentType.LEFT, spacing: { line: 240, after: 0 },
        children: runs(String(text), { size: pt(opt.tableSize), bold: head || undefined }) })],
    });
  }
  function table(t) {
    const widths = t.widths ? t.widths.map((x) => Math.round(x * W)) : t.head.map(() => Math.floor(W / t.head.length));
    widths[widths.length - 1] = W - widths.slice(0, -1).reduce((a, b) => a + b, 0);
    const border = { style: d.BorderStyle.SINGLE, size: 4, color: "808080" };
    const tbl = new d.Table({
      width: { size: W, type: d.WidthType.DXA }, columnWidths: widths,
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
      rows: [
        new d.TableRow({ tableHeader: true, children: t.head.map((h, i) => cell(h, widths[i], true)) }),
        ...t.rows.map((r) => new d.TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, widths[i], false, t.align && t.align[i] === "r" ? d.AlignmentType.RIGHT : undefined)) })),
      ],
    });
    return [caption("Table", t.caption), tbl, new d.Paragraph({ spacing: { after: 120 }, children: [] })];
  }
  function figure(f) {
    const s = pngSize(f.fig);
    const wpx = Math.round((f.width ?? 1) * W / 15); // DXA → px at 96 dpi (1440 DXA = 96 px)
    const hpx = Math.round(wpx * s.h / s.w);
    return [
      new d.Paragraph({ alignment: d.AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60, line: 240, lineRule: d.LineRuleType.AUTO },
        children: [new d.ImageRun({ type: "png", data: fs.readFileSync(f.fig), transformation: { width: wpx, height: hpx }, altText: { title: f.caption, description: f.caption, name: f.caption } })] }),
      caption("Figure", f.caption),
    ];
  }
  function render(blocks) {
    const out = [];
    for (const b of blocks) {
      if (typeof b === "string") out.push(bodyPara(b));
      else if (b.h1) out.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, children: [new d.TextRun(b.h1)], pageBreakBefore: b.newPage !== false && opt.chapterPageBreak }));
      else if (b.h2) out.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_2, children: [new d.TextRun(b.h2)] }));
      else if (b.h3) out.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_3, children: [new d.TextRun(b.h3)] }));
      else if (b.bullets) b.bullets.forEach((t) => out.push(bodyPara(t, { numbering: { reference: "bullets", level: 0 }, spacing: { line: opt.line, lineRule: d.LineRuleType.AUTO, after: 60 } })));
      else if (b.numbered) { const ref = "num" + (opt._n = (opt._n || 0) + 1); opt.numberRefs.push(ref); b.numbered.forEach((t) => out.push(bodyPara(t, { numbering: { reference: ref, level: 0 }, spacing: { line: opt.line, lineRule: d.LineRuleType.AUTO, after: 60 } }))); }
      else if (b.code) out.push(...b.code.split("\n").map((l, i, a) => new d.Paragraph({ spacing: { line: 240, after: i === a.length - 1 ? 160 : 0 }, indent: { left: 360 },
        shading: { type: d.ShadingType.CLEAR, color: "auto", fill: "F2F2F2" }, children: [new d.TextRun({ text: l || " ", font: "Courier New", size: pt(opt.codeSize || 9.5) })] })));
      else if (b.fig) out.push(...figure(b));
      else if (b.table) out.push(...table(b.table));
      else if (b.pagebreak) out.push(new d.Paragraph({ children: [new d.PageBreak()] }));
      else if (b.raw) out.push(b.raw);
      else throw new Error("unknown block " + JSON.stringify(b).slice(0, 80));
    }
    return out;
  }
  return { render, bodyPara, caption, table, figure };
}

function numberingConfig(numberRefs) {
  return {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: d.LevelFormat.BULLET, text: "•", alignment: d.AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
      ...numberRefs.map((r) => ({ reference: r, levels: [{ level: 0, format: d.LevelFormat.DECIMAL, text: "%1.", alignment: d.AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] })),
    ],
  };
}

// docx-js writes SEQ fields with an empty result, so captions read "Figure ." until
// fields are updated. Store the correct number as the field result (Word still
// recomputes it on update).
async function fillSeqResults(buf) {
  const JSZip = require(require.resolve("jszip", { paths: [require.resolve("docx")] }));
  const zip = await JSZip.loadAsync(buf);
  const part = "word/document.xml";
  const n = {};
  const xml = (await zip.file(part).async("string")).replace(
    /(<w:instrText[^>]*>SEQ (\w+)<\/w:instrText><w:fldChar w:fldCharType="separate"\/>)(<w:fldChar w:fldCharType="end"\/>)/g,
    (_, head, label, end) => `${head}<w:t>${(n[label] = (n[label] || 0) + 1)}</w:t>${end}`);
  zip.file(part, xml);
  return { buf: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), counts: n };
}

async function write(doc, file) {
  const { buf, counts } = await fillSeqResults(await d.Packer.toBuffer(doc));
  fs.writeFileSync(file, buf);
  if (Object.keys(counts).length) console.log("  captions:", JSON.stringify(counts));
  console.log("wrote", file);
}

module.exports = { d, FONT, pt, runs, makeRenderer, numberingConfig, write, pngSize };
