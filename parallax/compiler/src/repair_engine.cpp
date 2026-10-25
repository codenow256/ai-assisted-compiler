// IntelliFix repair engine. Pipeline (docs/REPAIR_ALGORITHM.md):
//   localise -> generate (grammar-guided, bounded) -> token-level parser
//   validation -> source reconstruction + re-lex + re-parse -> evidence ->
//   ranking -> AST grouping -> hypothesis lanes (follow-on diagnostics) ->
//   stability -> confidence-aware decision.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <limits>
#include <map>
#include <set>
#include <unordered_set>

#include "parallax/repair.hpp"

namespace parallax {

const char* outcome_name(Outcome o) {
  switch (o) {
    case Outcome::Valid: return "valid";
    case Outcome::LocalRepair: return "local-repair";
    case Outcome::DefersError: return "defers-error";
    case Outcome::SameLocation: return "same-location";
    case Outcome::EarlierError: return "earlier-error";
    case Outcome::Malformed: return "malformed";
    case Outcome::Duplicate: return "duplicate";
  }
  return "?";
}

bool outcome_accepted(Outcome o) { return o == Outcome::Valid || o == Outcome::LocalRepair; }

bool Budget::spend(int n) {
  parses += n;
  if (parses > max_parses || elapsed_ms() > time_limit_ms) exhausted = true;
  return !exhausted;
}

double Budget::elapsed_ms() const {
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
}

namespace {

using Clock = std::chrono::steady_clock;
double ms_since(Clock::time_point t) {
  return std::chrono::duration<double, std::milli>(Clock::now() - t).count();
}

// Applies a sequence of edits and returns the end (exclusive) of the edited
// region in the final stream, used to measure parser progress after it.
std::vector<Token> apply_all(const std::vector<Token>& base, const std::vector<Edit>& edits, int* q_end) {
  std::vector<Token> s = base;
  int q = -1;
  for (const Edit& e : edits) {
    if (q >= 0) {
      if (e.op == EditOp::Insert && e.pos < q) q += 1;
      if (e.op == EditOp::Delete && e.pos < q) q -= 1;
    }
    int end = (e.op == EditOp::Delete) ? e.pos : e.pos + 1;
    q = std::max(q, end);
    s = apply_edit(s, e);
  }
  if (q_end) *q_end = q;
  return s;
}

// Column of the first token on each line (indentation proxy).
std::map<int, int> line_indents(const std::vector<Token>& s) {
  std::map<int, int> ind;
  for (const Token& t : s) {
    if (t.origin < 0) continue;
    if (!ind.count(t.start.line)) ind[t.start.line] = t.start.column;
  }
  return ind;
}

bool first_on_line(const std::vector<Token>& s, int p) {
  if (p <= 0 || p >= static_cast<int>(s.size())) return p == 0;
  return s[p].origin >= 0 && s[p - 1].origin >= 0 && s[p].start.line > s[p - 1].end.line;
}

bool contains(const std::vector<TokenKind>& v, TokenKind k) {
  return std::find(v.begin(), v.end(), k) != v.end();
}

std::string describe_edit(const Edit& e) {
  std::string s = edit_op_name(e.op);
  if (e.op == EditOp::Insert) s += " '" + e.lexeme + "'";
  else if (e.op == EditOp::Delete) s += " '" + e.removed_lexeme + "'";
  else s += " '" + e.removed_lexeme + "' -> '" + e.lexeme + "'";
  s += " at " + std::to_string(e.at.line) + ":" + std::to_string(e.at.column);
  return s;
}

std::string fmt2(double v) {
  char buf[32];
  std::snprintf(buf, sizeof buf, "%.2f", v);
  return buf;
}

std::string describe_edits(const std::vector<Edit>& edits) {
  std::string s;
  for (size_t i = 0; i < edits.size(); ++i) {
    if (i) s += "; ";
    s += describe_edit(edits[i]);
  }
  return s;
}

struct IndentCtx {
  const std::vector<Token>& toks;
  std::map<int, int> line_indent;  // line -> column of its first token
};

bool starts_line(const std::vector<Token>& toks, int i) {
  return i == 0 || (i > 0 && i < static_cast<int>(toks.size()) && toks[i].start.line > toks[i - 1].end.line);
}

void count_mismatch(const Node* n, const IndentCtx& cx, int* total) {
  const auto& toks = cx.toks;
  const int sz = static_cast<int>(toks.size());
  if (n->kind == NodeKind::Block || n->kind == NodeKind::Program) {
    // (1) statements that start a line share one column within a block
    int ref = -1;
    for (const Node* c : n->children) {
      int b = c->tok_begin;
      if (b <= 0 || b >= sz || !starts_line(toks, b)) continue;
      if (ref < 0) ref = toks[b].start.column;
      else if (toks[b].start.column != ref) (*total)++;
    }
    // (2) a closing brace that starts a line aligns with the line that
    //     opened the block
    if (n->kind == NodeKind::Block && n->tok_begin >= 0 && n->tok_end - 1 < sz && n->tok_end > n->tok_begin &&
        toks[n->tok_begin].kind == TokenKind::LBrace && toks[n->tok_end - 1].kind == TokenKind::RBrace &&
        starts_line(toks, n->tok_end - 1)) {
      auto it = cx.line_indent.find(toks[n->tok_begin].start.line);
      if (it != cx.line_indent.end() && toks[n->tok_end - 1].start.column != it->second) (*total)++;
    }
  }
  for (const Node* c : n->children) count_mismatch(c, cx, total);
}

}  // namespace

int indentation_mismatches(const Node* root, const std::vector<Token>& toks) {
  IndentCtx cx{toks, {}};
  for (const Token& t : toks)
    if (!cx.line_indent.count(t.start.line)) cx.line_indent[t.start.line] = t.start.column;
  int total = 0;
  if (root) count_mismatch(root, cx, &total);
  return total;
}

namespace {

class Engine {
 public:
  Engine(const RepairConfig& cfg, RepairReport& R) : cfg_(cfg), R_(R) {
    n_ = static_cast<int>(R.lexed.tokens.size());
  }

