#include <string>

#include "parallax/lexer.hpp"
#include "parallax/repair.hpp"
#include "parallax/serialize.hpp"
#include "test_framework.hpp"

using namespace parallax;

namespace {

RepairReport repair(const std::string& src, RepairConfig cfg = RepairConfig{}) { return run_repair(src, cfg); }

std::string plan_source(const RepairReport& R) {
  CHECK(!R.decision.top_plans.empty());
  return reconstruct_source(R.source, R.lexed.tokens, R.leaves[R.decision.top_plans[0]].stream);
}

bool parses(const std::string& src) { return parse_tokens(lex(src).tokens, ParseOptions{}).ok(); }

}  // namespace

TEST(repair_apply_edit_insert_delete_replace) {
  LexResult lx = lex("a b c");
  Edit ins;
  ins.op = EditOp::Insert;
  ins.pos = 1;
  ins.kind = TokenKind::Comma;
  ins.lexeme = ",";
  auto s1 = apply_edit(lx.tokens, ins);
  CHECK_EQ(s1.size(), 4u);
  CHECK_EQ(s1[1].lexeme, std::string(","));
  CHECK_EQ(s1[1].origin, -1);
  CHECK_EQ(s1[2].origin, 1);
  Edit del;
  del.op = EditOp::Delete;
  del.pos = 0;
  auto s2 = apply_edit(lx.tokens, del);
  CHECK_EQ(s2.size(), 2u);
  CHECK_EQ(s2[0].origin, 1);
  Edit rep;
  rep.op = EditOp::Replace;
  rep.pos = 2;
  rep.kind = TokenKind::IntLit;
  rep.lexeme = "0";
  auto s3 = apply_edit(lx.tokens, rep);
  CHECK_EQ(s3[2].lexeme, std::string("0"));
  CHECK_EQ(s3[2].origin, 2);
  CHECK_EQ(origin_at(s1, 1, 3), 1);  // synthetic token maps to the next original token
  CHECK_EQ(origin_at(s1, 4, 3), 3);  // past the end = EOF
}

TEST(repair_identity_reconstruction_is_exact) {
  const char* srcs[] = {"int main() {\n  return 0; // c\n}\n", "/* lead */  int x;\r\nint y; /* tail */",
                        "", "\t\tint\tz ;  \n\n", "int main() { /* \xC3\xA9 */ return 1; }"};
  for (const char* s : srcs) {
    LexResult lx = lex(s);
    CHECK_EQ(reconstruct_source(s, lx.tokens, lx.tokens), std::string(s));
  }
}

TEST(repair_reconstruction_preserves_comments_and_spacing) {
  std::string src = "int main() {\n  int x = 1 // init\n  return x;\n}\n";
  LexResult lx = lex(src);
  Edit ins;
  ins.op = EditOp::Insert;
  ins.pos = 9;  // before 'return'
  ins.kind = TokenKind::Semi;
  ins.lexeme = ";";
  auto s = apply_edit(lx.tokens, ins);
  CHECK_EQ(reconstruct_source(src, lx.tokens, s), std::string("int main() {\n  int x = 1; // init\n  return x;\n}\n"));
}

TEST(repair_reconstruction_never_glues_tokens) {
  std::string src = "int main() { x = a b; }";
  LexResult lx = lex(src);
  Edit ins;
  ins.op = EditOp::Insert;
  ins.pos = 7;  // between a and b
  ins.kind = TokenKind::Ident;
  ins.lexeme = "__hole";
  auto s = apply_edit(lx.tokens, ins);
  std::string out = reconstruct_source(src, lx.tokens, s);
  LexResult back = lex(out);
  CHECK_EQ(back.tokens.size(), s.size());
  // operator next to operator must be separated ("/" + "*" would open a comment)
  std::string src2 = "int main() { x=a/b; }";
  LexResult l2 = lex(src2);
  Edit rep;
  rep.op = EditOp::Replace;
  rep.pos = 7;  // b
  rep.kind = TokenKind::Star;
  rep.lexeme = "*";
  auto s2 = apply_edit(l2.tokens, rep);
  std::string out2 = reconstruct_source(src2, l2.tokens, s2);
  CHECK(out2.find("/*") == std::string::npos);
  CHECK_EQ(lex(out2).tokens.size(), s2.size());
}

TEST(repair_valid_program_needs_no_repair) {
  RepairReport R = repair("int main() { return 0; }");
  CHECK_EQ(R.decision.status, std::string("NO_REPAIR_NEEDED"));
  CHECK(R.candidates.empty());
}

TEST(repair_missing_semicolon_is_recommended) {
  std::string src = "int main() {\n  int x = 1\n  x = x + 2;\n  return x;\n}\n";
  RepairReport R = repair(src);
  CHECK_EQ(R.decision.status, std::string("RECOMMENDED"));
  CHECK_EQ(plan_source(R), std::string("int main() {\n  int x = 1;\n  x = x + 2;\n  return x;\n}\n"));
  const Candidate& top = R.candidates[R.ranked[0]];
  CHECK_EQ(top.edits.size(), 1u);
  CHECK(top.edits[0].op == EditOp::Insert);
  CHECK_EQ(top.edits[0].support, std::string("line-end-semicolon"));
}

