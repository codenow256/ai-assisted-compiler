// IntelliFix repair engine: bounded multi-candidate syntax repair with
// parser validation, evidence ranking, AST grouping, hypothesis lanes and
// confidence-aware abstention. See docs/REPAIR_ALGORITHM.md.
#pragma once

#include <chrono>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "parallax/ast.hpp"
#include "parallax/lexer.hpp"
#include "parallax/names.hpp"
#include "parallax/parser.hpp"
#include "parallax/token.hpp"

namespace parallax {

// ---------------------------------------------------------------- config
struct RepairConfig {
  std::string strategy = "parallax";  // "parallax" | "least-cost"
  bool grouping = true;               // AST equivalence classes (ablation D)
  bool stability = true;              // follow-on evidence in ranking (ablation E)
  bool abstention = true;             // confidence policy (ablation F = false)
  bool layout = true;                 // layout-informed generators / evidence

  int window_back = 3;      // edit positions considered: [e - window_back, e]
  int min_progress = 3;     // tokens that must parse after the last edit
  int max_edits = 2;        // edits per repair step (cost-2 search only if needed)
  int max_pair_seeds = 12;  // single edits extended into pairs
  int layout_reach = 60;    // tokens scanned backwards by layout generators
  int max_layout_positions = 6;

  int lane_roots = 3;   // root hypotheses explored
  int lane_branch = 2;  // alternatives explored per deeper step
  int max_depth = 4;    // repair steps per hypothesis (errors repaired)
  int max_leaves = 12;  // total hypothesis leaves

  int max_parses = 30000;      // global parser-invocation budget
  double time_limit_ms = 4000; // global wall-clock budget
  int max_reported_candidates = 40;
  int max_reported_rejections = 40;

  double tau = 1.0;  // abstention margin threshold; CLI default. The backend passes the dev-selected tau (1.5) from the stored evaluation