  // ------------------------------------------------------------ parsing
  // First error (stream index) of a stop-at-first parse, -1 if valid.
  int first_error(const std::vector<Token>& s) {
    R_.budget.spend();
    ParseOptions o;
    o.stop_at_first_error = true;
    ParseResult r = parse_tokens(s, o);
    if (r.ok()) return -1;
    if (r.diagnostics.empty()) return static_cast<int>(s.size());
    return r.first_error_index();
  }

  bool expected(const std::vector<Token>& s, int p, std::vector<TokenKind>* out) {
    R_.budget.spend();
    return expected_at(s, p, out);
  }

  int residual_count(const std::vector<Token>& s) {
    R_.budget.spend();
    ParseOptions o;
    o.build_ast = false;
    return static_cast<int>(parse_tokens(s, o).diagnostics.size());
  }

  // ------------------------------------------------------------ edits
  Edit make_edit(const std::vector<Token>& s, EditOp op, int p, TokenKind k, const std::string& gen) {
    Edit e;
    e.op = op;
    e.pos = p;
    e.generator = gen;
    const int sz = static_cast<int>(s.size());
    if (op != EditOp::Delete) {
      e.kind = k;
      e.lexeme = synthetic_lexeme(k);
    }
    if (op != EditOp::Insert && p < sz) {
      e.removed_kind = s[p].kind;
      e.removed_lexeme = s[p].lexeme;
    }
    if (op == EditOp::Insert) {
      e.anchor_origin = origin_at(s, p, n_);
      if (p > 0 && p <= sz) e.at = s[p - 1].end;
      else if (sz > 0) e.at = s[0].start;
    } else {
      e.anchor_origin = origin_at(s, p, n_);
      if (p < sz) e.at = s[p].start;
    }
    e.cost = edit_cost(e);
    e.support = support_for(s, e);
    return e;
  }

  // Layout / pattern support (evidence features, see REPAIR_ALGORITHM.md).
  std::string support_for(const std::vector<Token>& s, const Edit& e) {
    if (!cfg_.layout) return "";
    const int sz = static_cast<int>(s.size());
    const int p = e.pos;
    if (e.op == EditOp::Insert && e.kind == TokenKind::Semi && p > 0 && p < sz &&
        s[p - 1].origin >= 0 && s[p].origin >= 0 && s[p].start.line > s[p - 1].end.line)
      return "line-end-semicolon";
    if (e.op == EditOp::Insert && e.kind == TokenKind::LBrace && p > 0 && p < sz &&
        (s[p - 1].kind == TokenKind::RParen || s[p - 1].kind == TokenKind::KwElse) && first_on_line(s, p)) {
      auto ind = line_indents(s);
      int prev_line = s[p - 1].end.line;
      if (ind.count(prev_line) && s[p].start.column > ind[prev_line]) return "indentation-brace";
    }
    if (e.op == EditOp::Insert && e.kind == TokenKind::RBrace) {
      if (p > 0 && first_on_line(s, p)) {
        auto ind = line_indents(s);
        int prev_line = s[p - 1].start.line;
        if (ind.count(prev_line) && s[p].start.column < ind[prev_line]) return "indentation-brace";
      }
    }
    if (e.op == EditOp::Delete && p < sz) {
      const char* cat = token_category(s[p].kind);
      bool punct = std::string(cat) == "punctuation" || std::string(cat) == "operator";
      if (punct && ((p > 0 && s[p - 1].kind == s[p].kind) || (p + 1 < sz && s[p + 1].kind == s[p].kind)))
        return "duplicate-deletion";
    }
    return "";
  }

  // ------------------------------------------------------------ classification
  void classify(Candidate& c, const std::vector<Token>& base, int e_origin) {
    int q = 0;
    c.stream = apply_all(base, c.edits, &q);
    c.cost = 0;
    for (const Edit& e : c.edits) c.cost += e.cost;
    int j = first_error(c.stream);
    if (j < 0) {
      c.outcome = Outcome::Valid;
      c.reason = "the edited token stream parses completely";
      return;
    }
    c.next_error_stream = j;
    c.next_error_origin = origin_at(c.stream, j, n_);
    c.progress = j - q;
    if (c.next_error_origin > e_origin && c.progress >= cfg_.min_progress) {
      c.outcome = Outcome::LocalRepair;
      c.reason = "first error repaired; parser advanced " + std::to_string(c.progress) +
                 " tokens before the next error";
    } else if (c.next_error_origin > e_origin) {
      c.outcome = Outcome::DefersError;
      c.reason = "only moves the error " + std::to_string(c.progress) +
                 " token(s) past the edit (needs " + std::to_string(cfg_.min_progress) + ")";
    } else if (c.next_error_origin == e_origin) {
      c.outcome = Outcome::SameLocation;
      c.reason = "parser still fails at the original error token";
    } else {
      c.outcome = Outcome::EarlierError;
      c.reason = "introduces a new error before the original error point";
    }
  }