TEST(repair_missing_rparen_is_recommended) {
  RepairReport R = repair("int main() {\n  int x = 0;\n  if (x > 0 {\n    x = 1;\n  }\n  return x;\n}\n");
  CHECK_EQ(R.decision.status, std::string("RECOMMENDED"));
  CHECK(plan_source(R).find("if (x > 0) {") != std::string::npos);
}

TEST(repair_every_accepted_candidate_is_parser_validated) {
  const char* srcs[] = {"int main() { int c = a b; return c; }", "int main() {\n  if (x > 0 {\n  }\n}\n",
                        "int f(int a int b) { return a; }", "int main() { return (1 + 2; }",
                        "int main() { x = 1 }", "int main() { int = 5; }"};
  for (const char* s : srcs) {
    RepairReport R = repair(s);
    for (int i : R.ranked) {
      const Candidate& c = R.candidates[i];
      CHECK(c.roundtrip_ok);
      CHECK_EQ(parses(c.source), c.valid);
      if (c.outcome == Outcome::Valid) CHECK(c.valid);
    }
    for (int leaf : R.decision.top_plans)
      if (R.leaves[leaf].valid) CHECK(parses(reconstruct_source(s, R.lexed.tokens, R.leaves[leaf].stream)));
  }
}

TEST(repair_ambiguous_operator_is_multiple_plausible) {
  RepairReport R = repair("int main() {\n  int a = 1;\n  int b = 2;\n  int c = a b;\n  return c;\n}\n");
  CHECK_EQ(R.decision.status, std::string("MULTIPLE_PLAUSIBLE"));
  CHECK(R.classes.size() >= 5);
  CHECK(R.decision.has_margin);
  CHECK(R.decision.margin < R.config.tau);
}

TEST(repair_missing_identifier_abstains_with_low_confidence) {
  RepairReport R = repair("int main() {\n  int = 5;\n  return 0;\n}\n");
  CHECK_EQ(R.decision.status, std::string("LOW_CONFIDENCE"));
}

TEST(repair_unsupported_construct_is_reported) {
  RepairReport R = repair("int main() { int i = 0; i++; return i; }");
  CHECK_EQ(R.decision.status, std::string("UNSUPPORTED_CONSTRUCT"));
}

TEST(repair_budget_exhaustion_is_explicit) {
  RepairConfig cfg;
  cfg.max_parses = 10;
  RepairReport R = repair("int main() {\n  int x = 1\n  x = x + 2;\n  return x;\n}\n", cfg);
  CHECK(R.budget.exhausted);
  CHECK(R.decision.status == "BUDGET_EXHAUSTED" || R.decision.status == "LOW_CONFIDENCE" ||
        R.decision.status == "MULTIPLE_PLAUSIBLE" || R.decision.status == "RECOMMENDED");
  RepairConfig tiny;
  tiny.max_parses = 10;
  RepairReport T = repair("int main() { int c = a b; }", tiny);
  CHECK(T.budget.exhausted);
}

TEST(repair_ast_grouping_merges_equivalent_candidates) {
  std::string src = "int main() {\n  int a = 1;\n  int b = (a + 2;\n  return b;\n}\n";
  RepairReport R = repair(src);
  CHECK(R.ranked.size() >= 2);
  CHECK(R.classes.size() < R.ranked.size());  // "(a) + 2" and "(a + 2)" share an AST
  CHECK_EQ(R.decision.status, std::string("RECOMMENDED"));
  RepairConfig nog;
  nog.grouping = false;
  RepairReport N = repair(src, nog);
  CHECK_EQ(N.classes.size(), N.ranked.size());
  CHECK_EQ(N.decision.status, std::string("MULTIPLE_PLAUSIBLE"));  // equivalent candidates now compete
}

TEST(repair_detects_deferred_errors_and_duplicates) {
  RepairReport R = repair("int main() { return ((1); }");
  int deferred = 0;
  for (const Candidate& c : R.candidates)
    if (c.outcome == Outcome::DefersError) deferred++;
  CHECK(deferred > 0);
  CHECK(R.duplicates > 0);  // deleting either '(' yields the same token stream
}

TEST(repair_multiple_errors_produce_a_multi_step_plan) {
  std::string src = "int f(int a, int b) {\n  int s = a + b\n  if (s > 10 {\n    s = 10;\n  }\n  return s;\n}\n";
  RepairReport R = repair(src);
  CHECK_EQ(R.decision.status, std::string("RECOMMENDED"));
  const LaneLeaf& L = R.leaves[R.decision.top_plans[0]];
  CHECK(L.valid);
  CHECK_EQ(L.steps.size(), 2u);
  CHECK(plan_source(R).find("int s = a + b;") != std::string::npos);
  CHECK(plan_source(R).find("if (s > 10) {") != std::string::npos);
  bool any_stable = false;
  for (const auto& s : R.stability) any_stable |= s.stable;
  CHECK(any_stable);
}

