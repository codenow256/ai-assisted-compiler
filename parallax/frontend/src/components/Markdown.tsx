import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";

/** Rewrites links to sibling docs (FOO.md, docs/Foo_Bar.md, ../README.md) to in-app routes, and doc images to the API. */
export function rewriteDocLinks(html: string): string {
  const docs = html
    .replace(/href="(?:\.\.\/|\.\/)?(?:docs\/)?([A-Za-z0-9_]+)\.md(#[^"]*)?"/g, (_m, name: string) => `href="/docs/${name}" data-internal="1"`)
    // Images (and links to them) under docs/images are served by the API.
    .replace(/(src|href)="(?:\.\/)?(?:docs\/)?images\/([A-Za-z0-9_\/-]+\.(?:png|jpe?g|svg))"/g, (_m, attr: string, path: string) =>
      attr === "src" ? `src="/api/docs/images/${path}" loading="lazy"` : `href="/api/docs/images/${path}" target="_blank" rel="noopener"`);
  // Other relative links point at repository files the UI does not serve:
  // show them as labelled paths instead of dead links.
  return docs.replace(/<a href="(?!https?:|\/|#|mailto:)([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, '<span class="repo-path" title="Repository file: $1">$2 <small>($1)</small></span>');
}

export function Markdown({ text }: { text: string }) {
  const nav = useNavigate();
  const html = useMemo(() => rewriteDocLinks(DOMPurify.sanitize(marked.parse(text, { async: false }) as string)), [text]);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    if (a?.dataset.internal) {
      e.preventDefault();
      nav(a.getAttribute("href")!);
      window.scrollTo(0, 0);
    }
  };
  return <div className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
