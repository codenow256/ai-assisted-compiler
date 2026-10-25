import { Check, X } from "lucide-react";
import { useState } from "react";
import { useProject } from "../app/ProjectContext";
import type { Edit } from "../types/api";
import { Banner } from "./ui";

/** Accept button with an explicit confirmation listing the replaced ranges. */
export function AcceptRepair({ source, edits, label = "Accept repair", reason }: { source: string; edits: Edit[]; label?: string; reason: string }) {
  const p = useProject();
  const [confirming, setConfirming] = useState(false);
  const stale = p.repair ? p.isStale(p.repair) : false;
  if (!confirming)
    return (
      <button className="btn primary sm" onClick={() => setConfirming(true)} disabled={stale} title={stale ? "Re-run repair first: the editor changed" : undefined}>
        <Check size={13} aria-hidden /> {label}
      </button>
    );
  return (
    <Banner
      tone="info"
      title="Replace the editor content with this repaired program?"
      actions={
        <div className="row">
          <button
            className="btn primary sm"
            onClick={() => {
              p.applyRepair(source, reason);
              setConfirming(false);
            }}
          >
            <Check size={13} aria-hidden /> Apply
          </button>
          <button className="btn sm" onClick={() => setConfirming(false)}>
            <X size={13} aria-hidden /> Cancel
          </button>
        </div>
      }
    >
      {edits.length} edit{edits.length === 1 ? "" : "s"}:{" "}
      {edits.map((e, i) => (
        <span key={i}>
          {i > 0 && ", "}
          {e.op} <code>{e.op === "delete" ? e.removed_text : e.text}</code> at {e.at.line}:{e.at.column}
        </span>
      ))}
      . The original stays in the undo history. IntelliFix validates syntax only — check that the meaning is what you intended.
    </Banner>
  );
}