  // ------------------------------------------------------------ generation
  // Generates, validates and analyses candidates for the error at stream
  // index `e` of stream `s`. Returns all candidates (accepted + rejected).
  std::vector<Candidate> generate_step(const std::vector<Token>& s, int e, int* singles, int* pairs,
                                       int* dups) {
    std::vector<Candidate> out;
    std::unordered_set<std::string> seen;
    seen.insert(stream_key(s));
    const int sz = static_cast<int>(s.size());
    const int e_origin = origin_at(s, e, n_);
    int order = 0;

    auto add = [&](std::vector<Edit> edits, const std::vector<Token>& base_for_classify) {
      if (R_.budget.exhausted) return;
      Candidate c;
      c.edits = std::move(edits);
      c.order = order++;
      classify(c, base_for_classify, e_origin);
      std::string key = stream_key(c.stream);
      if (!seen.insert(key).second) {
        c.outcome = Outcome::Duplicate;
        c.reason = "same token sequence as a cheaper/earlier candidate";
        (*dups)++;
      }
      out.push_back(std::move(c));
    };

    // Single edits around the error ("window" generator).
    std::vector<int> positions;
    for (int p = e; p >= std::max(0, e - cfg_.window_back); --p) positions.push_back(p);
    for (int p : positions) {
      if (R_.budget.exhausted) break;
      std::vector<TokenKind> exp;
      if (!expected(s, p, &exp)) continue;
      for (TokenKind k : exp) {
        if (k == TokenKind::EndOfFile) continue;
        add({make_edit(s, EditOp::Insert, p, k, "window")}, s);
        (*singles)++;
      }
      if (p < sz) {
        add({make_edit(s, EditOp::Delete, p, TokenKind::Semi, "window")}, s);
        (*singles)++;
        for (TokenKind k : exp) {
          if (k == TokenKind::EndOfFile || k == s[p].kind) continue;
          add({make_edit(s, EditOp::Replace, p, k, "window")}, s);
          (*singles)++;
        }
      }
    }

    // Layout-informed generators: reach further back than the window, but
    // only for one specific token each and only where layout suggests it.
    if (cfg_.layout) {
      auto ind = line_indents(s);
      int lo = std::max(1, e - cfg_.layout_reach);
      int semi = 0, open = 0, close = 0;
      for (int p = e - cfg_.window_back - 1; p >= lo && !R_.budget.exhausted; --p) {
        if (!first_on_line(s, p)) continue;
        std::vector<TokenKind> exp;
        bool want_semi = semi < cfg_.max_layout_positions;
        bool want_open = open < cfg_.max_layout_positions &&
                         (s[p - 1].kind == TokenKind::RParen || s[p - 1].kind == TokenKind::KwElse) &&
                         ind.count(s[p - 1].end.line) && s[p].start.column > ind[s[p - 1].end.line];
        bool want_close = close < cfg_.max_layout_positions && ind.count(s[p - 1].start.line) &&
                          s[p].start.column < ind[s[p - 1].start.line];
        if (!want_semi && !want_open && !want_close) continue;
        if (!expected(s, p, &exp)) continue;
        if (want_semi && contains(exp, TokenKind::Semi)) {
          add({make_edit(s, EditOp::Insert, p, TokenKind::Semi, "line-end")}, s);
          (*singles)++;
          semi++;
        }
        if (want_open && contains(exp, TokenKind::LBrace)) {
          add({make_edit(s, EditOp::Insert, p, TokenKind::LBrace, "indent-open")}, s);
          (*singles)++;
          open++;
        }
        if (want_close && contains(exp, TokenKind::RBrace)) {
          add({make_edit(s, EditOp::Insert, p, TokenKind::RBrace, "indent-close")}, s);
          (*singles)++;
          close++;
        }
      }
      // Doubled delimiters ("{{", "))", ",,") further back than the window.
      int dups = 0;
      for (int p = e - cfg_.window_back - 1; p >= std::max(1, e - cfg_.layout_reach) && !R_.budget.exhausted; --p) {
        if (dups >= cfg_.max_layout_positions) break;
        TokenKind k = s[p].kind;
        bool delim = k == TokenKind::LBrace || k == TokenKind::RBrace || k == TokenKind::LParen ||
                     k == TokenKind::RParen || k == TokenKind::Comma || k == TokenKind::LBracket ||
                     k == TokenKind::RBracket;
        if (!delim || s[p - 1].kind != k || s[p].origin < 0) continue;
        add({make_edit(s, EditOp::Delete, p, TokenKind::Semi, "duplicate")}, s);
        (*singles)++;
        dups++;
      }
    }

    // Cost-2 search (iterative deepening on cost): only when no single edit
    // repairs the error. Seeds are single edits that did not make things
    // worse; the second edit is searched around the seed's new error.
    bool any_single = std::any_of(out.begin(), out.end(), [](const Candidate& c) { return outcome_accepted(c.outcome); });
    if (!any_single && cfg_.max_edits >= 2 && !R_.budget.exhausted) {
      std::vector<const Candidate*> seeds;
      for (const Candidate& c : out)
        if (c.outcome == Outcome::DefersError || c.outcome == Outcome::SameLocation) seeds.push_back(&c);
      std::stable_sort(seeds.begin(), seeds.end(), [](const Candidate* a, const Candidate* b) {
        if (a->next_error_origin != b->next_error_origin) return a->next_error_origin > b->next_error_origin;
        return a->cost < b->cost;
      });
      if (static_cast<int>(seeds.size()) > cfg_.max_pair_seeds) seeds.resize(cfg_.max_pair_seeds);
      std::vector<Candidate> seed_copies;
      for (const Candidate* c : seeds) seed_copies.push_back(*c);
      for (const Candidate& seed : seed_copies) {
        if (R_.budget.exhausted) break;
        const std::vector<Token>& st = seed.stream;
        const int ssz = static_cast<int>(st.size());
        int j = seed.next_error_stream;
        int lo = std::max(seed.edits.front().pos, j - 2);
        for (int p = j; p >= lo && !R_.budget.exhausted; --p) {
          std::vector<TokenKind> exp;
          if (!expected(st, p, &exp)) continue;
          for (TokenKind k : exp) {
            if (k == TokenKind::EndOfFile) continue;
            auto edits = seed.edits;
            Edit e2 = make_edit(st, EditOp::Insert, p, k, "pair");
            edits.push_back(e2);
            add(edits, s);
            (*pairs)++;
          }
          if (p < ssz && st[p].origin >= 0) {
            auto edits = seed.edits;
            edits.push_back(make_edit(st, EditOp::Delete, p, TokenKind::Semi, "pair"));
            add(edits, s);
            (*pairs)++;
          }
        }
      }
    }

    // Full analysis of accepted candidates: reconstruct, re-lex, re-parse.
    for (Candidate& c : out) {
      if (!outcome_accepted(c.outcome) || R_.budget.exhausted) continue;
      analyse(c);
    }
    return out;
  }

