#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <thread>
#include <vector>

#include "parallax/lexer.hpp"
#include "parallax/names.hpp"
#include "parallax/parser.hpp"
#include "test_framework.hpp"

using namespace parallax;

namespace {

ParseResult parse(const std::string& src, bool stop = false) {
  ParseOptions o;
  o.stop_at_first_error = stop;
  return parse_tokens(lex(src).tokens, o);
}

std::string canon_expr(const std::string& expr) {
  ParseResult r = parse("int main() { return " + expr + "; }");
  CHECK(r.ok());
  // Program > Function > Block > Return > expr
  const Node* ret = r.root->children[0]->children.back()->children[0];
  return canonical_form(ret->children[0]);
}

std::vector<std::string> list_dir(const std::string& dir) {
  std::vector<std::string> out;
  std::error_code ec;
  for (const auto& e : std::filesystem::directory_iterator(dir, ec))
    if (e.path().extension() == ".mc") out.push_back(e.path().string());
  std::sort(out.begin(), out.end());
  return out;
}

std::string read_file(const std::string& p) {
  std::ifstream in(p, std::ios::binary);
  return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

}  // namespace

TEST(parser_valid_fixtures_parse_and_build_ast) {
  auto files = list_dir(std::string(PARALLAX_FIXTURES) + "/valid");
  CHECK(files.size() >= 5);
  for (const auto& f : files) {
    ParseResult r = parse(read_file(f));
    if (!r.ok()) throw pxtest::Failure{"valid fixture failed to parse: " + f};
    CHECK(r.root != nullptr);
    CHECK_EQ(r.root->kind, NodeKind::Program);
  }
}

TEST(parser_invalid_fixtures_report_expected_location) {
  auto files = list_dir(std::string(PARALLAX_FIXTURES) + "/invalid");
  CHECK(files.size() >= 10);
  for (const auto& f : files) {
    std::string src = read_file(f);
    int line = 0, col = 0;
    CHECK(std::sscanf(src.c_str(), "// expect: %d:%d", &line, &col) == 2);
    LexResult lx = lex(src);
    ParseResult r = parse_tokens(lx.tokens, ParseOptions{});
    CHECK(!r.ok());
    CHECK(r.root == nullptr);
    int i = r.diagnostics[0].token_index;
    Position p = i < static_cast<int>(lx.tokens.size()) ? lx.tokens[i].start : lx.eof;
    if (p.line != line || p.column != col)
      throw pxtest::Failure{f + ": expected error at " + std::to_string(line) + ":" + std::to_string(col) +
                            ", got " + std::to_string(p.line) + ":" + std::to_string(p.column)};
  }
}

TEST(parser_empty_input_is_an_empty_program) {
  ParseResult r = parse("");
  CHECK(r.ok());
  CHECK_EQ(r.root->children.size(), 0u);
  ParseResult c = parse("  // only a comment\n");
  CHECK(c.ok());
}

TEST(parser_precedence_and_associativity) {
  CHECK_EQ(canon_expr("1 + 2 * 3"), canon_expr("1 + (2 * 3)"));
  CHECK(canon_expr("1 + 2 * 3") != canon_expr("(1 + 2) * 3"));
  CHECK_EQ(canon_expr("a - b - c"), canon_expr("(a - b) - c"));
  CHECK(canon_expr("a - b - c") != canon_expr("a - (b - c)"));
  CHECK_EQ(canon_expr("a || b && c"), canon_expr("a || (b && c)"));
  CHECK_EQ(canon_expr("a == b < c"), canon_expr("a == (b < c)"));
  CHECK_EQ(canon_expr("a < b + c"), canon_expr("a < (b + c)"));
  CHECK_EQ(canon_expr("-a * b"), canon_expr("(-a) * b"));
  CHECK_EQ(canon_expr("!-x"), canon_expr("!(-x)"));
  CHECK_EQ(canon_expr("a % b / c"), canon_expr("(a % b) / c"));
}

TEST(parser_parentheses_do_not_appear_in_ast) {
  CHECK_EQ(canon_expr("((a))"), canon_expr("a"));
  CHECK_EQ(structural_hash(parse("int main() { return (1); }").root),
           structural_hash(parse("int main() {\n  return 1;\n}\n").root));
}

TEST(parser_formatting_does_not_change_structure) {
  ParseResult a = parse("int f(int x){return x+1;}");
  ParseResult b = parse("int f( int x )\n{\n  // comment\n  return x + 1;\n}\n");
  CHECK_EQ(canonical_form(a.root), canonical_form(b.root));
}

TEST(parser_empty_statement_is_structural) {
  CHECK(structural_hash(parse("int main() { x = 1;; }").root) != structural_hash(parse("int main() { x = 1; }").root));
}

TEST(parser_dangling_else_binds_to_nearest_if) {
  ParseResult r = parse("int main() { if (a) if (b) x = 1; else x = 2; }");
  CHECK(r.ok());
  const Node* outer = r.root->children[0]->children.back()->children[0];
  CHECK_EQ(outer->kind, NodeKind::If);
  CHECK_EQ(outer->children.size(), 2u);  // no else on the outer if
  const Node* inner = outer->children[1];
  CHECK_EQ(inner->kind, NodeKind::If);
  CHECK_EQ(inner->children.size(), 3u);
}

TEST(parser_for_loop_clauses) {
  ParseResult r = parse("int main() { for (int i = 0; i < 3; i = i + 1) {} for (;;) {} }");
  CHECK(r.ok());
  const Node* f = r.root->children[0]->children.back()->children[1];
  CHECK_EQ(f->kind, NodeKind::For);
  CHECK_EQ(f->children[0]->kind, NodeKind::Empty);
  CHECK_EQ(f->children[1]->kind, NodeKind::Empty);
  CHECK_EQ(f->children[2]->kind, NodeKind::Empty);
}

TEST(parser_declarations_and_arrays) {
  ParseResult r = parse("int a, b = 2, c[10];\nint f(int x[], float y) { return x[0]; }");
  CHECK(r.ok());
  const Node* d = r.root->children[0];
  CHECK_EQ(d->kind, NodeKind::DeclStmt);
  CHECK_EQ(d->children.size(), 3u);
  CHECK_EQ(d->children[2]->array, std::string("10"));
  const Node* fn = r.root->children[1];
  CHECK_EQ(fn->children[0]->array, std::string("[]"));
  CHECK(!parse("int a[];").ok());       // array size required in declarations
  CHECK(!parse("int a[n];").ok());      // constant size only
  CHECK(!parse("int f(int a[3]) {}").ok());
}

TEST(parser_rejects_invalid_assignment_targets) {
  CHECK(!parse("int main() { 1 = x; }").ok());
  CHECK(!parse("int main() { f() = x; }").ok());
  CHECK(!parse("int main() { x = y = 1; }").ok());  // assignment is not an expression
  CHECK(parse("int main() { a[i + 1] = x; }").ok());
}

TEST(parser_expected_tokens_are_exact) {
  LexResult lx = lex("int main() { int x = ; }");
  ParseResult r = parse_tokens(lx.tokens, ParseOptions{});
  CHECK(!r.ok());
  const auto& e = r.diagnostics[0].expected;
  auto has = [&](TokenKind k) { return std::find(e.begin(), e.end(), k) != e.end(); };
  CHECK(has(TokenKind::Ident));
  CHECK(has(TokenKind::IntLit));
  CHECK(has(TokenKind::LParen));
  CHECK(has(TokenKind::Minus));
  CHECK(has(TokenKind::Not));
  CHECK(!has(TokenKind::Semi));
  CHECK(!has(TokenKind::Plus));  // no unary plus in MiniC
}

TEST(parser_expected_at_probe) {
  LexResult lx = lex("int main() { x = 1 }");
  std::vector<TokenKind> exp;
  // position of '}' (index 8): after "x = 1" the parser wants an operator or ';'
  CHECK(expected_at(lx.tokens, 8, &exp));
  CHECK(std::find(exp.begin(), exp.end(), TokenKind::Semi) != exp.end());
  CHECK(std::find(exp.begin(), exp.end(), TokenKind::Plus) != exp.end());
  CHECK(std::find(exp.begin(), exp.end(), TokenKind::RBrace) == exp.end());
  // a prefix that already contains an error cannot be probed beyond it
  LexResult bad = lex("int main( { x = 1; }");
  CHECK(!expected_at(bad.tokens, 6, &exp));
}

TEST(parser_panic_mode_recovers_multiple_errors) {
  ParseResult r = parse("int main() {\n  int x = 1 +;\n  y = ;\n  return 0;\n}\n");
  CHECK_EQ(r.diagnostics.size(), 2u);
  CHECK(r.recovered_root != nullptr);
  ParseResult first = parse("int main() {\n  int x = 1 +;\n  y = ;\n  return 0;\n}\n", true);
  CHECK_EQ(first.diagnostics.size(), 1u);
}

TEST(parser_truncated_inputs) {
  const char* cases[] = {"int main() {", "int main(", "int main() { return f(1, ", "int main() { x = (1 + ",
                         "int", "int main() { if (x) "};
  for (const char* c : cases) {
    LexResult lx = lex(c);
    ParseResult r = parse_tokens(lx.tokens, ParseOptions{});
    CHECK(!r.ok());
    CHECK_EQ(r.diagnostics[0].token_index, static_cast<int>(lx.tokens.size()));  // error at EOF
  }
}

TEST(parser_deep_nesting_hits_resource_limit_without_crashing) {
  std::string src = "int main() { return " + std::string(6000, '(') + "1" + std::string(6000, ')') + "; }";
  ParseResult r = parse(src);
  CHECK(!r.ok());
  CHECK(r.resource_limit);
  std::string ok = "int main() { return " + std::string(500, '(') + "1" + std::string(500, ')') + "; }";
  CHECK(parse(ok).ok());
}

TEST(parser_trace_is_captured_and_bounded) {
  ParseOptions o;
  o.trace = true;
  o.trace_limit = 50;
  ParseResult r = parse_tokens(lex("int main() { return 1 + 2; }").tokens, o);
  CHECK(r.ok());
  CHECK_EQ(r.trace.size(), 50u);
  CHECK(r.trace_truncated);
  bool shifting = false;
  for (const auto& l : r.trace) shifting |= l.find("Shifting") != std::string::npos;
  CHECK(shifting);
  // tracing is switched off again afterwards
  ParseResult q = parse("int main() {}");
  CHECK(q.trace.empty());
}

TEST(parser_is_reentrant_across_threads) {
  std::vector<std::string> srcs = {"int main() { return 1; }", "int main() { x = ; }", "int f(int a) { return a * 2; }",
                                   "int main( { }"};
  std::vector<std::string> expected;
  for (const auto& s : srcs) {
    ParseResult r = parse(s);
    expected.push_back(r.ok() ? canonical_form(r.root) : "err@" + std::to_string(r.diagnostics[0].token_index));
  }
  std::vector<std::string> got(srcs.size() * 8);
  std::vector<std::thread> ts;
  for (size_t t = 0; t < got.size(); ++t) {
    ts.emplace_back([&, t] {
      for (int rep = 0; rep < 50; ++rep) {
        ParseResult r = parse(srcs[t % srcs.size()]);
        got[t] = r.ok() ? canonical_form(r.root) : "err@" + std::to_string(r.diagnostics[0].token_index);
      }
    });
  }
  for (auto& th : ts) th.join();
  for (size_t t = 0; t < got.size(); ++t) CHECK_EQ(got[t], expected[t % srcs.size()]);
}

TEST(parser_ast_spans_cover_source) {
  std::string src = "int main() {\n  return 1 + 2;\n}\n";
  LexResult lx = lex(src);
  ParseResult r = parse_tokens(lx.tokens, ParseOptions{});
  const Node* ret = r.root->children[0]->children.back()->children[0];
  CHECK_EQ(lx.tokens[ret->tok_begin].lexeme, std::string("return"));
  CHECK_EQ(lx.tokens[ret->tok_end - 1].lexeme, std::string(";"));
  const Node* bin = ret->children[0];
  CHECK_EQ(lx.tokens[bin->tok_begin].lexeme, std::string("1"));
  CHECK_EQ(lx.tokens[bin->tok_end - 1].lexeme, std::string("2"));
}

TEST(names_detect_undeclared_and_duplicates) {
  ParseResult r = parse("int g;\nint f(int a) { int b = a; int b; return c + g + h(1); }\nint h(int x) { return x; }");
  CHECK(r.ok());
  auto ws = check_names(r.root);
  int undeclared = 0, dup = 0;
  for (const auto& w : ws) {
    if (w.kind == "undeclared") undeclared++;
    if (w.kind == "duplicate") dup++;
  }
  CHECK_EQ(undeclared, 1);  // c (h is hoisted)
  CHECK_EQ(dup, 1);         // b
}

TEST(names_scopes_and_placeholders) {
  ParseResult r = parse("int main() { { int t = 1; } t = 2; for (int i = 0; i < 2; i = i + 1) {} i = __hole; }");
  CHECK(r.ok());
  auto ws = check_names(r.root);
  CHECK_EQ(ws.size(), 2u);  // t and i are out of scope; __hole is ignored
}

TEST(names_detect_call_arity_mismatch) {
  ParseResult r = parse("int f(int a, int b) { return a; }\nint main() { return f(1) + f(1, 2) + f(1 + 2); }");
  CHECK(r.ok());
  int arity = 0;
  for (const auto& w : check_names(r.root)) arity += w.kind == "arity";
  CHECK_EQ(arity, 2);
}
