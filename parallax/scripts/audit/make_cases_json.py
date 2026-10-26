"""Writes cases.json (used by the browser scripts) from cases.py."""
import json
from cases import CASES, big
out = []
for cid, title, src in CASES:
    if src is None:
        src = big(65536) if cid == "T25c" else big(65536) + " "
    out.append([cid, title, src])
json.dump(out, open("cases.json", "w"))
print(len(out), "cases")