  void analyse(Candidate& c) {
    c.analysed = true;
    c.source = reconstruct_source(R_.source, R_.lexed.tokens, c.stream);
    LexResult lx = lex(c.source);
    bool same = lx.tokens.size() == c.stream.size();
    for (size_t i = 0; same && i < lx.tokens.size(); ++i)
      same = lx.tokens[i].kind == c.stream[i].kind && lx.tokens[i].lexeme == c.stream[i].lexeme;
    c.roundtrip_ok = same;
    if (!same) {
      c.outcome = Outcome::Malformed;
      c.reason = "reconstructed source does not re-lex to the edited token stream";
      return;
    }
    c.relexed = std::move(lx.tokens);
    R_.budget.spend();
    c.full = parse_tokens(c.relexed, ParseOptions{});
    c.valid = c.full.ok();
    if (c.valid != (c.outcome == Outcome::Valid)) {
      // Token-level and source-level validation disagree: never trust it.
      c.outcome = Outcome::Malformed;
      c.reason = "source-level parse disagrees with token-level validation";
      return;
    }
    if (c.valid) {
      c.canon = canonical_form(c.full.root);
      c.name_warnings = check_names(c.full.root);
      c.indentation_mismatches = indentation_mismatches(c.full.root, c.relexed);
    } else if (c.full.recovered_root) {
      c.canon = "recovered:" + canonical_form(c.full.recovered_root);
    } else {
      c.canon = "tokens:" + stream_key(c.stream);
    }
    c.ast_hash = hex64(fnv1a64(c.canon));
  }

  // ------------------------------------------------------------ evidence
  void add_ev(Candidate& c, const char* name, const char* group, double value, double weight,
              const std::string& why) {
    EvidenceItem it;
    it.name = name;
    it.group = group;
    it.value = value;
    it.weight = weight;
    it.contribution = value * weight;
    it.explanation = why;
    c.evidence.push_back(std::move(it));
  }

  void score_local(std::vector<Candidate>& cands, int e, int base_residual) {
    int min_warn = std::numeric_limits<int>::max();
    int min_indent = std::numeric_limits<int>::max();
    for (const Candidate& c : cands) {
      if (!c.analysed || !c.valid || !outcome_accepted(c.outcome)) continue;
      min_warn = std::min(min_warn, static_cast<int>(c.name_warnings.size()));
      min_indent = std::min(min_indent, c.indentation_mismatches);
    }
    for (Candidate& c : cands) {
      if (!c.analysed || !outcome_accepted(c.outcome)) continue;
      c.evidence.clear();
      int placeholders = 0, deleted = 0, semi = 0, brace = 0, dup = 0;
      for (const Edit& ed : c.edits) {
        if (ed.op != EditOp::Delete && is_placeholder_kind(ed.kind)) placeholders++;
        if (ed.op != EditOp::Insert && is_content_kind(ed.removed_kind)) deleted++;
        if (ed.support == "line-end-semicolon") semi++;
        if (ed.support == "indentation-brace") brace++;
        if (ed.support == "duplicate-deletion") dup++;
      }
      // Layout-generated edits are far from the detection point by design and
      // carry their own evidence, so the distance prior applies only to
      // edits proposed by the local window / pair search.
      const Edit& first = c.edits.front();
      bool local_gen = first.generator == "window" || first.generator == "pair";
      int dist = local_gen ? std::min(cfg_.distance_cap, std::abs(e - first.pos)) : 0;
      add_ev(c, "edit_cost", "edit", c.cost, cfg_.w_cost,
             "total edit cost (insert 1, delete 1, replace 1.5)");
      add_ev(c, "resolves_all_errors", "parser", c.valid ? 1 : 0, cfg_.w_resolves_all,
             c.valid ? "the repaired program parses with no remaining errors"
                     : "later syntax errors remain after this edit");
      add_ev(c, "placeholder_tokens", "edit", placeholders, cfg_.w_placeholder,
             "identifiers/literals that had to be invented (e.g. __hole, 0)");
      add_ev(c, "deleted_content", "edit", deleted, cfg_.w_deleted_content,
             "user-written names, literals or keywords removed or overwritten");
      add_ev(c, "distance_from_error", "parser", dist, cfg_.w_distance,
             "token distance between the edit and the parser's detection point (capped at " +
                 std::to_string(cfg_.distance_cap) + "; not applied to layout-generated edits)");
      add_ev(c, "line_end_semicolon", "layout", semi, cfg_.w_line_end_semicolon,
             "';' inserted exactly at a line break");
      add_ev(c, "indentation_brace", "layout", brace, cfg_.w_indentation_brace,
             "brace inserted where indentation changes (or at end of input)");
      add_ev(c, "duplicate_deletion", "layout", dup, cfg_.w_duplicate_deletion,
             "deletes a delimiter/operator that is doubled next to itself");
      if (cfg_.layout) {
        int mis = c.valid ? std::min(4, c.indentation_mismatches - min_indent) : 0;
        add_ev(c, "indentation_mismatch", "layout", mis, cfg_.w_indentation_mismatch,
               "statements whose indentation disagrees with the block structure of the repaired AST "
               "(relative to the most consistent valid alternative)");
      }
      int warn = c.valid ? static_cast<int>(c.name_warnings.size()) - min_warn : 0;
      add_ev(c, "name_warnings", "names", warn, cfg_.w_name_warnings,
             "extra undeclared/duplicate-name warnings compared with the best valid alternative");
      int residual = static_cast<int>(c.full.diagnostics.size());
      if (cfg_.stability) {
        add_ev(c, "residual_errors", "stability", std::min(residual, 6), cfg_.w_residual,
               "diagnostics left by panic-mode recovery on the repaired program");
        add_ev(c, "cascade", "stability", residual > base_residual - 1 ? 1 : 0, cfg_.w_cascade,
               "1 if the repair did not reduce the total number of diagnostics (" +
                   std::to_string(base_residual) + " before, " + std::to_string(residual) + " after)");
      }
      double s = 0;
      for (const EvidenceItem& it : c.evidence) s += it.contribution;
      c.local_score = s;
      c.score = s;
    }
  }