  // Weights of the evidence model (documented in REPAIR_ALGORITHM.md).
  double w_cost = -1.0;
  double w_resolves_all = 2.0;
  double w_placeholder = -1.5;
  double w_deleted_content = -0.75;
  double w_distance = -0.2;
  double w_line_end_semicolon = 0.75;
  double w_indentation_brace = 0.75;
  double w_duplicate_deletion = 0.5;
  double w_name_warnings = -0.75;
  double w_indentation_mismatch = -0.5;
  int distance_cap = 5;
  double w_residual = -0.5;
  double w_cascade = -1.0;
  double w_completion = -0.5;
  double unreached_completion_penalty = -2.5;
};

// ---------------------------------------------------------------- edits
enum class EditOp { Insert, Delete, Replace };
const char* edit_op_name(EditOp op);

// An edit applies to the stream produced by all previous edits of the same
// sequence; `pos` is a token index in that stream (for Insert: the gap
// before token `pos`, pos == size means "at end of input").
struct Edit {
  EditOp op = EditOp::Insert;
  int pos = 0;
  TokenKind kind = TokenKind::Semi;  // inserted / replacement kind
  std::string lexeme;                // inserted / replacement text
  TokenKind removed_kind = TokenKind::Semi;  // deleted / replaced kind
  std::string removed_lexeme;
  // Presentation (original-source coordinates)
  int anchor_origin = 0;      // original token index the edit is attached to
  Position at;                // where text is inserted / removed in the original source
  double cost = 0;
  std::string generator;      // "window", "line-end", "indent-open", "indent-close", "pair"
  // Layout / pattern support observed when the edit was generated:
  // "line-end-semicolon", "indentation-brace", "duplicate-deletion" or "".
  std::string support;
};

double edit_cost(const Edit& e);

enum class Outcome {
  Valid,          // the whole program parses
  LocalRepair,    // first error fixed; parser advanced >= min_progress past the edit
  DefersError,    // error moved later but by fewer than min_progress tokens
  SameLocation,   // still fails at the same token
  EarlierError,   // fails before the original error point
  Malformed,      // reconstructed source does not re-lex to the edited stream
  Duplicate,      // same token sequence as an earlier candidate
};
const char* outcome_name(Outcome o);
bool outcome_accepted(Outcome o);

struct EvidenceItem {
  std::string name;
  std::string group;  // "edit", "parser", "layout", "names", "stability"
  double value = 0;
  double weight = 0;
  double contribution = 0;
  std::string explanation;
};

struct Candidate {
  int id = 0;
  std::vector<Edit> edits;
  std::vector<Token> stream;
  double cost = 0;
  int order = 0;  // generation order (deterministic tie-break)
  Outcome outcome = Outcome::SameLocation;
  std::string reason;          // why rejected / what happened
  int next_error_stream = -1;  // first error in edited stream (-1 none)
  int next_error_origin = -1;  // same, in original token coordinates
  int progress = 0;
  // full analysis (accepted candidates only)
  bool analysed = false;
  bool roundtrip_ok = false;
  std::string source;
  std::vector<Token> relexed;
  ParseResult full;          // panic-mode parse of the re-lexed source
  bool valid = false;
  std::string canon;         // canonical AST (valid) or recovered-structure key
  std::string ast_hash;
  std::vector<NameWarning> name_warnings;
  int indentation_mismatches = 0;  // statements whose column disagrees with their block
  std::vector<EvidenceItem> evidence;
  double local_score = 0;  // score without stability evidence
  double score = 0;        // final score
  int class_id = -1;
  int rank = 0;
};

struct CandidateClass {
  int id = 0;
  std::string key;
  std::string ast_hash;
  bool complete_ast = false;
  std::vector<int> members;  // candidate indices, best first
  double best_score = 0;
  double min_cost = 0;
};

// ---------------------------------------------------------------- lanes
struct LaneStep {
  int depth = 0;
  std::vector<Edit> edits;     // edits of this step
  int error_origin = -1;       // error site (original coords) this step repaired
  std::string error_kind;      // unexpected token kind at that site
  Position error_at;
  int alternatives = 0;        // distinct classes available at this step
  double margin = 0;           // best - second (local score); inf => none
  bool has_margin = false;
  std::string candidate_summary;
};

struct LaneLeaf {
  int root_class = -1;
  std::vector<LaneStep> steps;
  std::vector<Token> stream;
  bool valid = false;
  std::string stop_reason;  // "valid", "depth-limit", "no-candidate", "budget"
  double total_cost = 0;
  double score_sum = 0;
};

struct StabilityEntry {
  int origin = -1;
  Position at;
  std::string token;
  int hypotheses_with = 0;
  int hypotheses_total = 0;
  bool stable = false;
};

struct RepairStage {
  std::string name;
  std::string status;  // "ran", "skipped", "failed"
  double ms = 0;
  std::string detail;
};

struct Decision {
  std::string status;  // see docs: RECOMMENDED, MULTIPLE_PLAUSIBLE, ...
  std::string summary;
  std::vector<std::string> reasons;
  int recommended_leaf = -1;  // index into leaves (best plan)
  std::vector<int> top_plans; // up to 3 leaf indices, distinct root classes
  double margin = 0;
  bool has_margin = false;
  double tau = 0;
};

struct Budget {
  int parses = 0;
  int max_parses = 0;
  double time_limit_ms = 0;
  bool exhausted = false;
  std::chrono::steady_clock::time_point start;
  bool spend(int n = 1);
  double elapsed_ms() const;
};

struct RepairReport {
  RepairConfig config;
  std::string source;
  LexResult lexed;
  ParseResult original;        // panic-mode parse of the original
  ParseResult original_first;  // stop-at-first parse
  int error_index = -1;        // first error (original token index)
  std::vector<TokenKind> expected_at_error;
  std::vector<Candidate> candidates;  // all generated (accepted + rejected)
  std::vector<int> ranked;            // indices of accepted candidates, best first
  std::vector<CandidateClass> classes;
  std::vector<LaneLeaf> leaves;
  std::vector<StabilityEntry> stability;
  bool lanes_truncated = false;
  std::vector<RepairStage> stages;
  Decision decision;
  Budget budget;
  int generated_singles = 0;
  int generated_pairs = 0;
  int duplicates = 0;
};

RepairReport run_repair(const std::string& source, const RepairConfig& cfg);

// Helpers exposed for tests.
std::vector<Token> apply_edit(const std::vector<Token>& stream, const Edit& e);
std::string reconstruct_source(const std::string& original, const std::vector<Token>& original_tokens,
                               const std::vector<Token>& stream);
int origin_at(const std::vector<Token>& stream, int index, int original_size);
// Statements that start a line but whose column differs from the first
// line-starting statement of the same block (or of the top level).
int indentation_mismatches(const Node* root, const std::vector<Token>& toks);
std::string stream_key(const std::vector<Token>& stream);

}  // namespace parallax
