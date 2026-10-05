#!/usr/bin/env python3
"""Apply only the verified 04 October receipt; never store a complete price list."""
import argparse
import copy
import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

PC = Path(__file__).resolve().parent
KEY = '2026-10-04'
DATE = '04.10.2026'


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def dump(value):
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n'


def norm(value):
    s = str(value or '').replace('\u00a0', ' ').replace('ё', 'е').lower()
    s = re.sub(r'^[!/*+\s]+', '', s)
    s = re.sub(r'\s+([,.;:])', r'\1', s)
    return re.sub(r'\s+', ' ', s).strip()


def core(name, unit):
    s = re.sub(r'\s+', ' ', str(name).replace('\u00a0', ' ')).strip()
    eu = re.escape(unit)
    s = re.sub(r',\s*' + eu + r'\s*\([^)]*\)\s*$', '', s, flags=re.I)
    return re.sub(r',\s*' + eu + r'\s*$', '', s, flags=re.I).strip()


def d(value):
    return Decimal(str(value))


def money(value):
    out = float(d(value).quantize(Decimal('.01'), rounding=ROUND_HALF_UP))
    return 0.0 if out == 0 else out


def replace_once(text, old, new):
    assert text.count(old) == 1, 'PATCH_ANCHOR_CHANGED'
    return text.replace(old, new, 1)


def patch_refresh(text):
    text = replace_once(text, "const SWITCH_1001 = '2026-10-01';", "const SWITCH_1001 = '2026-10-01';\nconst SWITCH_1004 = '2026-10-04';")
    text = replace_once(text, 'const cfg = todayMoscow >= SWITCH_1001 ? {', '''const cfg = todayMoscow >= SWITCH_1004 ? {
    priceFile: PRICE_0910_FILE,
    weekKey: '2026-10-04',
    startIso: '2026-10-04',
    endIso: null,
    startRu: '04.10.2026',
    endRu: null,
    label: 'Прайс с 04.10',
    priceDocumentDate: '10.09.2026',
    displayPriceDocumentDate: '02.10.2026',
    validFrom: '11.09.2026',
    requireInvoiceSlices: true,
    sumPositiveRowImpacts: true
  } : todayMoscow >= SWITCH_1001 ? {''')
    text = replace_once(text, '    const usedSliceKeys = new Set();', '''    if (cfg.sumPositiveRowImpacts && invoiceSlice &&
        invoiceSlice.sourceValidDate !== cfg.displayPriceDocumentDate) {
      throw new Error(`INVOICE_PRICE_SOURCE_DATE_MISMATCH:${invoiceLabel}`);
    }
    const usedSliceKeys = new Set();''')
    text = replace_once(text, '        const rawImpact = Number(it.sum) - price * qty;', '''        const rawDifference = Number(it.sum) - price * qty;
        // Stabilize decimal arithmetic for new receipt periods only.
        const rawImpact = cfg.sumPositiveRowImpacts
          ? Math.round(rawDifference * 1e8) / 1e8 : rawDifference;
        if (cfg.sumPositiveRowImpacts) overpayRaw += Math.max(0, rawImpact);''')
    return replace_once(text, '          overpayRaw += rawImpact;', '          if (!cfg.sumPositiveRowImpacts) overpayRaw += rawImpact;')


