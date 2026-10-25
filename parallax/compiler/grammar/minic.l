/*
 * MiniC lexer (Flex). Re-entrant, in-memory, never aborts on bad input.
 * See docs/LEXER_DESIGN.md for the token table and position conventions.
 *
 * The scanner does not talk to Bison directly: it fills a std::vector<Token>
 * that the parser driver (and the repair engine) consume. This keeps the
 * parser re-entrant and lets repair candidates be validated by re-parsing an
 * edited token stream as well as re-lexing reconstructed source.
 */
%top{
#include <string>
#include <vector>
#include "parallax/token.hpp"
#include "parallax/lexer.hpp"

namespace parallax { struct LexState; }
}

%{
#include <cstdlib>

namespace parallax {
struct LexState {
  LexResult* out = nullptr;
  Position cur;        // position just after the last consumed byte
  Position tok_start;  // start of the current match
  Position comment_start;

  void advance(const char* text, int len) {
    tok_start = cur;
    for (int i = 0; i < len; ++i) {
      unsigned char b = static_cast<unsigned char>(text[i]);
      cur.offset++;
      if (b == '\n') {
        cur.line++;
        cur.column = 1;
      } else if ((b & 0xC0) != 0x80) {  // count code points, not bytes
        cur.column++;
      }
    }
  }
  void emit(TokenKind kind, const char* text, int len, const std::string& msg = "") {
    Token t;
    t.kind = kind;
    t.lexeme.assign(text, len);
    t.start = tok_start;
    t.end = cur;
    t.message = msg;
    t.origin = static_cast<int>(out->tokens.size());
    if (kind == TokenKind::Error) out->error_count++;
    if (kind == TokenKind::Unsupported) out->unsupported_count++;
    out->tokens.push_back(std::move(t));
  }
};
}  // namespace parallax

using parallax::TokenKind;
#define YY_USER_ACTION yyextra->advance(yytext, static_cast<int>(yyleng));
#define EMIT(k) yyextra->emit((k), yytext, static_cast<int>(yyleng))
#define EMIT_MSG(k, m) yyextra->emit((k), yytext, static_cast<int>(yyleng), (m))

static std::string malformed_number_message(const char* text) {
  std::string s(text);
  int dots = 0;
  bool letters = false;
  for (char c : s) {
    if (c == '.') dots++;
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_') letters = true;
  }
  if (dots > 1) return "malformed numeric literal: more than one decimal point";
  if (!s.empty() && s.back() == '.') return "malformed numeric literal: missing digits after the decimal point";
  if (letters) return "malformed numeric literal: digits immediately followed by letters";
  return "malformed numeric literal";
}

static std::string check_char_literal(const std::string& lit) {
  // lit includes both quotes
  std::string body = lit.substr(1, lit.size() - 2);
  if (body.empty()) return "empty character literal";
  for (unsigned char c : body)
    if (c >= 0x80) return "character literal must be ASCII";
  if (body[0] == '\\') {
    if (body.size() != 2) return "multi-character character literal";
    switch (body[1]) {
      case 'n': case 't': case 'r': case '0': case '\\': case '\'': case '"': return "";
      default: return std::string("invalid escape sequence '\\") + body[1] + "'";
    }
  }
  if (body.size() != 1) return "multi-character character literal";
  return "";
}
%}

%option reentrant noyywrap nounput noinput never-interactive 8bit nodefault
%option nounistd
%option warn batch
%option extra-type="parallax::LexState*"
%option prefix="minic_"

%x COMMENT

DIGIT    [0-9]
LETTER   [A-Za-z_]
IDCHAR   [A-Za-z0-9_]
EXP      [eE][+-]?{DIGIT}+

%%

"/*"                 { yyextra->comment_start = yyextra->tok_start; BEGIN(COMMENT); }
<COMMENT>"*/"        {
                       parallax::Comment c;
                       c.start = yyextra->comment_start;
                       c.end = yyextra->cur;
                       c.block = true;
                       yyextra->out->comments.push_back(c);
                       BEGIN(INITIAL);
                     }
<COMMENT>[^*\n]+     { }
<COMMENT>"*"         { }
<COMMENT>\n          { }
<COMMENT><<EOF>>     {
                       parallax::Token t;
                       t.kind = TokenKind::Error;
                       t.lexeme = "/*";
                       t.start = yyextra->comment_start;
                       t.end = yyextra->cur;
                       t.message = "unterminated block comment (missing '*/')";
                       t.origin = static_cast<int>(yyextra->out->tokens.size());
                       yyextra->out->error_count++;
                       yyextra->out->tokens.push_back(t);
                       BEGIN(INITIAL);
                       yyterminate();
                     }

"//"[^\n]*           {
                       parallax::Comment c;
                       c.start = yyextra->tok_start;
                       c.end = yyextra->cur;
                       c.block = false;
                       yyextra->out->comments.push_back(c);
                     }

[ \t\r\f\v]+         { }
\n                   { }

"int"                { EMIT(TokenKind::KwInt); }
"float"              { EMIT(TokenKind::KwFloat); }
"char"               { EMIT(TokenKind::KwChar); }
"bool"               { EMIT(TokenKind::KwBool); }
"void"               { EMIT(TokenKind::KwVoid); }
"if"                 { EMIT(TokenKind::KwIf); }
"else"               { EMIT(TokenKind::KwElse); }
"while"              { EMIT(TokenKind::KwWhile); }
"for"                { EMIT(TokenKind::KwFor); }
"return"             { EMIT(TokenKind::KwReturn); }
"break"              { EMIT(TokenKind::KwBreak); }
"continue"           { EMIT(TokenKind::KwContinue); }
"true"               { EMIT(TokenKind::KwTrue); }
"false"              { EMIT(TokenKind::KwFalse); }

