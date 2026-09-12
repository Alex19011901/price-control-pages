#!/usr/bin/env python3
import base64
import gzip
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PC = ROOT / "price-control"
HISTORY = PC / "history"
PARTS = PC / "history-parts"


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_gzip_b64(paths):
    text = "".join(Path(p).read_text(encoding="utf-8").strip() for p in paths)
    raw = gzip.decompress(base64.b64decode(text))
    return json.loads(raw.decode("utf-8"))


def normalize_hist(src, *, key, label, start, end, price_date):
    rows_data = src["rowsData"]
    out = {
        "key": key,
        "label": label,
        "supplier": "Парадис Экзотика",
        "start": start,
        "end": end,
        "docs": int(src["docs"]),
        "rows": len(rows_data),
        "above": int(src["above"]),
        "below": int(src["below"]),
        "equal": int(src.get("equal", 0)),
        "unmatched": int(src["unmatched"]),
        "overpay": float(src["overpay"]),
        "priceDocumentDate": price_date,
        "indexGroup": "paradis",
        "rowsData": rows_data,
    }
    assert out["rows"] == out["above"] + out["below"] + out["equal"] + out["unmatched"]
    return out


def _norm(v):
    import re
    s = str(v or "").replace("\u00a0", " ").replace("ё", "е").lower()
    s = re.sub(r"^[!/*+\s]+", "", s)
    s = re.sub(r"\s+([,.;:])", r"\1", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _core_name(display_name, unit):
    import re
    s = str(display_name or "").replace("\u00a0", " ")
    s = re.sub(r"\s+", " ", s).strip()
    eu = re.escape(str(unit or ""))
    if eu:
        s = re.sub(r",\s*" + eu + r"\s*\([^)]*\)\s*$", "", s, flags=re.I)
        s = re.sub(r",\s*" + eu + r"\s*$", "", s, flags=re.I)
    return s.strip()


def _period_price_qty_map(period):
    out = {}
    for row in period.get("rowsData", []):
        try:
            price = float(row[5]) if row[5] is not None else None
            qty = float(row[3]) if row[3] is not None else 0.0
        except (TypeError, ValueError):
            continue
        if price is None or price <= 0 or qty <= 0:
            continue
        key = _norm(_core_name(row[0], row[4])) + "\0" + _norm(row[4])
        item = out.setdefault(key, {"price": price, "qty": 0.0})
        if round(item["price"], 2) != round(price, 2):
            continue
        item["qty"] += qty
    return out


def _weighted_index_change(prev_period, curr_period):
    prev = _period_price_qty_map(prev_period)
    curr = _period_price_qty_map(curr_period)
    num = den = 0.0
    common = 0
    for key, cur in curr.items():
        old = prev.get(key)
        if not old:
            continue
        w = cur["qty"]
        num += cur["price"] * w
        den += old["price"] * w
        common += 1
    if common == 0 or den <= 0:
        return None, 0
    return num / den, common


def validate_period(p):
    assert len(p["rowsData"]) == int(p["rows"]), (p["key"], len(p["rowsData"]), p["rows"])
    assert int(p["rows"]) == (
        int(p["above"]) + int(p["below"]) +
        int(p.get("equal", 0)) + int(p["unmatched"])
    ), p["key"]


def slice_period_date(src, *, date_ru, key, label, start, end, price_date):
    rows = [r for r in src.get("rowsData", []) if len(r) >= 10 and r[1] == date_ru]
    assert rows, (key, date_ru, "no rows")
    above = sum(1 for r in rows if r[9] == "ABOVE")
    below = sum(1 for r in rows if r[9] == "BELOW")
    equal = sum(1 for r in rows if r[9] == "EQUAL")
    unmatched = sum(1 for r in rows if r[9] == "UNMATCHED")
    docs = len({r[2] for r in rows if r[2]})
    overpay_raw = 0.0
    for r in rows:
        if r[9] != "ABOVE":
            continue
        try:
            qty = float(r[3])
            price = float(r[5])
            fact = float(r[6])
        except (TypeError, ValueError):
            continue
        overpay_raw += max(0.0, (fact - price) * qty)
    overpay = round(overpay_raw + 1e-12, 2)
    out = {
        "key": key,
        "label": label,
        "supplier": "Парадис Экзотика",
        "start": start,
        "end": end,
        "docs": docs,
        "rows": len(rows),
        "above": above,
        "below": below,
        "equal": equal,
        "unmatched": unmatched,
        "overpay": overpay,
        "priceDocumentDate": price_date,
        "indexGroup": "paradis",
        "rowsData": rows,
    }
    validate_period(out)
    return out


p2606 = load_gzip_b64([
    PARTS / "hist_2606_0207.v2.b64.00",
    PARTS / "hist_2606_0207.v2.b64.01",
    PARTS / "hist_2606_0207.v2.b64.02",
    PARTS / "hist_2606_0207.v2.b64.03",
])
p2407 = load_gzip_b64([PARTS / "hist_2407_2907.json.gz.b64"])
p3007 = load_gzip_b64([PARTS / "hist_3007_0508.json.gz.b64"])
interfood = load_json(HISTORY / "interfood_20260520.json")
current_payload = load_json(PC / "current.json")
current = current_payload["week"]

p2606 = normalize_hist(
    p2606, key="2026-06-26", label="Прайс 26.06 → 02.07",
    start="26.06.2026", end="02.07.2026", price_date="25.06.2026",
)
p2407 = normalize_hist(
    p2407, key="2026-07-24", label="Прайс 24.07 → 29.07",
    start="24.07.2026", end="29.07.2026", price_date="22.07.2026",
)
p3007 = normalize_hist(
    p3007, key="2026-07-30", label="Прайс 30.07 → 05.08",
    start="30.07.2026", end="05.08.2026", price_date="30.07.2026",
)

expected = {
    "2026-06-26": (13, 216, 149, 38, 0, 29, 8531.74),
    "2026-07-24": (7, 199, 161, 31, 0, 7, 17953.72),
    "2026-07-30": (7, 189, 172, 11, 0, 6, 12514.78),
    "2026-05-20": (13, 305, 20, 0, 269, 16, 1676.33),
}

assert current["key"] in {"2026-08-26", "2026-09-03", "2026-09-11", "2026-09-12"}, current["key"]
validate_period(current)

full_path = PC / "full.json"
previous_full = load_json(full_path) if full_path.exists() else {"periods": []}
previous_periods = {p.get("key"): p for p in previous_full.get("periods", [])}
p2608 = previous_periods.get("2026-08-26")
p0903 = previous_periods.get("2026-09-03")
p0911 = previous_periods.get("2026-09-11")

if current["key"] == "2026-08-26":
    periods = [current, p3007, p2407, p2606, interfood]
elif current["key"] == "2026-09-03":
    assert p2608 is not None, "Previous 2026-08-26 period is missing from full.json"
    validate_period(p2608)
    periods = [current, p2608, p3007, p2407, p2606, interfood]
elif current["key"] == "2026-09-11":
    assert p2608 is not None, "Previous 2026-08-26 period is missing from full.json"
    assert p0903 is not None, "Previous 2026-09-03 period is missing from full.json"
    validate_period(p2608)
    validate_period(p0903)
    p0903 = dict(p0903)
    p0903["label"] = "Прайс 03.09 → 10.09"
    p0903["start"] = "03.09.2026"
    p0903["end"] = "10.09.2026"
    p0903["priceDocumentDate"] = "02.09.2026"
    periods = [current, p0903, p2608, p3007, p2407, p2606, interfood]
else:
    assert p2608 is not None, "Previous 2026-08-26 period is missing from full.json"
    assert p0903 is not None, "Previous 2026-09-03 period is missing from full.json"
    assert p0911 is not None, "Previous 2026-09-11 period is missing from full.json"
    validate_period(p2608)
    validate_period(p0903)
    validate_period(p0911)
    p0903 = dict(p0903)
    p0903["label"] = "Прайс 03.09 → 10.09"
    p0903["start"] = "03.09.2026"
    p0903["end"] = "10.09.2026"
    p0903["priceDocumentDate"] = "02.09.2026"
    p0911 = slice_period_date(
        p0911,
        date_ru="11.09.2026",
        key="2026-09-11",
        label="Прайс 11.09",
        start="11.09.2026",
        end="11.09.2026",
        price_date="10.09.2026",
    )
    periods = [current, p0911, p0903, p2608, p3007, p2407, p2606, interfood]

for p in periods:
    if p["key"] in {current["key"], "2026-08-26", "2026-09-03", "2026-09-11"}:
        validate_period(p)
        continue
    got = (
        int(p["docs"]), int(p["rows"]), int(p["above"]), int(p["below"]),
        int(p.get("equal", 0)), int(p["unmatched"]), round(float(p["overpay"]), 2),
    )
    want = expected[p["key"]]
    assert got == want, (p["key"], got, want)
    validate_period(p)

paradis_index = {
    "supplier": "Парадис Экзотика",
    "baseKey": "2026-06-26",
    "baseLabel": "26.06–02.07",
    "points": [
        {"key": "2026-06-26", "label": "26.06–02.07", "value": 100.0},
        {"key": "2026-07-24", "label": "24.07–29.07", "value": 98.5},
        {"key": "2026-07-30", "label": "30.07–05.08", "value": 101.2},
        {"key": "2026-08-26", "label": "26.08–01.09", "value": 108.9},
    ],
    "current": 108.9,
    "prevChange": 7.6,
    "periodChange": 8.9,
}

last_index = 108.9
prev_period = p2608

if current["key"] == "2026-09-03":
    factor, common_count = _weighted_index_change(p2608, current)
    if factor is None:
        paradis_index["current"] = None
        paradis_index["prevChange"] = None
        paradis_index["periodChange"] = None
    else:
        new_index = round(last_index * factor, 1)
        paradis_index["points"].append({"key": "2026-09-03", "label": "03.09–10.09", "value": new_index})
        paradis_index["current"] = new_index
        paradis_index["prevChange"] = round((new_index / last_index - 1.0) * 100.0, 1)
        paradis_index["periodChange"] = round(new_index - 100.0, 1)
        paradis_index["commonProducts"] = common_count
elif current["key"] == "2026-09-11":
    factor_0903, common_0903 = _weighted_index_change(p2608, p0903)
    if factor_0903 is None:
        paradis_index["current"] = None
        paradis_index["prevChange"] = None
        paradis_index["periodChange"] = None
    else:
        index_0903 = round(last_index * factor_0903, 1)
        paradis_index["points"].append({"key": "2026-09-03", "label": "03.09–10.09", "value": index_0903})
        factor_0911, common_0911 = _weighted_index_change(p0903, current)
        if factor_0911 is None:
            paradis_index["current"] = None
            paradis_index["prevChange"] = None
            paradis_index["periodChange"] = None
            paradis_index["commonProducts"] = 0
        else:
            index_0911 = round(index_0903 * factor_0911, 1)
            paradis_index["points"].append({"key": "2026-09-11", "label": "с 11.09", "value": index_0911})
            paradis_index["current"] = index_0911
            paradis_index["prevChange"] = round((index_0911 / index_0903 - 1.0) * 100.0, 1)
            paradis_index["periodChange"] = round(index_0911 - 100.0, 1)
            paradis_index["commonProducts"] = common_0911
            paradis_index["previousCommonProducts"] = common_0903
elif current["key"] == "2026-09-12":
    stored_index = previous_full.get("indexGroups", {}).get("paradis")
    if stored_index:
        paradis_index = stored_index

full = {
    "generatedAt": current_payload["generatedAt"],
    "currentKey": current["key"],
    "periods": periods,
    "indexGroups": {
        "paradis": paradis_index,
        "interfood": {
            "supplier": "Интерфуд",
            "baseKey": "2026-05-20",
            "baseLabel": "20.05–26.05",
            "points": [
                {"key": "2026-05-20", "label": "20.05–26.05", "value": 100.0}
            ],
            "current": 100.0,
            "prevChange": None,
            "periodChange": 0.0,
        },
    },
}

HISTORY.mkdir(parents=True, exist_ok=True)
for path, data in [
    (HISTORY / "paradis_20260626.json", p2606),
    (HISTORY / "paradis_20260724.json", p2407),
    (HISTORY / "paradis_20260730.json", p3007),
    (PC / "full.json", full),
]:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print("FULL_DATA_OK", json.dumps({
    "generatedAt": full["generatedAt"],
    "currentKey": full["currentKey"],
    "periods": [
        {
            "key": p["key"], "docs": p["docs"], "rows": p["rows"],
            "above": p["above"], "below": p["below"],
            "equal": p.get("equal", 0), "unmatched": p["unmatched"],
            "overpay": p["overpay"],
        } for p in periods
    ],
    "paradisIndex": full["indexGroups"]["paradis"],
}, ensure_ascii=False))
