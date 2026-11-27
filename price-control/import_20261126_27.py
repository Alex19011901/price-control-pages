#!/usr/bin/env python3
"""Import the verified 26–27 November Aish receipts using the archived 24.11 price list.
No fuzzy matches, no use of other suppliers' prices, no rewrites of closed periods.
"""
import base64
import bz2
import hashlib
import json
import re
import subprocess
import sys
from collections import defaultdict
from decimal import Decimal, ROUND_FLOOR
from pathlib import Path

PC = Path(__file__).resolve().parent
def read(name): return json.loads((PC / name).read_text(encoding="utf-8"))
def write(name, data): (PC / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
def dec(x): return Decimal(str(x))
def round2(x): return float((x * 100 + Decimal("0.5")).to_integral_value(rounding=ROUND_FLOOR) / 100)
def norm(s):
    s = str(s or "").replace("\u00a0", " ").replace("ё", "е").lower()
    s = re.sub(r"^[!/*+\s]+", "", s)
    s = re.sub(r"\s+([,.;:])", r"\1", s)
    return re.sub(r"\s+", " ", s).strip()
def core_name(name, unit):
    s = re.sub(r"\s+", " ", str(name).replace("\u00a0", " ")).strip()
    if unit:
        s = re.sub(r",\s*" + re.escape(unit) + r"\s*\([^)]*\)\s*$", "", s, flags=re.I)
        s = re.sub(r",\s*" + re.escape(unit) + r"\s*$", "", s, flags=re.I)
    return s.strip()
def normalized_unit(unit): return norm(unit).rstrip(".")
def price_name(name):
    # Formatting only: brackets, commas, a word-final dot, whitespace,
    # and equivalent spelled-out gram abbreviation. No word substitutions.
    s = norm(name)
    s = re.sub(r"[<>(),]", " ", s)
    s = re.sub(r"\.(?=\s|$)", " ", s)
    s = re.sub(r"(?<=\d)\s*(?:гр|г)(?=\s|$)", " г", s)
    return re.sub(r"\s+", " ", s).strip()
def key(name, unit): return price_name(name), normalized_unit(unit)
def replace_once(s, a, b):
    assert s.count(a) == 1, ("Unexpected source for patch", a[:100])
    return s.replace(a,b,1)

audit = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
assert (audit["startIso"], audit["endIso"], audit["supplier"], audit["unreadable"]) == ("2026-11-26", "2026-11-27", "ALL", 0)
assert audit["generatedAt"]
latest = {}
for d in audit["invoices"]:
    if "айш гарден" not in norm(d["supplier"]):
        continue
    assert d["date"] in ("26.11.2026", "27.11.2026") and d["number"] and d["items"]
    k = (d["date"], d["number"])
    if k not in latest or d["version"] > latest[k]["version"]:
        latest[k] = d
    elif d["version"] == latest[k]["version"]:
        assert d["items"] == latest[k]["items"]
assert {d["date"] for d in latest.values()} == {"26.11.2026","27.11.2026"}, "Previously confirmed Aish receipt missing"
assert ("26.11.2026","3432") in latest and ("27.11.2026","УТАГ0003443") in latest

manifest = read("price_20261124_manifest.json")
assert manifest["supplier"] == "Айш Гарден" and manifest["sourceFile"] == "24.11.xlsx" and manifest["documentDate"] == "24.11.2026"
compressed = base64.b64decode("".join((PC/"price_20261124.parts"/p).read_text().strip() for p in manifest["parts"]), validate=True)
assert hashlib.sha256(compressed).hexdigest() == manifest["compressedSha256"]
raw = bz2.decompress(compressed)
assert hashlib.sha256(raw).hexdigest() == manifest["tsvSha256"]
prices, lookup = {}, defaultdict(list)
for row in raw.decode("utf-8").splitlines():
    line, name, unit, value = row.split("\t")
    line = int(line)
    assert line not in prices and name and unit in {"кг","шт","меш"} and dec(value)>0
    p = {"sourceRow":line,"priceSourceName":name,"sourceUnit":unit,"sourcePrice":dec(value)}
    prices[line] = p
    lookup[key(name,unit)].append(p)
assert len(prices) == manifest["rows"] == 761

def unique_price(k):
    vals = lookup.get(k,[])
    if not vals or len({p["sourcePrice"] for p in vals}) != 1: return None
    return vals[0]

slices = read("invoice_price_slices.json")
original_slices = json.loads(json.dumps(slices["slices"],ensure_ascii=False))
aliases = defaultdict(set)
# The only non-literal name aliases are the previously documented,
# invoice-specific matches in the verified Aish price slices.
for sl in original_slices:
    if sl["source"] not in {"ПРАЙС-2.xlsx","24.11.xlsx"}: continue
    for r in sl["rows"]:
        if r.get("unmatched") or not r.get("priceSourceName"): continue
        a = key(r["name"],r["unit"])
        u = normalized_unit(r.get("sourceUnit",r["unit"]))
        weight = None
        if u != normalized_unit(r["unit"]):
            if a == key("Руккола 125 гр.","шт.") and u == "кг" and r.get("formula"):
                weight = Decimal("0.125")
            elif a == key("Томаты черри (красные) 250 гр.","шт.") and u == "кг" and r.get("formula"):
                weight = Decimal("0.25")
            else: continue
        aliases[a].add((price_name(r["priceSourceName"]),u,weight))

# Exact supplier-specific mappings, reusable with new Aish price lists.
confirmed_aliases = {}
registry = read("aish_price_aliases.json")
assert registry["supplier"] == manifest["supplier"]
for rule in registry["aliases"]:
    k = key(rule["receiptName"], rule["receiptUnit"])
    assert k not in confirmed_aliases
    confirmed_aliases[k] = rule

def match(name, unit):
    k = key(name,unit)
    direct = unique_price(k)
    if direct is not None:
        return direct, direct["sourcePrice"], "exact normalized name + unit", None
    # If the literal key has conflicting prices, do not bypass ambiguity.
    if lookup.get(k): return None
    rule = confirmed_aliases.get(k)
    if rule:
        p = unique_price(key(rule["priceName"], rule["priceUnit"]))
        if p is None:
            return None
        weight = dec(rule["packageWeightKg"]) if "packageWeightKg" in rule else None
        if weight is not None:
            assert normalized_unit(unit) == "шт" and normalized_unit(p["sourceUnit"]) == "кг" and weight > 0
            return p, dec(round2(p["sourcePrice"] * weight)), "user-confirmed exact alias and package weight", weight
        if normalized_unit(unit) != normalized_unit(p["sourceUnit"]):
            assert normalized_unit(unit) == "уп" and p["sourceUnit"] == "шт" and rule.get("unitsPerReceipt") == 1
            return p, p["sourcePrice"], "user-confirmed identical package", None
        return p, p["sourcePrice"], "confirmed exact alias", None
    found = {}
    for alias_name, alias_unit, weight in aliases.get(k, ()):
        p = unique_price((alias_name,alias_unit))
        if p is None: continue
        value = p["sourcePrice"] if weight is None else dec(round2(p["sourcePrice"]*weight))
        found[(p["sourceRow"],value,weight)] = p
    if len(found) != 1: return None
    (line,value,weight),p = next(iter(found.items()))
    return p,value,"previously documented exact alias" if weight is None else "previously documented exact package weight",weight

full0 = read("full.json")
assert full0["currentKey"] == "2026-11-25"
assert not any(p["key"] in {"2026-11-26","2026-11-27"} for p in full0["periods"])
assert not any(s["invoice"] in {d["number"] for d in latest.values()} for s in original_slices)

builder = (PC/"build_full_history.py").read_text(encoding="utf-8")
builder = replace_once(builder, '"2026-11-18", "2026-11-19", "2026-11-25"}:\n    _current', '"2026-11-18", "2026-11-19", "2026-11-25", "2026-11-26", "2026-11-27"}:\n    _current')
builder = replace_once(builder,'        "2026-11-25": "2026-11-19",\n    }[_current["key"]]','        "2026-11-25": "2026-11-19",\n        "2026-11-26": "2026-11-25",\n        "2026-11-27": "2026-11-26",\n    }[_current["key"]]')
builder = replace_once(builder,'    elif _current["key"] == "2026-11-25":','    elif _current["key"] in {"2026-11-25", "2026-11-26", "2026-11-27"}:')
builder = replace_once(builder,'        assert [p["key"] for p in closed] == ["2026-11-18", "2026-11-19"]','        assert [p["key"] for p in closed] == sorted(p["key"] for p in _old if p.get("indexGroup") == "aish_garden" and p["key"] < _current["key"])')
builder = replace_once(builder,'            "label": "25.11",','            "label": _current["start"][:5],')
(PC/"build_full_history.py").write_text(builder,encoding="utf-8")

results=[]
for day in ("26.11.2026","27.11.2026"):
    docs=sorted((d for d in latest.values() if d["date"]==day),key=lambda d:d["number"])
    rows=[]
    overpay=Decimal(0)
    for d in docs:
        price_rows={}
        for i in sorted(d["items"],key=lambda i:i["line"]):
            q, total = dec(i["count"]),dec(i["sum"])
            assert q>0 and total>=0
            name=core_name(i["name"],i["unit"])
            assert name and i["unit"]
            found=match(name,i["unit"])
            fact=round2(total/q)
            if found:
                p,value,method,weight=found
                price=round2(value)
                delta=round2(dec(fact)-dec(price))
                impact=total-dec(price)*q
                overpay+=max(Decimal(0),impact)
                status="ABOVE" if delta>0 else "BELOW" if delta<0 else "EQUAL"
                sr={"name":name,"unit":i["unit"],"price":price,"priceSourceName":p["priceSourceName"],"sourceRow":p["sourceRow"],"sourceUnit":p["sourceUnit"],"matchMethod":method}
                if method == "user-confirmed identical package":
                    sr["unitsPerReceipt"] = 1
                if weight is not None:
                    sr["sourcePrice"]=float(p["sourcePrice"])
                    sr["formula"]=f"{p['sourcePrice']} ₽/кг × {weight} кг"
            else:
                price=delta=None
                impact=Decimal(0)
                status="UNMATCHED"
                sr={"name":name,"unit":i["unit"],"unmatched":True,"reason":"Нет однозначного точного совпадения названия и единицы в прайсе 24.11; ранее подтверждённый вариант также не найден."}
            rows.append([i["name"],day,d["number"],i["count"],i["unit"],price,fact,delta,round2(impact),status])
            k=(norm(name),norm(i["unit"]))
            if k in price_rows: assert price_rows[k]==sr
            price_rows[k]=sr
        slices["slices"].append({"invoice":d["number"],"supplyDate":day,"source":"24.11.xlsx","sourceValidDate":"24.11.2026","rows":list(price_rows.values())})
    iso="-".join(reversed(day.split(".")))
    period={"key":iso,"label":"Поставка "+day[:5] if len(docs)==1 else "Поставки "+day[:5],"supplier":"Айш Гарден","start":day,"end":day,"docs":len(docs),"rows":len(rows),"above":sum(r[9]=="ABOVE" for r in rows),"below":sum(r[9]=="BELOW" for r in rows),"equal":sum(r[9]=="EQUAL" for r in rows),"unmatched":sum(r[9]=="UNMATCHED" for r in rows),"overpay":round2(overpay),"priceDocumentDate":"24.11.2026","indexGroup":"aish_garden","rowsData":rows}
    write("current.json",{"generatedAt":audit["generatedAt"],"week":period})
    write("invoice_price_slices.json",slices)
    subprocess.run([sys.executable,str(PC/"build_full_history.py")],check=True)
    full=read("full.json")
    assert full["currentKey"]==iso and full["periods"][0]==period
    assert full["periods"][-len(full0["periods"]):]==full0["periods"], "Closed receipt periods changed"
    for group in ("paradis","interfood"):
        assert full["indexGroups"][group]==full0["indexGroups"][group]
    for group in ("aish_garden","unified_produce"):
        points=full0["indexGroups"][group]["points"]
        assert full["indexGroups"][group]["points"][:len(points)]==points, "Closed index points changed"
    results.append({"day":day,"invoices":[d["number"] for d in docs],"total":round2(sum((dec(i["sum"]) for d in docs for i in d["items"]),Decimal(0))),"rows":period["rows"],"above":period["above"],"below":period["below"],"equal":period["equal"],"unmatched":period["unmatched"],"overpay":period["overpay"],"details":[{"name":r[0],"qty":r[3],"unit":r[4],"price":r[5],"fact":r[6],"impact":r[8],"status":r[9]} for r in rows]})
assert slices["slices"][:len(original_slices)]==original_slices

# Verify every new matched source row against the hash-verified full price list.
for sl in slices["slices"][len(original_slices):]:
    for r in sl["rows"]:
        if r.get("unmatched"): continue
        p=prices[r["sourceRow"]]
        assert p["priceSourceName"]==r["priceSourceName"] and p["sourceUnit"]==r["sourceUnit"]
        if "formula" in r:
            assert r["sourcePrice"]==float(p["sourcePrice"])
            rule = confirmed_aliases.get(key(r["name"], r["unit"]))
            if rule and "packageWeightKg" in rule:
                w = dec(rule["packageWeightKg"])
            elif key(r["name"],r["unit"]) == key("Руккола 125 гр.","шт."):
                w = Decimal("0.125")
            else:
                assert key(r["name"],r["unit"]) == key("Томаты черри (красные) 250 гр.","шт.")
                w = Decimal("0.25")
            assert round2(p["sourcePrice"]*w)==r["price"]
        else:
            assert round2(p["sourcePrice"])==r["price"]
            if normalized_unit(r["unit"]) != p["sourceUnit"]:
                rule = confirmed_aliases.get(key(r["name"], r["unit"]))
                assert rule and rule.get("unitsPerReceipt") == r.get("unitsPerReceipt") == 1
                assert normalized_unit(r["unit"]) == "уп" and p["sourceUnit"] == "шт"

# Prevent an ordinary refresh from reverting the newest published period to 25.11.
refresh=(PC/"refresh_dxbx.js").read_text(encoding="utf-8")
prefix="""  const cfg = todayMoscow >= '2026-11-27' ? {
    priceFile: null,
    weekKey: '2026-11-27',
    startIso: '2026-11-27',
    endIso: '2026-11-27',
    startRu: '27.11.2026',
    endRu: '27.11.2026',
    label: 'Поставка 27.11',
    priceDocumentDate: '24.11.2026',
    displayPriceDocumentDate: '24.11.2026',
    validFrom: '24.11.2026',
    supplierNeedle: 'айш гарден',
    supplierLabel: 'Айш Гарден',
    indexGroup: 'aish_garden',
    requiredInvoice: 'УТАГ0003443',
    requireInvoiceSlices: true,
    sumPositiveRowImpacts: true
  } : todayMoscow >= '2026-11-25' ? {"""
if len([d for d in latest.values() if d["date"]=="27.11.2026"])>1:
    prefix=prefix.replace("label: 'Поставка 27.11'","label: 'Поставки 27.11'")
refresh=replace_once(refresh,"  const cfg = todayMoscow >= '2026-11-25' ? {",prefix)
(PC/"refresh_dxbx.js").write_text(refresh,encoding="utf-8")

# A second run of the existing builder must reproduce exactly the stored data.
before=read("full.json")
subprocess.run([sys.executable,str(PC/"build_full_history.py")],check=True)
assert read("full.json")==before
print("IMPORT_AISH_RESULT "+json.dumps(results,ensure_ascii=False))
print("IMPORT_INDEX_RESULT "+json.dumps({"current":before["indexGroups"]["unified_produce"]["current"],"points":before["indexGroups"]["unified_produce"]["points"][-3:]},ensure_ascii=False))
