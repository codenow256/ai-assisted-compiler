// Beginner-friendly descriptions of the AST node kinds the compiler emits
// (compiler/include/parallax/ast.hpp). Child roles follow the schema there.
import type { AstNode } from "../types/api";

export interface NodeInfo {
  title: string; // what it represents (technical)
  plain: (n: AstNode) => string; // simple English, using the node's real attributes
  role: string; // how it contributes to the program
  childRole: (n: AstNode, i: number) => string;
}

const OP_WORDS: Record<string, string> = {
  "+": "adds", "-": "subtracts", "*": "multiplies", "/": "divides", "%": "takes the remainder of",
  "==": "checks whether two values are equal", "!=": "checks whether two values differ", "<": "checks less-than", "<=": "checks less-than-or-equal",
  ">": "checks greater-than", ">=": "checks greater-than-or-equal", "&&": "is true only if both sides are true", "||": "is true if either side is true", "!": "negates (logical NOT)",
};
const kids = (n: AstNode) => n.children.length;

export const NODE_INFO: Record<string, NodeInfo> = {
  Program: { title: "Program (translation unit)", plain: (n) => `The whole file: ${kids(n)} top-level item${kids(n) === 1 ? "" : "s"} (functions and global declarations).`, role: "Root of the tree. Everything else hangs below it.", childRole: (n, i) => (n.children[i]?.kind === "Function" ? "a function definition" : "a global declaration") },
  Function: { title: "Function definition", plain: (n) => `Defines the function \`${n.name}\`, which returns \`${n.type}\` and takes ${n.children.filter((c) => c.kind === "Param").length} parameter(s).`, role: "A named block of code that can be called. Its last child is the body.", childRole: (n, i) => (n.children[i].kind === "Param" ? `parameter ${i + 1}` : "the body (a block of statements)") },
  Param: { title: "Parameter", plain: (n) => `A parameter \`${n.name}\` of type \`${n.type}\`${n.array ? " (an array)" : ""}; it receives a value when the function is called.`, role: "Declares an input of the enclosing function.", childRole: () => "" },
  DeclStmt: { title: "Declaration statement", plain: (n) => `Declares ${kids(n)} variable${kids(n) === 1 ? "" : "s"} of type \`${n.type}\`.`, role: "Introduces new names; one DeclStmt can declare several variables (`int a, b;`).", childRole: () => "one declared variable" },
  VarDecl: { title: "Variable declarator", plain: (n) => `The variable \`${n.name}\`${n.array ? ` (an array of size ${n.array})` : ""}${n.children.length ? ", with an initial value" : ", without an initial value"}.`, role: "Creates a variable in the current scope.", childRole: () => "the initial value (an expression)" },
  Block: { title: "Block { … }", plain: (n) => `A group of ${kids(n)} statement${kids(n) === 1 ? "" : "s"} between braces; it opens a new scope.`, role: "Statements in a block run in order; variables declared inside are visible only there.", childRole: (_n, i) => `statement ${i + 1}` },
  Assign: { title: "Assignment", plain: (n) => `Stores a new value in ${n.children[0]?.name ? "`" + n.children[0].name + "`" : "a variable"}.`, role: "Changes a variable's value. In MiniC assignment is a statement, not an expression.", childRole: (_n, i) => (i === 0 ? "the target (what is assigned to)" : "the new value (an expression)") },
  If: { title: "If statement", plain: (n) => `Runs a statement only when a condition is true${kids(n) > 2 ? ", otherwise runs the else-part" : ""}.`, role: "Makes a decision.", childRole: (_n, i) => ["the condition", "the then-part (runs when true)", "the else-part (runs when false)"][i] ?? "" },
  While: { title: "While loop", plain: () => "Repeats its body as long as the condition is true.", role: "A loop; the condition is checked before every iteration.", childRole: (_n, i) => ["the condition", "the body (repeated)"][i] ?? "" },
  For: { title: "For loop", plain: () => "A loop with an initialisation, a condition and an update step.", role: "Runs init once, then body and update while the condition holds.", childRole: (n, i) => `${["initialisation", "condition", "update", "body"][i] ?? ""}${n.children[i]?.kind === "Empty" ? " (left empty)" : ""}` },
  Return: { title: "Return statement", plain: (n) => (kids(n) ? "Ends the function and gives back a value." : "Ends the function without a value."), role: "Leaves the enclosing function.", childRole: () => "the returned value" },
  Break: { title: "Break", plain: () => "Leaves the innermost loop immediately.", role: "Loop control.", childRole: () => "" },
  Continue: { title: "Continue", plain: () => "Skips to the next iteration of the innermost loop.", role: "Loop control.", childRole: () => "" },
  ExprStmt: { title: "Expression statement", plain: () => "An expression used as a statement, usually a function call such as `f(1);`.", role: "Evaluates the expression for its effect; the result is discarded.", childRole: () => "the expression" },
  EmptyStmt: { title: "Empty statement", plain: () => "A lone `;` that does nothing.", role: "Valid but has no effect.", childRole: () => "" },
  Ident: { title: "Identifier (name use)", plain: (n) => `Uses the value of \`${n.name}\`.`, role: "Refers to a variable or parameter declared earlier.", childRole: () => "" },
  IntLit: { title: "Integer literal", plain: (n) => `The whole number ${n.value}.`, role: "A constant value.", childRole: () => "" },
  FloatLit: { title: "Floating-point literal", plain: (n) => `The decimal number ${n.value}.`, role: "A constant value.", childRole: () => "" },
  CharLit: { title: "Character literal", plain: (n) => `The character ${n.value}.`, role: "A constant value.", childRole: () => "" },
  BoolLit: { title: "Boolean literal", plain: (n) => `The truth value ${n.value}.`, role: "A constant value.", childRole: () => "" },
  Unary: { title: "Unary operation", plain: (n) => (n.op === "-" ? "Negates the value below it (unary minus)." : `Applies \`${n.op}\`: it ${OP_WORDS[n.op ?? ""] ?? "transforms"} the value below it.`), role: "An operator with one operand.", childRole: () => "the operand" },
  Binary: { title: "Binary operation", plain: (n) => `The operator \`${n.op}\` ${OP_WORDS[n.op ?? ""] ?? "combines"} ${["+", "-", "*", "/", "%"].includes(n.op ?? "") ? "its left and right values" : "(left vs right)"}.`, role: "An operator with two operands. Nesting encodes precedence: deeper operations are computed first.", childRole: (_n, i) => (i === 0 ? "left operand" : "right operand") },
  Call: { title: "Function call", plain: (n) => `Calls \`${n.name}\` with ${kids(n)} argument${kids(n) === 1 ? "" : "s"}.`, role: "Runs another function and uses its result.", childRole: (_n, i) => `argument ${i + 1}` },
  Index: { title: "Array element", plain: (n) => `Element of the array \`${n.name}\` at the position given below.`, role: "Reads or writes one array element.", childRole: () => "the index expression" },
  Empty: { title: "Empty clause", plain: () => "An optional part that was left out (for example a missing for-loop initialisation).", role: "A placeholder for an absent optional clause; it is part of valid code.", childRole: () => "" },
  Error: { title: "Error placeholder", plain: () => "Text the parser could not understand and skipped during recovery.", role: "Only appears in a partial (recovered) tree, never in the AST of a valid program.", childRole: () => "" },
};

export function infoFor(n: AstNode): NodeInfo {
  return NODE_INFO[n.kind] ?? { title: n.kind, plain: () => "A node of the syntax tree.", role: "", childRole: () => "" };
}

/** Source text covered by a node (UTF-8 byte offsets → string). */
export function nodeSource(source: string, n: AstNode): string {
  const b = new TextEncoder().encode(source);
  return new TextDecoder().decode(b.slice(n.span.start.offset, n.span.end.offset));
}

/** Text matched by search: kind, attributes and plain title. */
export function nodeMatches(n: AstNode, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return false;
  return [n.kind, n.name, n.op, n.value, n.type, infoFor(n).title].some((x) => x && String(x).toLowerCase().includes(s));
}