"struct"|"union"|"enum"|"switch"|"case"|"default"|"do"|"goto"|"typedef"|"sizeof"|"const"|"unsigned"|"signed"|"long"|"short"|"double"|"static"|"extern"|"volatile"|"register"|"auto"|"inline" {
                       EMIT_MSG(TokenKind::Unsupported, std::string("'") + yytext + "' is a C keyword that MiniC does not support");
                     }

{LETTER}{IDCHAR}*    {
                       if (yyleng > parallax::kMaxIdentifierLength)
                         EMIT_MSG(TokenKind::Error, "identifier longer than 255 characters");
                       else
                         EMIT(TokenKind::Ident);
                     }

{DIGIT}+"."{DIGIT}+{EXP}?   { EMIT(TokenKind::FloatLit); }
{DIGIT}+{EXP}               { EMIT(TokenKind::FloatLit); }
{DIGIT}+                    {
                              // MiniC int is 32-bit signed; the literal itself must fit.
                              if (yyleng > 10 || std::strtoll(yytext, nullptr, 10) > 2147483647LL)
                                EMIT_MSG(TokenKind::Error, "integer literal out of range (maximum 2147483647)");
                              else
                                EMIT(TokenKind::IntLit);
                            }
{DIGIT}+("."{DIGIT}+)?[eE][+-]?   { EMIT_MSG(TokenKind::Error, "malformed exponent: expected digits after 'e'"); }
{DIGIT}[0-9A-Za-z_.]*       { EMIT_MSG(TokenKind::Error, malformed_number_message(yytext)); }
"."{DIGIT}+                 { EMIT_MSG(TokenKind::Error, "malformed numeric literal: MiniC requires a digit before the decimal point"); }

'([^'\\\n]|\\.)*'    {
                       std::string msg = check_char_literal(std::string(yytext, yyleng));
                       if (msg.empty()) EMIT(TokenKind::CharLit);
                       else EMIT_MSG(TokenKind::Error, msg);
                     }
'([^'\\\n]|\\.)*\\?  { EMIT_MSG(TokenKind::Error, "unterminated character literal"); }

\"([^"\\\n]|\\.)*\"  { EMIT_MSG(TokenKind::Unsupported, "string literals are not part of MiniC"); }
\"([^"\\\n]|\\.)*\\? { EMIT_MSG(TokenKind::Error, "unterminated string literal (string literals are not part of MiniC)"); }
"#"[^\n]*            { EMIT_MSG(TokenKind::Unsupported, "preprocessor directives are not part of MiniC"); }

"=="                 { EMIT(TokenKind::Eq); }
"!="                 { EMIT(TokenKind::Ne); }
"<="                 { EMIT(TokenKind::Le); }
">="                 { EMIT(TokenKind::Ge); }
"&&"                 { EMIT(TokenKind::AndAnd); }
"||"                 { EMIT(TokenKind::OrOr); }
"++"|"--"            { EMIT_MSG(TokenKind::Unsupported, std::string("increment/decrement operator '") + yytext + "' is not part of MiniC; write x = x + 1"); }
"+="|"-="|"*="|"/="|"%="|"&="|"|="|"^="|"<<="|">>=" { EMIT_MSG(TokenKind::Unsupported, std::string("compound assignment '") + yytext + "' is not part of MiniC"); }
"->"|"<<"|">>"|"&"|"|"|"^"|"~"|"?"|":"|"." { EMIT_MSG(TokenKind::Unsupported, std::string("operator '") + yytext + "' is not part of MiniC"); }

"+"                  { EMIT(TokenKind::Plus); }
"-"                  { EMIT(TokenKind::Minus); }
"*"                  { EMIT(TokenKind::Star); }
"/"                  { EMIT(TokenKind::Slash); }
"%"                  { EMIT(TokenKind::Percent); }
"="                  { EMIT(TokenKind::Assign); }
"<"                  { EMIT(TokenKind::Lt); }
">"                  { EMIT(TokenKind::Gt); }
"!"                  { EMIT(TokenKind::Not); }
"("                  { EMIT(TokenKind::LParen); }
")"                  { EMIT(TokenKind::RParen); }
"{"                  { EMIT(TokenKind::LBrace); }
"}"                  { EMIT(TokenKind::RBrace); }
"["                  { EMIT(TokenKind::LBracket); }
"]"                  { EMIT(TokenKind::RBracket); }
";"                  { EMIT(TokenKind::Semi); }
","                  { EMIT(TokenKind::Comma); }

[\xC0-\xFF][\x80-\xBF]*  { EMIT_MSG(TokenKind::Error, "non-ASCII character outside a comment"); }
.                    {
                       unsigned char c = static_cast<unsigned char>(yytext[0]);
                       if (c < 0x20 || c == 0x7F)
                         EMIT_MSG(TokenKind::Error, "invalid control character");
                       else
                         EMIT_MSG(TokenKind::Error, std::string("invalid character '") + yytext + "'");
                     }

%%

namespace parallax {

LexResult lex(const std::string& source) {
  LexResult result;
  LexState state;
  state.out = &result;
  yyscan_t scanner;
  minic_lex_init_extra(&state, &scanner);
  YY_BUFFER_STATE buf = minic__scan_bytes(source.data(), static_cast<int>(source.size()), scanner);
  minic_lex(scanner);
  minic__delete_buffer(buf, scanner);
  minic_lex_destroy(scanner);
  result.eof = state.cur;
  return result;
}

}  // namespace parallax
