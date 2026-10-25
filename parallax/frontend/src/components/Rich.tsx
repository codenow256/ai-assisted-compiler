import { Fragment } from "react";

/** Renders `code` and **bold** in explanation strings (text only, no HTML). */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((s, i) =>
        s.startsWith("`") && s.endsWith("`") && s.length > 1 ? <code key={i}>{s.slice(1, -1)}</code> : s.startsWith("**") && s.endsWith("**") && s.length > 4 ? <strong key={i}><Rich text={s.slice(2, -2)} /></strong> : <Fragment key={i}>{s}</Fragment>,
      )}
    </>
  );
}