  static bool better(const Candidate& a, const Candidate& b) {
    if (a.score != b.score) return a.score > b.score;
    if (a.cost != b.cost) return a.cost < b.cost;
    return a.order < b.order;
  }

  std::vector<CandidateClass> group(std::vector<Candidate>& cands, std::vector<int>* ranked) {
    ranked->clear();
    for (int i = 0; i < static_cast<int>(cands.size()); ++i)
      if (cands[i].analysed && outcome_accepted(cands[i].outcome)) ranked->push_back(i);
    std::stable_sort(ranked->begin(), ranked->end(),
                     [&](int a, int b) { return better(cands[a], cands[b]); });
    std::vector<CandidateClass> classes;
    std::map<std::string, int> idx;
    for (int i : *ranked) {
      Candidate& c = cands[i];
      std::string key = cfg_.grouping ? c.canon : "candidate:" + stream_key(c.stream);
      auto it = idx.find(key);
      if (it == idx.end()) {
        CandidateClass k;
        k.id = static_cast<int>(classes.size());
        k.key = key;
        k.ast_hash = c.ast_hash;
        k.complete_ast = c.valid;
        k.best_score = c.score;
        k.min_cost = c.cost;
        idx[key] = k.id;
        classes.push_back(k);
        it = idx.find(key);
      }
      CandidateClass& k = classes[it->second];
      k.members.push_back(i);
      k.min_cost = std::min(k.min_cost, c.cost);
      c.class_id = k.id;
    }
    int r = 1;
    for (int i : *ranked) cands[i].rank = r++;
    return classes;
  }

  // ------------------------------------------------------------ lanes
  void explore(int root_class, std::vector<Token> stream, std::vector<LaneStep> steps, double cost,
               double score_sum, int depth) {
    auto leaf = [&](bool valid, const std::string& why) {
      LaneLeaf L;
      L.root_class = root_class;
      L.steps = steps;
      L.stream = stream;
      L.valid = valid;
      L.stop_reason = why;
      L.total_cost = cost;
      L.score_sum = score_sum;
      R_.leaves.push_back(std::move(L));
    };
    int j = first_error(stream);
    if (j < 0) return leaf(true, "valid");
    if (depth >= cfg_.max_depth) {
      R_.lanes_truncated = true;
      return leaf(false, "depth-limit");
    }
    if (static_cast<int>(R_.leaves.size()) >= cfg_.max_leaves || R_.budget.exhausted) {
      R_.lanes_truncated = true;
      return leaf(false, "budget");
    }
    int s1 = 0, s2 = 0, d = 0;
    int base_residual = cfg_.stability ? residual_count(stream) : 0;
    std::vector<Candidate> cands = generate_step(stream, j, &s1, &s2, &d);
    score_local(cands, j, base_residual);
    std::vector<int> ranked;
    std::vector<CandidateClass> classes = group(cands, &ranked);
    if (classes.empty()) return leaf(false, R_.budget.exhausted ? "budget" : "no-candidate");

    LaneStep step;
    step.depth = depth;
    step.error_origin = origin_at(stream, j, n_);
    step.error_kind = j < static_cast<int>(stream.size()) ? token_kind_name(stream[j].kind) : "EOF";
    step.error_at = j < static_cast<int>(stream.size()) ? stream[j].start : R_.lexed.eof;
    step.alternatives = static_cast<int>(classes.size());
    if (classes.size() >= 2) {
      step.has_margin = true;
      step.margin = cands[classes[0].members[0]].score - cands[classes[1].members[0]].score;
    }
    int branch = std::min<int>(cfg_.lane_branch, static_cast<int>(classes.size()));
    for (int b = 0; b < branch; ++b) {
      if (b > 0 && static_cast<int>(R_.leaves.size()) >= cfg_.max_leaves) {
        R_.lanes_truncated = true;
        break;
      }
      const Candidate& rep = cands[classes[b].members[0]];
      LaneStep st = step;
      st.edits = rep.edits;
      st.candidate_summary = describe_edits(rep.edits);
      auto next_steps = steps;
      next_steps.push_back(st);
      explore(root_class, rep.stream, next_steps, cost + rep.cost, score_sum + rep.score, depth + 1);
    }
  }

