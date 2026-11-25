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
