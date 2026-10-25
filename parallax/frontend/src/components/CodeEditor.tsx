// CodeMirror 6 editor with MiniC highlighting and byte-offset highlights.
// Highlights arrive as UTF-8 byte ranges from the compiler and are converted
// to UTF-16 positions with OffsetMap, so non-ASCII comments do not shift them.
import { useEffect, useRef } from "react";
import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { OffsetMap } from "../lib/positions";

const KEYWORDS = new Set(["if", "else", "while", "for", "return", "break", "continue"]);
const TYPES = new Set(["int", "float", "char", "bool", "void"]);
const ATOMS = new Set(["true", "false"]);

// Display-only tokenizer for colouring; the real lexer is the Flex scanner.
const minic = StreamLanguage.define<{ inComment: boolean }>({
  startState: () => ({ inComment: false }),
  token(stream, state) {
    if (state.inComment) {
      if (stream.skipTo("*/")) {
        stream.match("*/");
        state.inComment = false;
      } else stream.skipToEnd();
      return "comment";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.inComment = true;
      return "comment";
    }
    if (stream.match(/^'(?:[^'\\]|\\.)*'?/)) return "string";
    if (stream.match(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) return "number";
    const word = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/) as RegExpMatchArray | null;
    if (word) {
      const w = word[0];
      if (KEYWORDS.has(w)) return "keyword";
      if (TYPES.has(w)) return "typeName";
      if (ATOMS.has(w)) return "atom";
      return stream.peek() === "(" ? "function" : "variableName";
    }
    if (stream.match(/^(==|!=|<=|>=|&&|\|\||[+\-*/%=<>!])/)) return "operator";
    if (stream.match(/^[(){}[\];,]/)) return "punctuation";
    stream.next();
    return "invalid";
  },
  languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } } },
});

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--accent)", fontWeight: "600" },
  { tag: t.typeName, color: "var(--teal)", fontWeight: "600" },
  { tag: t.atom, color: "var(--warning)" },
  { tag: t.number, color: "var(--warning)" },
  { tag: t.string, color: "var(--success)" },
  { tag: t.comment, color: "var(--text-faint)", fontStyle: "italic" },
  { tag: t.function(t.variableName), color: "var(--info)" },
  { tag: t.operator, color: "var(--text-muted)" },
  { tag: t.invalid, color: "var(--danger)", textDecoration: "underline wavy" },
]);

const theme = EditorView.theme({
  "&": { backgroundColor: "var(--surface)", color: "var(--text)" },
  ".cm-content": { fontFamily: "var(--font-mono)", caretColor: "var(--accent)", padding: "8px 0", fontVariantLigatures: "none" },
  ".cm-gutters": { backgroundColor: "var(--surface-2)", color: "var(--text-faint)", border: "none", borderRight: "1px solid var(--border)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--accent) 5%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--hl-select) !important" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  ".cm-scroller": { overflow: "auto" },
});

export interface EditorHighlight {
  from: number; // UTF-8 byte offsets
  to: number;
  tone?: "error" | "select" | "edit";
}

const setHighlights = StateEffect.define<{ ranges: EditorHighlight[]; scroll: boolean }>();
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setHighlights)) {
        const map = new OffsetMap(tr.state.doc.toString());
        const len = tr.state.doc.length;
        const marks = e.value.ranges
          .map((r) => {
            let from = Math.min(map.toUtf16(r.from), len);
            let to = Math.min(map.toUtf16(r.to), len);
            if (to <= from) {
              // zero-width (e.g. an insertion point or EOF): mark one character
              if (from < len) to = from + 1;
              else if (from > 0) from = from - 1;
              else return null;
            }
            return Decoration.mark({ class: `cm-hl-${r.tone ?? "select"}` }).range(from, to);
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
          .sort((a, b) => a.from - b.from);
        deco = Decoration.set(marks, true);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

interface Props {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  highlights?: EditorHighlight[];
  minHeight?: number;
  maxHeight?: number;
  ariaLabel?: string;
  extraKeys?: Extension;
}

export function CodeEditor({ value, onChange, readOnly, highlights, minHeight = 260, maxHeight = 640, ariaLabel = "MiniC source editor", extraKeys }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          minic,
          syntaxHighlighting(highlight),
          highlightField,
          theme,
          EditorView.theme({ "&": { minHeight: `${minHeight}px`, maxHeight: `${maxHeight}px` }, ".cm-scroller": { minHeight: `${minHeight}px` } }),
          EditorState.readOnly.of(!!readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
          extraKeys ?? [],
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // The editor is created once; value/highlight changes are dispatched below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const ranges = highlights ?? [];
    v.dispatch({ effects: setHighlights.of({ ranges, scroll: true }) });
    if (ranges.length) {
      const map = new OffsetMap(v.state.doc.toString());
      const pos = Math.min(map.toUtf16(ranges[0].from), v.state.doc.length);
      v.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    }
  }, [highlights, value]);

  return <div className="editor-shell" ref={host} />;
}