  // ------------------------------------------------------------ main
  void run() {
    RepairReport& R = R_;
    auto t0 = Clock::now();

    // Stage: localisation
    ParseOptions first;
    first.stop_at_first_error = true;
    R.original_first = parse_tokens(R.lexed.tokens, first);
    R.budget.spend(2);
    if (R.original.ok()) {
      R.stages.push_back({"localise", "ran", ms_since(t0), "no syntax error: nothing to repair"});
      decide();
      return;
    }
    R.error_index = R.original_first.first_error_index();
    if (R.error_index < 0) R.error_index = n_;
    if (!R.original_first.diagnostics.empty()) R.expected_at_error = R.original_first.diagnostics[0].expected;
    R.stages.push_back({"localise", "ran", ms_since(t0),
                        "first error at token " + std::to_string(R.error_index) + " with " +
                            std::to_string(R.expected_at_error.size()) + " expected token kinds"});

    // The parser ran out of stack (nesting too deep). That is a capacity
    // limit, not a syntax error: editing tokens near the limit cannot give a
    // program the parser accepts, so do not search for one.
    if (R.original.resource_limit || R.original_first.resource_limit) {
      R.stages.push_back({"generate-and-validate", "skipped", 0.0,
                          "parser nesting limit reached: no token edit can make this input parse"});
      Decision& D = R.decision;
      D.tau = cfg_.tau;
      D.status = "UNSUPPORTED_CONSTRUCT";
      D.summary = "The input nests deeper than the parser supports (parser stack limit); this is a capacity limit, "
                  "not a syntax error.";
      D.reasons.push_back("parser resource limit reached at the first error; reduce the nesting depth");
      R.stages.push_back({"decide", "ran", 0.0, D.status});
      return;
    }

    // Stage: generation + token-level validation + source round trip
    auto t1 = Clock::now();
    int dups = 0;
    R.candidates = generate_step(R.lexed.tokens, R.error_index, &R.generated_singles, &R.generated_pairs, &dups);
    R.duplicates = dups;
    int accepted = 0, malformed = 0;
    for (const Candidate& c : R.candidates) {
      if (outcome_accepted(c.outcome)) accepted++;
      if (c.outcome == Outcome::Malformed) malformed++;
    }
    R.stages.push_back({"generate-and-validate", R.budget.exhausted ? "budget-exhausted" : "ran", ms_since(t1),
                        std::to_string(R.generated_singles) + " single-edit and " +
                            std::to_string(R.generated_pairs) + " two-edit candidates; " +
                            std::to_string(accepted) + " accepted by the parser, " + std::to_string(dups) +
                            " duplicates, " + std::to_string(malformed) + " failed the source round trip"});

    // Stage: evidence + ranking + grouping
    auto t2 = Clock::now();
    int base_residual = static_cast<int>(R.original.diagnostics.size());
    score_local(R.candidates, R.error_index, base_residual);
    R.classes = group(R.candidates, &R.ranked);
    R.stages.push_back({"rank-and-group", "ran", ms_since(t2),
                        std::to_string(R.ranked.size()) + " ranked candidates in " +
                            std::to_string(R.classes.size()) +
                            (cfg_.grouping ? " structural (AST) classes" : " classes (grouping disabled)")});

    // Stage: hypothesis lanes
    auto t3 = Clock::now();
    int roots = std::min<int>(cfg_.lane_roots, static_cast<int>(R.classes.size()));
    for (int k = 0; k < roots; ++k) {
      Candidate& rep = R.candidates[R.classes[k].members[0]];
      LaneStep st;
      st.depth = 0;
      st.edits = rep.edits;
      st.error_origin = R.error_index;
      st.error_kind = R.error_index < n_ ? token_kind_name(R.lexed.tokens[R.error_index].kind) : "EOF";
      st.error_at = R.error_index < n_ ? R.lexed.tokens[R.error_index].start : R.lexed.eof;
      st.alternatives = static_cast<int>(R.classes.size());
      st.candidate_summary = describe_edits(rep.edits);
      explore(k, rep.stream, {st}, rep.cost, rep.score, 1);
    }
    if (static_cast<int>(R.classes.size()) > roots) R.lanes_truncated = true;

    // Completion evidence (follow-on stability) and final scores.
    std::vector<double> completion(R.classes.size(), std::numeric_limits<double>::quiet_NaN());
    for (const LaneLeaf& L : R.leaves) {
      if (!L.valid) continue;
      double extra = L.total_cost - R.candidates[R.classes[L.root_class].members[0]].cost;
      double& cur = completion[L.root_class];
      if (std::isnan(cur) || extra < cur) cur = extra;
    }
    for (int i : R.ranked) {
      Candidate& c = R.candidates[i];
      if (!cfg_.stability) continue;
      double contrib;
      std::string why;
      double value;
      if (c.valid) {
        value = 0;
        contrib = 0;
        why = "already a complete program";
      } else if (c.class_id < roots && !std::isnan(completion[c.class_id])) {
        value = completion[c.class_id];
        contrib = value * cfg_.w_completion;
        why = "extra edit cost needed to repair the follow-on errors on this hypothesis";
      } else {
        value = -1;
        contrib = cfg_.unreached_completion_penalty;
        why = c.class_id < roots ? "follow-on errors could not be repaired within the search limits"
                                 : "hypothesis not explored (outside the top lanes): conservative penalty";
      }
      EvidenceItem it;
      it.name = "completion";
      it.group = "stability";
      it.value = value;
      it.weight = value >= 0 ? cfg_.w_completion : cfg_.unreached_completion_penalty;
      it.contribution = contrib;
      it.explanation = why;
      c.evidence.push_back(it);
      c.score = c.local_score + contrib;
    }
    // Re-rank with the stability evidence included.
    std::vector<int> old_class_of(R.candidates.size(), -1);
    for (int i : R.ranked) old_class_of[i] = R.candidates[i].class_id;
    R.classes = group(R.candidates, &R.ranked);
    // Leaves refer to old class ids: remap through their representative.
    std::map<int, int> remap;
    for (int i : R.ranked) remap[old_class_of[i]] = R.candidates[i].class_id;
    for (LaneLeaf& L : R.leaves) L.root_class = remap.count(L.root_class) ? remap[L.root_class] : L.root_class;

    // A structurally distinct, already-valid class may rank in the top three
    // without having been explored as a lane; give it its trivial plan.
    for (int k = 0; k < std::min<int>(3, R.classes.size()); ++k) {
      if (best_leaf_for(k) >= 0) continue;
      const Candidate& rep = R.candidates[R.classes[k].members[0]];
      if (!rep.valid) continue;
      LaneLeaf L;
      L.root_class = k;
      LaneStep st;
      st.edits = rep.edits;
      st.error_origin = R.error_index;
      st.error_kind = R.error_index < n_ ? token_kind_name(R.lexed.tokens[R.error_index].kind) : "EOF";
      st.error_at = R.error_index < n_ ? R.lexed.tokens[R.error_index].start : R.lexed.eof;
      st.alternatives = static_cast<int>(R.classes.size());
      st.candidate_summary = describe_edits(rep.edits);
      L.steps.push_back(st);
      L.stream = rep.stream;
      L.valid = true;
      L.stop_reason = "valid";
      L.total_cost = rep.cost;
      L.score_sum = rep.score;
      R.leaves.push_back(std::move(L));
    }

    compute_stability();
    R.stages.push_back({"hypothesis-lanes", R.lanes_truncated ? "truncated" : "ran", ms_since(t3),
                        std::to_string(roots) + " root hypotheses, " + std::to_string(R.leaves.size()) +
                            " leaves" + (R.lanes_truncated ? " (search limits reached)" : "")});
    auto t4 = Clock::now();
    decide();
    R.stages.push_back({"decide", "ran", ms_since(t4), R.decision.status});
  }

