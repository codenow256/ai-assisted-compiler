# MiniC language specification

MiniC is a small, C-like teaching language. It is **not** ISO C. Every feature listed here is implemented consistently in the lexer (`compiler/grammar/minic.l`), the grammar (`compiler/grammar/minic.y`), the AST (`compiler/include/parallax/ast.hpp`), the tests and the examples.

## 1. Lexical structure

| Element | Definition |
|---|---|
| Whitespace | space, tab, `\r`, `\f`, `\v`, newline `\n`. Only `\n` starts a new line; CRLF is therefore one line break |
| Line comment | `//` up to the end of the line |
| Block comment | `/* … */`; may span lines; does not nest; an unterminated one is a lexical error |
| Identifier | `[A-Za-z_][A-Za-z0-9_]*`, at most 255 characters; case-sensitive |
| Keywords | `int float char bool void if else while for return break continue true false` |
| Integer literal | decimal digits, value ≤ 2147483647 (no sign: `-1` is unary minus applied to `1`; no hex or octal) |
| Float literal | `digits.digits` with an optional exponent, or `digits` + exponent: `1.5`, `2.0e-3`, `1e5`. Not allowed: `.5`, `5.`, `1e` |
| Char literal | one ASCII character or one of the escapes `\n \t \r \0 \\ \' \"` between single quotes |
| Operators | `+ - * / % = == != < <= > >= && \|\| !` |
| Punctuation | `( ) { } [ ] ; ,` |

**Recognised but unsupported** (reported as `UNSUPPORTED` tokens with an explanation): string literals, preprocessor lines (`#…`), `++ -- += -= *= /= %= &= \|= ^= <<= >>= -> << >> & \| ^ ~ ? : .`, and the C keywords `struct union enum switch case default do goto typedef sizeof const unsigned signed long short double static extern volatile register auto inline`. They are recognised so that IntelliFix can say “this is C, not MiniC” rather than inventing a repair.

## 2. Grammar (summary)

The full grammar is in `compiler/grammar/minic.y` (97 rules, 168 LR states including the augmented start rule).

```
program      := { function | declaration }
function     := (type | void) IDENT '(' [ void | param {',' param} ] ')' block
param        := type IDENT [ '[' ']' ]
type         := int | float | char | bool
declaration  := type declarator {',' declarator} ';'
declarator   := IDENT | IDENT '=' expr | IDENT '[' INT_LIT ']'
block        := '{' { statement } '}'
statement    := declaration | assignment ';' | expr ';' | if | while | for
              | return [expr] ';' | break ';' | continue ';' | block | ';'
assignment   := lvalue '=' expr
lvalue       := IDENT | IDENT '[' expr ']'
if           := if '(' expr ')' statement [ else statement ]
while        := while '(' expr ')' statement
for          := for '(' [assignment | type declarator-list] ';' [expr] ';' [assignment | expr] ')' statement
expr         := precedence levels below
primary      := IDENT | literal | true | false | '(' expr ')'
postfix      := primary | IDENT '(' [expr {',' expr}] ')' | IDENT '[' expr ']'
```

### Operator precedence and associativity (highest first)

| Level | Operators | Associativity |
|---|---|---|
| 1 | call `f(…)`, index `a[i]` | — |
| 2 | unary `-`, `!` | right (prefix) |
| 3 | `* / %` | left |
| 4 | `+ -` | left |
| 5 | `< <= > >=` | left |
| 6 | `== !=` | left |
| 7 | `&&` | left |
| 8 | `\|\|` | left |

Assignment is a **statement**, not an expression: `x = y = 1;` and `if (x = 1)` are syntax errors. This is deliberate. It keeps the grammar LALR(1) without precedence tricks, and it makes `=` vs `==` mistakes detectable.

### Dangling else

`else` binds to the nearest unmatched `if`. This is resolved by one precedence declaration (`%precedence LOWER_THAN_ELSE` / `%precedence T_ELSE`); `%expect 0` guarantees there are no other conflicts.

## 3. What is supported and what is not

| Supported | Not supported (and why) |
|---|---|
| global and local variables, multiple declarators, initialisers | pointers, structs, unions, enums (would need a type system IntelliFix does not have) |
| one-dimensional arrays with constant size; array parameters `int a[]` | multi-dimensional arrays, array initialisers |
| functions with parameters, `void` functions, `f(void)` | prototypes and declarations without bodies |
| `if/else`, `while`, `for` (C99-style init declaration), `break`, `continue`, `return` | `do-while`, `switch`, `goto`, labels |
| arithmetic, comparison and logical operators, unary `-` and `!` | unary `+`, bitwise operators, `++/--`, compound assignment, ternary `?:`, casts |
| `int float char bool` | strings, `double`, `long`, qualifiers |
| empty statements `;` and empty blocks inside functions | an empty declaration `;` at the top level (C does not allow it either) |
| empty program (no declarations) | — |

## 4. Scopes (used by name resolution, not by the parser)

MiniC has no type checker. `compiler/src/names.cpp` resolves names using these rules, and its warnings are one piece of repair evidence:

- functions are visible throughout the program (no prototypes needed);
- a global variable is visible after its declarator;
- parameters are visible in the function body;
- every block opens a scope; a `for`-init declaration is scoped to the loop;
- a local variable is visible after its own declarator (its initialiser cannot see it);
- warnings: undeclared identifier, duplicate declaration in one scope, calling a non-function, using a function as a variable, indexing a non-array, wrong number of call arguments.

`break`/`continue` outside a loop and type mismatches are **not** checked.

## 5. End of input

The lexer produces no explicit EOF token. The parser receives `YYEOF` after the last token, and diagnostics at EOF use the position just past the last byte. Truncated inputs therefore report “unexpected end of input” at that position.

## 6. Examples

Valid:

```c
int data[10];
int sum(int a[], int n) {
  int s = 0;
  for (int i = 0; i < n; i = i + 1) { s = s + a[i]; }
  return s;
}
```

Invalid (with the first diagnostic reported by the parser):

| Source | Diagnostic |
|---|---|
| `int x = 1` then `x = 2;` on the next line | `unexpected identifier 'x'` at the start of the next line |
| `if (x > 0 {` | `unexpected punctuation '{'` |
| `x = y = 1;` | `unexpected operator '='` (assignment is not an expression) |
| `int a[];` | `unexpected punctuation ']'` (size required) |
| `i++;` | `unsupported construct: increment/decrement operator '++' …` |
| `int x = 12abc;` | `lexical error: malformed numeric literal: digits immediately followed by letters` |

See [`examples/`](../examples) and [`compiler/tests/fixtures/`](../compiler/tests/fixtures).
