import type { DecisionStatus } from "../types/api";

export interface StatusMeta {
  label: string;
  tone: "success" | "info" | "warning" | "danger" | "neutral";
  short: string;
  meaning: string;
}

// Single source of truth for how decision statuses are presented.
export const STATUS: Record<DecisionStatus | "COMPILER_FAILURE", StatusMeta> = {
  NO_REPAIR_NEEDED: { label: "No repair needed", tone: "success", short: "Valid", meaning: "The program parses without syntax errors." },
  RECOMMENDED: {
    label: "Recommended repair",
    tone: "success",
    short: "Recommended",
    meaning: "One repair is better supported than every structurally different alternative by at least the threshold tau, and it yields a complete parser-validated program.",
  },
  MULTIPLE_PLAUSIBLE: {
    label: "Multiple plausible repairs",
    tone: "warning",
    short: "Alternatives",
    meaning: "Structurally different repairs have similar evidence (margin below tau). IntelliFix ranks them but does not pick one for you.",
  },
  LOW_CONFIDENCE: {
    label: "Low confidence",
    tone: "warning",
    short: "Low confidence",
    meaning: "The best repair needs invented content (a placeholder name or literal) or could not repair every later error.",
  },
  NO_SAFE_REPAIR: { label: "No safe automatic repair", tone: "danger", short: "No repair", meaning: "No bounded edit lets the parser continue far enough past the error." },
  BUDGET_EXHAUSTED: { label: "Search budget exhausted", tone: "danger", short: "Budget", meaning: "The parser-invocation or time budget ran out before the search finished." },
  UNSUPPORTED_CONSTRUCT: {
    label: "Unsupported construct",
    tone: "info",
    short: "Unsupported",
    meaning:
      "The error is a C construct MiniC deliberately omits (rewriting it would change the program's meaning), or the input nests deeper than the parser supports.",
  },
  COMPILER_FAILURE: { label: "Compiler failure", tone: "danger", short: "Failure", meaning: "The compiler failed unexpectedly. This is not a problem with your code." },
};
