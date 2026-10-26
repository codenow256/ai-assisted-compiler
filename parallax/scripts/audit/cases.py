CASES = [
 ("T01","Valid minimal program","int main() {\n  return 0;\n}\n"),
 ("T02","Valid program, several declarations","int main() {\n  int a = 1, b = 2;\n  float r = 2.5;\n  bool ok = true;\n  char c = 'x';\n  return a + b;\n}\n"),
 ("T03","Operator precedence","int f(int a, int b, int c) {\n  return a + b * c - a / b;\n}\n"),
 ("T04","Nested parentheses","int main() {\n  int x = ((1 + 2) * (3 - (4 / 2)));\n  return x;\n}\n"),
 ("T05","Functions and calls","int add(int a, int b) {\n  return a + b;\n}\n\nint main() {\n  return add(1, add(2, 3));\n}\n"),
 ("T06","Conditionals and loops","int main() {\n  int i;\n  int s = 0;\n  for (i = 0; i < 10; i = i + 1) {\n    if (i % 2 == 0) {\n      s = s + i;\n    } else {\n      continue;\n    }\n  }\n  while (s > 100) {\n    s = s - 1;\n  }\n  return s;\n}\n"),
 ("T07","Missing semicolon","int main() {\n  int x = 1\n  return x;\n}\n"),
 ("T08","Missing closing brace","int main() {\n  int x = 1;\n  if (x > 0) {\n    x = 2;\n  return x;\n}\n"),
 ("T09","Missing closing parenthesis","int main() {\n  int x = 1;\n  if (x > 0 {\n    x = 2;\n  }\n  return x;\n}\n"),
 ("T10","Incomplete expression","int main() {\n  int price = 5;\n  int total = price + ;\n  return total;\n}\n"),
 ("T11","Multiple syntax errors","int main() {\n  int x = 1\n  if (x > 0 {\n    x = 2;\n  }\n  return x;\n}\n"),
 ("T12","Ambiguous repair (missing operator)","int main() {\n  int a = 1;\n  int b = 2;\n  int c = a b;\n  return c;\n}\n"),
 ("T13","Abstention (missing variable name)","int main() {\n  int = 42;\n  return 0;\n}\n"),
 ("T16","Invalid character","int main() {\n  int x = 1 $ 2;\n  return x;\n}\n"),
 ("T17a","Empty input",""),
 ("T17b","Comments only","// a note\n/* nothing else */\n"),
 ("T18","Incomplete code at end of input","int main() {\n  int x = 1;\n"),
 ("T19","Unterminated comment","int main() {\n  int x = 1;\n  /* the comment never ends\n  return x;\n}\n"),
 ("T20a","Unsupported: ++","int main() {\n  int i = 0;\n  i++;\n  return i;\n}\n"),
 ("T20b","Unsupported: #include","#include <stdio.h>\nint main() {\n  return 0;\n}\n"),
 ("T20c","Unsupported: string literal","int main() {\n  print(\"hi\");\n  return 0;\n}\n"),
 ("T20d","Unsupported: struct keyword","struct point { int x; };\nint main() {\n  return 0;\n}\n"),
 ("T21a","Deep nesting, 4000 parentheses","int main() { return " + "("*4000 + "1" + ")"*4000 + "; }\n"),
 ("T21b","Deep nesting, 6000 parentheses","int main() { return " + "("*6000 + "1" + ")"*6000 + "; }\n"),
 ("T22","No safe repair","hello world this is not code"),
 ("T25a","Integer literal out of range","int main() {\n  return 2147483648;\n}\n"),
 ("T25b","Identifier of 256 characters","int main() {\n  int " + "a"*256 + " = 1;\n  return 0;\n}\n"),
 ("T25c","Exactly 65536 bytes (valid)", None),
 ("T25d","65537 bytes (over the limit)", None),
]
def big(n):
    head = "int main() {\n  int s = 0;\n"; tail = "  return s;\n}\n"
    body = ""; line = "  s = s + 1;\n"
    while len(head)+len(body)+len(line)+len(tail) <= n: body += line
    src = head+body+tail
    pad = n - len(src)
    return src[:-2] + " "*pad + src[-2:] if pad>0 else src
