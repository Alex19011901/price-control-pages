#!/usr/bin/env python3
"""Verify the entire archived 24.11 price document and its exact receipt slice."""
import base64
import bz2
import hashlib
import json
from decimal import Decimal
from pathlib import Path

PC = Path(__file__).resolve().parent
parts = PC / "price_20261124.parts"
payload = base64.b64decode("".join((parts / f"{i:02d}").read_text().strip() for i in range(4)), validate=True)
assert hashlib.sha256(payload).hexdigest() == "d83e0ce36e2a131ed23d6a7dad4e333a6319c3b3ca0ba70cb73ad19b349574f4"
raw = bz2.decompress(payload)
assert hashlib.sha256(raw).hexdigest() == "d9d30f8ac3f3a72bd9086d464166d39b3a0a4726dfc396824f22f37366b7c397"
prices = {}
for row in raw.decode("utf-8").splitlines():
    line, name, unit, price = row.split("\t")
    assert int(line) not in prices
    assert name and unit in {"кг", "шт", "меш"} and Decimal(price) > 0
    prices[int(line)] = (name, unit, Decimal(price))
assert len(prices) == 761
slices = json.loads((PC / "invoice_price_slices.json").read_text())["slices"]
sl = next(s for s in slices if s["invoice"] == "УТАГ0003421")
assert sl["source"] == "24.11.xlsx" and sl["sourceValidDate"] == "24.11.2026"
assert len(sl["rows"]) == 14
matched = [r for r in sl["rows"] if not r.get("unmatched")]
assert len(matched) == 10
for r in matched:
    name, unit, price = prices[r["sourceRow"]]
    assert (name, unit, price) == (r["priceSourceName"], r["sourceUnit"], Decimal(str(r["price"])))
    assert r["unit"].rstrip(".") == unit
assert sum(bool(r.get("unmatched")) for r in sl["rows"]) == 4
print("PRICE_20261124_VERIFIED", len(prices), "rows;", len(matched), "confirmed matches")

# Verify explicit aliases against the archived source, never the invoice price.
registry = json.loads((PC / "aish_price_aliases.json").read_text(encoding="utf-8"))
assert registry["supplier"] == "Айш Гарден"
rules = {(r["receiptName"], r["receiptUnit"].rstrip(".")): r for r in registry["aliases"]}
assert len(rules) == len(registry["aliases"])
for rule in rules.values():
    matches = [p for p in prices.values() if p[0] == rule["priceName"] and p[1] == rule["priceUnit"]]
    assert len(matches) == 1, rule
    unit = rule["receiptUnit"].rstrip(".")
    if "packageWeightKg" in rule:
        assert unit == "шт" and rule["priceUnit"] == "кг" and Decimal(str(rule["packageWeightKg"])) > 0
    elif "unitsPerReceipt" in rule:
        assert unit == "уп" and rule["priceUnit"] == "шт" and rule["unitsPerReceipt"] == 1
    else:
        assert unit == rule["priceUnit"]
for current_slice in [s for s in slices if (s["invoice"], s["supplyDate"]) in {("3432", "26.11.2026"), ("УТАГ0003443", "27.11.2026")}]:
    assert current_slice["source"] == "24.11.xlsx"
    for r in current_slice["rows"]:
        rule = rules.get((r["name"], r["unit"].rstrip(".")))
        if not rule:
            continue
        assert not r.get("unmatched"), r
        name, unit, price = prices[r["sourceRow"]]
        assert (name, unit) == (rule["priceName"], rule["priceUnit"]) == (r["priceSourceName"], r["sourceUnit"])
        expected = price * Decimal(str(rule.get("packageWeightKg", 1)))
        assert Decimal(str(r["price"])) == expected, r
    print("AISH_CONFIRMED_ALIASES_VERIFIED", len(rules))