BUILDER_GUARD = '''# The 04 October period uses confirmed invoice slices only.
# Preserve every closed period and its calculations instead of rebuilding them.
_candidate = load_json(PC / "current.json")
if _candidate["week"]["key"] == "2026-10-04":
    _current = _candidate["week"]
    validate_period(_current)
    _full = load_json(PC / "full.json")
    assert _full["currentKey"] in {"2026-10-01", "2026-10-04"}
    _old = []
    for _period in _full["periods"]:
        if _period["key"] == _current["key"]:
            continue
        if _period["key"] == "2026-10-01":
            _period = dict(_period)
            _period["label"] = "Прайс 01.10 → 03.10"
            _period["end"] = "03.10.2026"
        validate_period(_period)
        _old.append(_period)
    assert any(_p["key"] == "2026-10-01" for _p in _old)
    _full["generatedAt"] = _candidate["generatedAt"]
    _full["currentKey"] = _current["key"]
    _full["periods"] = [_current] + _old
    (PC / "full.json").write_text(json.dumps(_full, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")
    print("FULL_DATA_OK", json.dumps({"currentKey": _current["key"], "rows": _current["rows"], "overpay": _current["overpay"], "preservedPeriods": len(_old)}, ensure_ascii=False))
    raise SystemExit(0)


'''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inspect', required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    data = load(PC / 'delivery_20261004_payload.json')
    lines = args.inspect.read_text(encoding='utf-8').splitlines()
    records = [json.loads(s.split('DXBX_TODAY_JSON=', 1)[1]) for s in lines if s.startswith('DXBX_TODAY_JSON=')]
    assert len(records) == 1, 'INSPECTION_PAYLOAD_MISSING'
    record = records[0]
    assert record['targetIso'] == KEY and len(record['invoices']) == 1, 'INVOICE_SELECTION_CHANGED'
    inv = record['invoices'][0]
    expected = data['expectedInvoice']
    assert all(inv[k] == expected[k] for k in ('date', 'number', 'publicId', 'version', 'items')), 'LIVE_INVOICE_CHANGED'
    assert len(inv['items']) == 32 and [it['line'] for it in inv['items']] == list(range(1, 33))
    assert sum((d(it['sum']) for it in inv['items']), Decimal(0)) == Decimal('35836.27')
    sl = data['priceSlice']
    assert sl['invoice'] == inv['number'] and sl['supplyDate'] == DATE and sl['sourceValidDate'] == '02.10.2026'
    prices = {(norm(r['name']), norm(r['unit'])): r for r in sl['rows']}
    assert len(prices) == len(sl['rows']) == 29
    used = set()
    rows, hist_items = [], []
    positive = Decimal(0)
    for it in inv['items']:
        k = (norm(core(it['name'], it['unit'])), norm(it['unit']))
        assert k in prices, 'UNVERIFIED_INVOICE_KEY'
        used.add(k)
        source_row = prices[k]
        qty = d(it['count'])
        assert qty > 0
        fact = money(d(it['sum']) / qty)
        price = None if source_row.get('unmatched') else money(source_row['price'])
        if price is None:
            delta, impact, status = None, 0, 'UNMATCHED'
        else:
            delta = money(d(fact) - d(price))
            raw = d(it['sum']) - d(price) * qty
            positive += max(Decimal(0), raw)
            impact = money(raw)
            status = 'ABOVE' if delta > 0 else 'BELOW' if delta < 0 else 'EQUAL'
        rows.append([it['name'], DATE, inv['number'], it['count'], it['unit'], price, fact, delta, impact, status])
        hist_items.append({'line': it['line'], 'name': it['name'], 'qty': it['count'], 'unit': it['unit'], 'sum': it['sum'], 'fact': fact})
    assert used == set(prices)
    stats = Counter(r[9] for r in rows)
    assert stats == {'ABOVE': 8, 'EQUAL': 24} and money(positive) == 926.88
    week = {'key': KEY, 'label': 'Прайс с 04.10', 'supplier': 'Парадис Экзотика', 'start': DATE, 'end': None, 'docs': 1, 'rows': 32,
            'above': stats['ABOVE'], 'below': stats['BELOW'], 'equal': stats['EQUAL'], 'unmatched': stats['UNMATCHED'],
            'overpay': money(positive), 'priceDocumentDate': '02.10.2026', 'indexGroup': 'paradis', 'rowsData': rows}
    hist_invoice = {'date': DATE, 'invoice': inv['number'], 'version': inv['version'], 'items': hist_items}
    old = {n: load(PC / n) for n in ('current.json', 'full.json', 'purchase_history.json', 'invoice_price_slices.json')}
    if old['current.json']['week']['key'] == KEY:
        assert old['current.json']['week'] == week
        assert old['full.json']['currentKey'] == KEY and old['full.json']['periods'][0] == week
        assert [s for s in old['invoice_price_slices.json']['slices'] if s['invoice'] == inv['number']] == [sl]
        assert [s for s in old['purchase_history.json']['invoices'] if s['invoice'] == inv['number']] == [hist_invoice]
        print('ALREADY_APPLIED_VERIFIED')
        return
    for name, want in data['baselineSha256'].items():
        assert hashlib.sha256((PC / name).read_bytes()).hexdigest() == want, 'BASELINE_CHANGED:' + name
    assert old['current.json']['week'] == old['full.json']['periods'][0]
    assert old['current.json']['week']['key'] == '2026-10-01'
    assert old['current.json']['week']['overpay'] == 755.38
    assert not any(r[2] == inv['number'] for p in old['full.json']['periods'] for r in p['rowsData'])
    assert not any(s['invoice'] == inv['number'] for s in old['invoice_price_slices.json']['slices'])
    assert not any(s['invoice'] == inv['number'] for s in old['purchase_history.json']['invoices'])
    now = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    new = copy.deepcopy(old)
    new['current.json'] = {'generatedAt': now, 'week': week}
    prev = new['full.json']['periods'][0]
    prev['label'], prev['end'] = 'Прайс 01.10 → 03.10', '03.10.2026'
    new['full.json']['periods'].insert(0, week)
    new['full.json']['currentKey'], new['full.json']['generatedAt'] = KEY, now
    history = new['purchase_history.json']
    history['invoices'].append(hist_invoice)
    history['generatedAt'] = now
    for k in ('suppliesScanned', 'invoicesScanned', 'activeInvoices'):
        history[k] += 1
    assert history['activeInvoices'] == len(history['invoices']) == 94
    new['invoice_price_slices.json']['slices'].append(sl)
    # Exact preservation, including all earlier receipt names, prices and outcomes.
    assert new['full.json']['periods'][2:] == old['full.json']['periods'][1:]
    for k, v in old['full.json']['periods'][0].items():
        if k not in ('label', 'end'):
            assert new['full.json']['periods'][1][k] == v
    assert new['full.json']['indexGroups'] == old['full.json']['indexGroups']
    assert history['invoices'][:-1] == old['purchase_history.json']['invoices']
    assert new['invoice_price_slices.json']['slices'][:-1] == old['invoice_price_slices.json']['slices']
    buffers = {n: dump(v) for n, v in new.items()}
    buffers['refresh_dxbx.js'] = patch_refresh((PC / 'refresh_dxbx.js').read_text(encoding='utf-8'))
    builder = (PC / 'build_full_history.py').read_text(encoding='utf-8')
    buffers['build_full_history.py'] = replace_once(builder, 'p2606 = load_gzip_b64([', BUILDER_GUARD + 'p2606 = load_gzip_b64([')
    compile(buffers['build_full_history.py'], 'build_full_history.py', 'exec')
    summary = {k: v for k, v in week.items() if k != 'rowsData'}
    summary.update({'uniquePriceRows': len(prices), 'historyInvoices': len(history['invoices']), 'preservedPeriods': len(old['full.json']['periods']), 'invoice': inv['number']})
    if args.apply:
        # Nothing is published unless all checks above have passed.
        for name, text in buffers.items():
            (PC / name).write_text(text, encoding='utf-8')
    print(('APPLIED ' if args.apply else 'DRY_RUN_OK ') + json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    main()