  int best_leaf_for(int cls) {
    int best = -1;
    for (int i = 0; i < static_cast<int>(R_.leaves.size()); ++i) {
      const LaneLeaf& L = R_.leaves[i];
      if (L.root_class != cls) continue;
      if (best < 0) {
        best = i;
        continue;
      }
      const LaneLeaf& B = R_.leaves[best];
      if (L.valid != B.valid) {
        if (L.valid) best = i;
        continue;
      }
      if (L.total_cost != B.total_cost) {
        if (L.total_cost < B.total_cost) best = i;
        continue;
      }
      if (L.score_sum > B.score_sum) best = i;
    }
    return best;
  }

  void compute_stability() {
    std::map<int, std::set<int>> sites;  // root class -> follow-on error origins
    std::set<int> roots;
    for (const LaneLeaf& L : R_.leaves) roots.insert(L.root_class);
    for (int cls : roots) {
      std::set<int>& S = sites[cls];
      int bl = best_leaf_for(cls);
      if (bl >= 0)
        for (const LaneStep& st : R_.leaves[bl].steps)
          if (st.depth >= 1) S.insert(st.error_origin);
      const Candidate& rep = R_.candidates[R_.classes[cls].members[0]];
      for (const SyntaxDiagnostic& d : rep.full.diagnostics) S.insert(origin_at(rep.stream, d.token_index, n_));
    }
    std::map<int, int> counts;
    for (auto& [cls, S] : sites)
      for (int o : S) counts[o]++;
    int total = static_cast<int>(sites.size());
    for (auto& [o, cnt] : counts) {
      StabilityEntry e;
      e.origin = o;
      e.at = o < n_ ? R_.lexed.tokens[o].start : R_.lexed.eof;
      e.token = o < n_ ? R_.lexed.tokens[o].lexeme : "<end of input>";
      e.hypotheses_with = cnt;
      e.hypotheses_total = total;
      e.stable = total >= 2 && cnt == total;
      R_.stability.push_back(e);
    }
  }

