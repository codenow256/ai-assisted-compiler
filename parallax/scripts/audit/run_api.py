import json, urllib.request, sys
from cases import CASES, big
def post(path, body):
    r = urllib.request.Request("http://127.0.0.1:8000/api"+path, data=json.dumps(body).encode(), headers={"Content-Type":"application/json"})
    try: return json.load(urllib.request.urlopen(r, timeout=90))
    except urllib.error.HTTPError as e: return json.load(e)
out = {}
for cid, title, src in CASES:
    if src is None: src = big(65536) if cid=="T25c" else big(65536)+" "
    r = post("/repair", {"source": src})
    rec = {"title": title, "bytes": len(src.encode())}
    if "error" in r:
        rec["error"] = r["error"]["code"] + ": " + r["error"]["message"]
    else:
        d = r["data"]; p = d["parse"]; dec = d["repair"]["decision"]
        rec.update(ok=p["ok"], resource_limit=p["resource_limit"], tokens=len(d["tokens"]),
                   lexical=[e["message"] for e in d["lexical_errors"]][:3],
                   diags=[f'{x["start"]["line"]}:{x["start"]["column"]} {x["message"]}' for x in p["diagnostics"]][:4],
                   ast_nodes=p.get("ast_nodes"), ast_depth=p.get("ast_depth"), partial=bool(p.get("recovered_ast")),
                   status=dec["status"], margin=dec["margin"], reasons=dec["reasons"][:2],
                   plans=[(pl["summary"], pl["valid"], pl["total_cost"]) for pl in dec["plans"][:4]],
                   counts=d["repair"]["counts"], parser_calls=d["repair"]["budget"]["parser_invocations"], ms=round(r["backend_ms"],1))
    out[cid] = rec
    print(cid, title, "|", rec.get("error") or f'ok={rec["ok"]} status={rec["status"]} margin={rec["margin"]} diags={rec["diags"][:2]} lex={rec["lexical"][:1]} plans={rec["plans"][:3]} nodes={rec["ast_nodes"]}')
json.dump(out, open("api_results.json","w"), indent=1)
