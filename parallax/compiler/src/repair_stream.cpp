// Token-stream edits and source reconstruction.
//
// Edits are applied to token streams (never to raw text), and the repaired
// source is rebuilt from the edited stream, re-using the user's original
// whitespace and comments. The engine then re-lexes that source and checks
// that it produces exactly the edited stream, so a token-index edit can never
// silently land at a different source position.
#include <algorithm>
#include <cstring>

#include "parallax/repair.hpp"

namespace parallax {

const char* edit_op_name(EditOp op) {
  switch (op) {
    case EditOp::Insert: return "insert";
    case EditOp::Delete: return "delete";
    case EditOp::Replace: return "replace";
  }
  return "?";
}

// Cost model (docs/REPAIR_ALGORITHM.md §Cost model):
//   insert = 1, delete = 1, replace = 1.5 (cheaper than delete+insert = 2
//   because it is one local change, dearer than a single insert/delete
//   because it both removes and invents a token).
double edit_cost(const Edit& e) {
  switch (e.op) {
    case EditOp::Insert: return 1.0;
    case EditOp::Delete: return 1.0;
    case EditOp::Replace: return 1.5;
  }
  return 1.0;
}

int origin_at(const std::vector<Token>& stream, int index, int original_size) {
  for (int i = std::max(index, 0); i < static_cast<int>(stream.size()); ++i)
    if (stream[i].origin >= 0) return stream[i].origin;
  return original_size;
}

std::string stream_key(const std::vector<Token>& stream) {
  std::string k;
  for (const Token& t : stream) {
    k += token_kind_name(t.kind);
    k += '\x1f';
    k += t.lexeme;
    k += '\x1e';
  }
  return k;
}

std::vector<Token> apply_edit(const std::vector<Token>& stream, const Edit& e) {
  std::vector<Token> out = stream;
  const int n = static_cast<int>(out.size());
  if (e.op == EditOp::Insert) {
    Token t;
    t.kind = e.kind;
    t.lexeme = e.lexeme;
    t.origin = -1;
    if (e.pos > 0 && e.pos <= n) t.start = t.end = out[e.pos - 1].end;
    else if (n > 0) t.start = t.end = out[0].start;
    out.insert(out.begin() + std::clamp(e.pos, 0, n), t);
  } else if (e.op == EditOp::Delete) {
    if (e.pos >= 0 && e.pos < n) out.erase(out.begin() + e.pos);
  } else {
    if (e.pos >= 0 && e.pos < n) {
      out[e.pos].kind = e.kind;
      out[e.pos].lexeme = e.lexeme;
      out[e.pos].message.clear();
    }
  }
  return out;
}

namespace {

bool word_char(char c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' ||
         c == '\'' || c == '.';
}
bool op_char(char c) { return c != '\0' && std::strchr("=<>!&|+-*/%", c) != nullptr; }

// Appends token text, inserting a single space if the previous character and
// the new text would otherwise lex as one token (e.g. "a"+"b", "/"+"*").
void append_token(std::string& out, const std::string& text) {
  if (!out.empty() && !text.empty()) {
    char a = out.back(), b = text.front();
    if ((word_char(a) && word_char(b)) || (op_char(a) && op_char(b))) out += ' ';
  }
  out += text;
}

bool has_newline(const std::string& s) { return s.find('\n') != std::string::npos; }

bool has_comment(const std::string& s) {
  return s.find("//") != std::string::npos || s.find("/*") != std::string::npos;
}

bool attaches_left(TokenKind k) {
  return k == TokenKind::Semi || k == TokenKind::RParen || k == TokenKind::RBracket ||
         k == TokenKind::Comma;
}

}  // namespace

std::string reconstruct_source(const std::string& original, const std::vector<Token>& orig,
                               const std::vector<Token>& stream) {
  const int n = static_cast<int>(orig.size());
  std::vector<std::string> lead(n);
  int prev_end = 0;
  for (int i = 0; i < n; ++i) {
    int s = std::clamp(orig[i].start.offset, prev_end, static_cast<int>(original.size()));
    lead[i] = original.substr(prev_end, s - prev_end);
    prev_end = std::max(prev_end, orig[i].end.offset);
  }
  std::string tail = prev_end < static_cast<int>(original.size()) ? original.substr(prev_end) : "";

  std::string out;
  int last = -1;          // last original token index whose lead was handled
  std::string carry;      // newline-bearing lead of a deleted token

  bool deleted_before = false;  // a deleted token sits just before the next original
  bool glue_next = false;       // the last emitted token was a synthetic '(' or '['
  auto skip_deleted_until = [&](int j) {
    deleted_before = false;
    for (int k = last + 1; k < j; ++k) {
      deleted_before = true;
      if (has_comment(lead[k])) out += lead[k];
      else if (has_newline(lead[k]) && carry.empty()) carry = lead[k];
    }
  };
  auto blank = [](const std::string& s) {
    return s.find_first_not_of(" \t") == std::string::npos;
  };

  for (const Token& t : stream) {
    if (t.origin >= 0 && t.origin < n && t.origin > last) {
      const int j = t.origin;
      skip_deleted_until(j);
      if (!carry.empty() && !has_newline(lead[j])) out += carry;
      else if (glue_next && blank(lead[j])) {
        // an inserted '(' or '[' hugs the token that follows it
      } else if (deleted_before && attaches_left(t.kind) && blank(lead[j])) {
        // "w * ;" minus "*" reads "w;" rather than "w ;"
      } else out += lead[j];
      carry.clear();
      append_token(out, t.lexeme);
      last = j;
      glue_next = false;
    } else {
      // Synthetic token (or an original token re-used out of order, which
      // the engine never produces; treated as synthetic for safety).
      if (attaches_left(t.kind)) {
        append_token(out, t.lexeme);
      } else {
        if (!out.empty() && out.back() != ' ' && out.back() != '\n' && out.back() != '\t') out += ' ';
        append_token(out, t.lexeme);
      }
      glue_next = t.kind == TokenKind::LParen || t.kind == TokenKind::LBracket;
    }
  }
  skip_deleted_until(n);
  if (!carry.empty() && !has_newline(tail)) out += carry;
  out += tail;
  return out;
}

}  // namespace parallax