TEST(repair_indentation_evidence_prefers_structural_brace) {
  RepairReport R = repair("int main() {\n  int i = 0;\n  while (i < 10)\n    i = i + 1;\n    print(i);\n  }\n  return 0;\n}\n");
  CHECK(plan_source(R).find("while (i < 10) {") != std::string::npos);
}

TEST(repair_no_abstention_forces_recommendation) {
  RepairConfig cfg;
  cfg.abstention = false;
  RepairReport R = repair("int main() { int c = a b; return c; }", cfg);
  CHECK_EQ(R.decision.status, std::string("RECOMMENDED"));
}

TEST(repair_least_cost_baseline_uses_cost_only) {
  RepairConfig cfg;
  cfg.strategy = "least-cost";
  RepairReport R = repair("int main() {\n  int x = 1\n  x = x + 2;\n}\n", cfg);
  CHECK(!R.config.grouping);
  CHECK(!R.config.abstention);
  CHECK_EQ(R.decision.status, std::string("RECOMMENDED"));
  for (int i : R.ranked) CHECK_EQ(R.candidates[i].score, -R.candidates[i].cost);
}

TEST(repair_lexical_error_candidates) {
  RepairReport R = repair("int main() { int x = 5 @ 3; return x; }");
  bool deletes_at = false;
  for (int i : R.ranked)
    for (const Edit& e : R.candidates[i].edits) deletes_at |= (e.op != EditOp::Insert && e.removed_lexeme == "@");
  CHECK(deletes_at);
  CHECK(R.decision.status == "MULTIPLE_PLAUSIBLE" || R.decision.status == "RECOMMENDED");
}

TEST(repair_is_deterministic) {
  std::string src = "int f(int a, int b) {\n  int s = a + b\n  if (s > 10 {\n    s = 10;\n  }\n  return s;\n}\n";
  RepairConfig cfg;
  cfg.time_limit_ms = 60000;
  std::string a = repair_document(repair(src, cfg));
  std::string b = repair_document(repair(src, cfg));
  // timings differ between runs; compare everything else
  auto strip = [](std::string s) {
    std::string out;
    size_t i = 0;
    while (i < s.size()) {
      size_t k = s.find("\"ms\":", i);
      size_t k2 = s.find("\"elapsed_ms\":", i);
      size_t m = std::min(k, k2);
      if (m == std::string::npos) {
        out += s.substr(i);
        break;
      }
      out += s.substr(i, m - i);
      size_t e = s.find_first_of(",}", m);
      i = e;
    }
    return out;
  };
  CHECK_EQ(strip(a), strip(b));
}

TEST(repair_eof_inside_block) {
  RepairReport R = repair("int main() {\n  int x = 0;\n");
  CHECK_EQ(R.decision.status, std::string("RECOMMENDED"));
  CHECK(parses(plan_source(R)));
}

TEST(repair_empty_input_is_valid) {
  RepairReport R = repair("");
  CHECK_EQ(R.decision.status, std::string("NO_REPAIR_NEEDED"));
}

TEST(repair_missing_comma_prefers_matching_arity) {
  RepairReport R = repair("int add(int a, int b) {\n  return a + b;\n}\n\nint main() {\n  return add(1 2);\n}\n");
  CHECK(plan_source(R).find("add(1, 2)") != std::string::npos);
}

TEST(repair_doubled_brace_far_from_detection_point) {
  std::string src = "int main() {\n  int x = 0;\n  if (x > 0) {{\n    x = 1;\n  }\n  return x;\n}\n";
  RepairReport R = repair(src);
  bool found = false;
  for (int i : R.ranked)
    for (const Edit& e : R.candidates[i].edits) found |= e.generator == "duplicate";
  CHECK(found);
}

// Regression (found by the professor-style suite): a valid but very deeply
// nested program used to be "repaired" by deleting braces after a 3.5 s
// search, and none of the proposed plans parsed.
TEST(repair_parser_nesting_limit_is_reported_not_repaired) {
  std::string src = "int main() " + std::string(3000, '{') + std::string(3000, '}');
  RepairReport R = repair(src);
  CHECK(R.original.resource_limit);
  CHECK_EQ(R.decision.status, std::string("UNSUPPORTED_CONSTRUCT"));
  CHECK(R.candidates.empty());
  CHECK(R.budget.elapsed_ms() < 1000);
}

// Regression (professor-style suite, P73): an unterminated block comment
// swallows the rest of the file; replacing it with '}' parses but discards
// "return 0;", so it must not be recommended.
TEST(repair_never_recommends_discarding_an_unterminated_comment) {
  RepairReport R = repair("int main() { /* forgot to close\n return 0; }\n");
  CHECK(R.decision.status != std::string("RECOMMENDED"));
  CHECK_EQ(R.decision.status, std::string("LOW_CONFIDENCE"));
}