  void decide() {
    RepairReport& R = R_;
    Decision& D = R.decision;
    D.tau = cfg_.tau;
    if (R.original.ok()) {
      D.status = "NO_REPAIR_NEEDED";
      D.summary = "The program parses without syntax errors.";
      return;
    }
    bool unsupported = R.error_index >= 0 && R.error_index < n_ &&
                       R.lexed.tokens[R.error_index].kind == TokenKind::Unsupported;
    for (int k = 0; k < std::min<int>(3, R.classes.size()); ++k) {
      int bl = best_leaf_for(k);
      if (bl >= 0) D.top_plans.push_back(bl);
      else if (k == 0) break;  // the best class has no plan: nothing to recommend
    }
    if (unsupported && cfg_.abstention) {
      D.status = "UNSUPPORTED_CONSTRUCT";
      D.summary = R.lexed.tokens[R.error_index].message;
      D.reasons.push_back("the first error is a C construct that MiniC deliberately does not support; "
                          "any token-level 'repair' would change the program's meaning");
      if (!D.top_plans.empty()) D.recommended_leaf = D.top_plans[0];
      return;
    }
    if (R.classes.empty()) {
      D.status = R.budget.exhausted ? "BUDGET_EXHAUSTED" : "NO_SAFE_REPAIR";
      D.summary = R.budget.exhausted ? "The search budget ran out before any candidate was validated."
                                     : "No candidate edit within the search bounds lets the parser continue.";
      D.reasons.push_back(std::to_string(R.candidates.size()) + " candidates were generated and all were rejected");
      return;
    }
    int bl = D.top_plans.empty() ? -1 : D.top_plans[0];
    D.recommended_leaf = bl;
    const LaneLeaf* leaf = bl >= 0 ? &R.leaves[bl] : nullptr;

    // Margin between the best and the second-best structurally distinct
    // hypothesis, at the root and at every later step of the chosen plan.
    if (R.classes.size() >= 2) {
      D.has_margin = true;
      D.margin = R.candidates[R.classes[0].members[0]].score - R.candidates[R.classes[1].members[0]].score;
    }
    if (leaf) {
      for (const LaneStep& st : leaf->steps) {
        if (st.depth == 0 || !st.has_margin) continue;
        if (!D.has_margin || st.margin < D.margin) {
          D.margin = st.margin;
          D.has_margin = true;
        }
      }
    }

    if (!leaf || !leaf->valid) {
      D.status = R.budget.exhausted ? "BUDGET_EXHAUSTED" : "LOW_CONFIDENCE";
      D.summary = "The best repair fixes the first error, but the remaining errors could not be repaired within the search limits.";
      D.reasons.push_back("no complete repair plan reached a valid program");
      if (!cfg_.abstention && leaf) D.status = "RECOMMENDED";
      return;
    }
    if (!cfg_.abstention) {
      D.status = "RECOMMENDED";
      D.summary = "Top-ranked repair (abstention disabled for this run).";
      D.reasons.push_back("abstention policy disabled: the top-ranked plan is always returned");
      return;
    }
    int placeholders = 0;
    for (const LaneStep& st : leaf->steps)
      for (const Edit& e : st.edits)
        if (e.op != EditOp::Delete && is_placeholder_kind(e.kind)) placeholders++;
    if (placeholders > 0) {
      D.status = "LOW_CONFIDENCE";
      D.summary = "The best repair has to invent an identifier or literal; the intended name/value is unknown.";
      D.reasons.push_back(std::to_string(placeholders) + " placeholder token(s) in the best plan");
      return;
    }
    // A lexical-error token that spans several lines (an unterminated block
    // comment) usually hides real code. Deleting or replacing it parses, but
    // silently throws that code away, so never recommend it.
    for (const LaneStep& st : leaf->steps)
      for (const Edit& e : st.edits)
        if (e.op != EditOp::Insert && e.removed_kind == TokenKind::Error && e.anchor_origin >= 0 &&
            e.anchor_origin < n_) {
          // The token's lexeme is only "/*"; its span covers everything it swallowed.
          const Token& t = R.lexed.tokens[e.anchor_origin];
          if (t.kind != TokenKind::Error || t.end.line <= t.start.line) continue;
          D.status = "LOW_CONFIDENCE";
          D.summary = "The best repair removes a multi-line lexical error (for example an unterminated comment) "
                      "and with it the source text inside it.";
          D.reasons.push_back("the plan discards lines " + std::to_string(t.start.line) + "-" +
                              std::to_string(t.end.line) +
                              " hidden inside a lexical-error token; check what they contain");
          return;
        }
    if (D.has_margin && D.margin < cfg_.tau) {
      D.status = "MULTIPLE_PLAUSIBLE";
      D.summary = "Several structurally different repairs have similar evidence.";
      D.reasons.push_back("score margin " + fmt2(D.margin) + " is below the threshold tau = " + fmt2(cfg_.tau));
      return;
    }
    D.status = "RECOMMENDED";
    D.summary = "One repair is clearly better supported than every structurally different alternative.";
    if (D.has_margin)
      D.reasons.push_back("score margin " + fmt2(D.margin) + " >= tau = " + fmt2(cfg_.tau));
    else
      D.reasons.push_back("only one structurally distinct repair was found");
    D.reasons.push_back("the plan yields a complete, parser-validated program");
  }

 private:
  const RepairConfig& cfg_;
  RepairReport& R_;
  int n_ = 0;
};

RepairConfig normalise(RepairConfig cfg) {
  if (cfg.strategy == "least-cost") {
    // Baseline C: cost is the only evidence, first-generated wins ties, no
    // grouping, a single greedy lane and no abstention.
    double wc = cfg.w_cost;
    cfg.w_resolves_all = cfg.w_placeholder = cfg.w_deleted_content = cfg.w_distance = 0;
    cfg.w_line_end_semicolon = cfg.w_indentation_brace = cfg.w_duplicate_deletion = 0;
    cfg.w_name_warnings = 0;
    cfg.w_indentation_mismatch = 0;
    cfg.w_cost = wc;
    cfg.stability = false;
    cfg.grouping = false;
    cfg.layout = false;
    cfg.abstention = false;
    cfg.lane_roots = 1;
    cfg.lane_branch = 1;
  }
  return cfg;
}

}  // namespace

RepairReport run_repair(const std::string& source, const RepairConfig& in_cfg) {
  RepairReport R;
  R.config = normalise(in_cfg);
  R.source = source;
  R.budget.start = Clock::now();
  R.budget.max_parses = R.config.max_parses;
  R.budget.time_limit_ms = R.config.time_limit_ms;

  auto t = Clock::now();
  R.lexed = lex(source);
  R.stages.push_back({"lex", "ran", ms_since(t),
                      std::to_string(R.lexed.tokens.size()) + " tokens, " + std::to_string(R.lexed.error_count) +
                          " lexical errors, " + std::to_string(R.lexed.unsupported_count) + " unsupported"});
  t = Clock::now();
  R.original = parse_tokens(R.lexed.tokens, ParseOptions{});
  R.stages.push_back({"parse", "ran", ms_since(t),
                      R.original.ok() ? "valid program"
                                      : std::to_string(R.original.diagnostics.size()) +
                                            " diagnostics with panic-mode recovery"});
  Engine eng(R.config, R);
  eng.run();
  return R;
}

}  // namespace parallax
