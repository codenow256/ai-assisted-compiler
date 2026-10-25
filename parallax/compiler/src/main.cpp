// parallaxc — command-line front end. Reads MiniC source from stdin (or
// --file PATH), writes one JSON document to stdout.
//
//   parallaxc lex
//   parallaxc analyze [--trace]
//   parallaxc repair [--strategy parallax|least-cost] [--no-grouping]
//                    [--no-stability] [--no-abstention] [--no-layout]
//                    [--tau X] [--max-parses N] [--time-limit-ms X]
//                    [--max-depth N] [--lane-roots N] [--max-leaves N]
//   parallaxc tree      (readable AST dump, for humans)
//   parallaxc version
//
// Exit status: 0 = a JSON document was produced (syntax errors are data,
// not failures); 2 = usage error; 3 = input rejected (too large).
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <iterator>
#include <sstream>
#include <string>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

#include "parallax/json.hpp"
#include "parallax/repair.hpp"
#include "parallax/serialize.hpp"

using namespace parallax;

namespace {

constexpr size_t kMaxInputBytes = 64 * 1024;
constexpr const char* kVersion = "1.0.0";

int usage(const std::string& msg) {
  JsonWriter w;
  w.begin_object().kv("schema_version", kSchemaVersion).key("error").begin_object()
      .kv("code", "USAGE").kv("message", msg).end_object().end_object();
  std::cout << w.str() << "\n";
  return 2;
}

bool parse_int(const char* s, int lo, int hi, int* out) {
  char* end = nullptr;
  long v = std::strtol(s, &end, 10);
  if (!end || *end || v < lo || v > hi) return false;
  *out = static_cast<int>(v);
  return true;
}

bool parse_double(const char* s, double lo, double hi, double* out) {
  char* end = nullptr;
  double v = std::strtod(s, &end);
  if (!end || *end || !(v >= lo && v <= hi)) return false;
  *out = v;
  return true;
}

}  // namespace

int main(int argc, char** argv) {
#ifdef _WIN32
  // Text-mode stdio on Windows would turn "\r\n" into "\n" (shifting every
  // byte offset) and treat Ctrl-Z as end of input. Use binary mode so the
  // compiler sees exactly the bytes the backend sent.
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  std::ios::sync_with_stdio(false);
  if (argc < 2) return usage("missing mode: lex | analyze | repair | tree | version");
  std::string mode = argv[1];
  if (mode == "version") {
    JsonWriter w;
    w.begin_object().kv("schema_version", kSchemaVersion).kv("name", "parallaxc").kv("version", kVersion)
        .kv("language", "MiniC").kv("bison_lac", true).kv("max_input_bytes", static_cast<int>(kMaxInputBytes))
        .end_object();
    std::cout << w.str() << "\n";
    return 0;
  }

  RepairConfig cfg;
  bool trace = false;
  std::string file;
  for (int i = 2; i < argc; ++i) {
    std::string a = argv[i];
    auto need = [&](const char* what) -> const char* {
      if (i + 1 >= argc) return nullptr;
      (void)what;
      return argv[++i];
    };
    if (a == "--trace") trace = true;
    else if (a == "--no-grouping") cfg.grouping = false;
    else if (a == "--no-stability") cfg.stability = false;
    else if (a == "--no-abstention") cfg.abstention = false;
    else if (a == "--no-layout") cfg.layout = false;
    else if (a == "--strategy") {
      const char* v = need("strategy");
      if (!v || (std::string(v) != "parallax" && std::string(v) != "least-cost"))
        return usage("--strategy must be parallax or least-cost");
      cfg.strategy = v;
    } else if (a == "--tau") {
      const char* v = need("tau");
      if (!v || !parse_double(v, -100, 100, &cfg.tau)) return usage("--tau expects a number in [-100, 100]");
    } else if (a == "--max-parses") {
      const char* v = need("n");
      if (!v || !parse_int(v, 10, 1000000, &cfg.max_parses)) return usage("--max-parses expects 10..1000000");
    } else if (a == "--time-limit-ms") {
      const char* v = need("ms");
      if (!v || !parse_double(v, 1, 600000, &cfg.time_limit_ms)) return usage("--time-limit-ms expects 1..600000");
    } else if (a == "--max-depth") {
      const char* v = need("n");
      if (!v || !parse_int(v, 1, 10, &cfg.max_depth)) return usage("--max-depth expects 1..10");
    } else if (a == "--lane-roots") {
      const char* v = need("n");
      if (!v || !parse_int(v, 1, 10, &cfg.lane_roots)) return usage("--lane-roots expects 1..10");
    } else if (a == "--max-leaves") {
      const char* v = need("n");
      if (!v || !parse_int(v, 1, 100, &cfg.max_leaves)) return usage("--max-leaves expects 1..100");
    } else if (a == "--window") {
      const char* v = need("n");
      if (!v || !parse_int(v, 0, 10, &cfg.window_back)) return usage("--window expects 0..10");
    } else if (a == "--max-edits") {
      const char* v = need("n");
      if (!v || !parse_int(v, 1, 2, &cfg.max_edits)) return usage("--max-edits expects 1 or 2");
    } else if (a == "--file") {
      const char* v = need("path");
      if (!v) return usage("--file expects a path");
      file = v;
    } else {
      return usage("unknown option: " + a);
    }
  }

  std::string source;
  if (!file.empty()) {
    std::ifstream in(file, std::ios::binary);
    if (!in) return usage("cannot read input file");
    source.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
  } else {
    source.assign(std::istreambuf_iterator<char>(std::cin), std::istreambuf_iterator<char>());
  }
  if (source.size() > kMaxInputBytes) {
    JsonWriter w;
    w.begin_object().kv("schema_version", kSchemaVersion).key("error").begin_object()
        .kv("code", "INPUT_TOO_LARGE")
        .kv("message", "input exceeds " + std::to_string(kMaxInputBytes) + " bytes")
        .end_object().end_object();
    std::cout << w.str() << "\n";
    return 3;
  }

  if (mode == "lex") {
    std::cout << lex_document(source) << "\n";
  } else if (mode == "analyze" || mode == "parse") {
    std::cout << analyze_document(source, trace) << "\n";
  } else if (mode == "repair") {
    RepairReport R = run_repair(source, cfg);
    std::cout << repair_document(R) << "\n";
  } else if (mode == "tree") {
    LexResult lx = lex(source);
    ParseResult pr = parse_tokens(lx.tokens, ParseOptions{});
    if (pr.ok()) std::cout << pretty_tree(pr.root);
    else
      for (const SyntaxDiagnostic& d : pr.diagnostics) {
        int i = d.token_index;
        Position p = i < static_cast<int>(lx.tokens.size()) ? lx.tokens[i].start : lx.eof;
        std::cout << p.line << ":" << p.column << ": " << diagnostic_message(d, lx.tokens) << "\n";
      }
  } else {
    return usage("unknown mode: " + mode);
  }
  return 0;
}
